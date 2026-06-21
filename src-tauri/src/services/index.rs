use crate::domain::note::Note;
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{normalize_kb_relative_path, resolve_kb_path};
use crate::infrastructure::hash::sha256_str;
use crate::infrastructure::markdown::{
    InlineTagOccurrence, body_line_offset, extract_inline_tag_occurrences_with_offset,
    extract_links, parse_note,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use ulid::Ulid;

/// 对一篇笔记执行全量索引：upsert notes + 重建 note_tags + tag_occurrences + links + note_fts
/// 全部在同一个 SQLite 事务中完成。
pub fn index_note_full(
    conn: &Connection,
    root: &Path,
    rel_path: &str,
    content: &str,
) -> AppResult<Note> {
    let stem = Path::new(rel_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let parsed = parse_note(content, &stem)?;
    let hash = sha256_str(content);
    let now = chrono::Utc::now().to_rfc3339();

    let note_id = parsed
        .front_matter
        .id
        .clone()
        .unwrap_or_else(|| Ulid::new().to_string());
    let title = parsed.title.clone();
    let summary = parsed.front_matter.summary.clone();
    let word_count = parsed.word_count as i64;
    let fm_tags = parsed.front_matter.tags.clone().unwrap_or_default();
    let fm_tag_names = fm_tags
        .iter()
        .map(|tag| tag.trim().to_lowercase())
        .collect::<HashSet<_>>();
    let inline_occurrences = extract_inline_tag_occurrences_with_offset(
        &parsed.body,
        body_line_offset(content),
    )
    .into_iter()
    .filter(|occurrence| fm_tag_names.contains(&occurrence.tag_name.trim().to_lowercase()))
    .collect::<Vec<_>>();
    let raw_links = extract_links(&parsed.body);

    // ── single transaction ──────────────────────────────────────────────────
    let tx = conn.unchecked_transaction()?;

    // 1. Upsert note
    tx.execute(
        "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?7, ?8, ?9)
         ON CONFLICT(path) DO UPDATE SET
           title=excluded.title,
           summary=excluded.summary,
           content_hash=excluded.content_hash,
           word_count=excluded.word_count,
           updated_at=excluded.updated_at,
           indexed_at=excluded.indexed_at,
           deleted_at=NULL",
        params![note_id, rel_path, title, summary, hash, word_count, now, now, now],
    )?;

    // Re-fetch actual id and created_at in case of conflict (the existing row keeps its values)
    let (actual_id, actual_created_at): (String, String) = tx.query_row(
        "SELECT id, created_at FROM notes WHERE path = ?1",
        params![rel_path],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    // 2. Rebuild note_tags
    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", params![actual_id])?;
    for tag_name in &fm_tags {
        upsert_tag_and_link(&tx, &actual_id, tag_name, "front_matter", &now)?;
    }

    // 3. Rebuild tag_occurrences
    tx.execute(
        "DELETE FROM tag_occurrences WHERE note_id = ?1",
        params![actual_id],
    )?;
    for (index, occurrence) in inline_occurrences.iter().enumerate() {
        insert_tag_occurrence(&tx, &actual_id, occurrence, (index + 1) as i64, &now)?;
    }

    prune_orphan_tags(&tx)?;

    // 4. Rebuild links
    tx.execute("DELETE FROM links WHERE source_note_id = ?1", params![actual_id])?;
    for raw in &raw_links {
        let link_id = Ulid::new().to_string();
        let target_note_id = resolve_link_target(&tx, &raw.target_raw)?;
        let resolved: i64 = if target_note_id.is_some() { 1 } else { 0 };
        tx.execute(
            "INSERT INTO links (id, source_note_id, target_note_id, target_raw, display_text, link_type, anchor, resolved, start_offset, end_offset, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                link_id, actual_id, target_note_id, raw.target_raw, raw.display_text,
                raw.link_type, raw.anchor, resolved,
                raw.start_offset as i64, raw.end_offset as i64, now, now
            ],
        )?;
    }

    // 5. Rebuild FTS
    tx.execute("DELETE FROM note_fts WHERE note_id = ?1", params![actual_id])?;
    tx.execute(
        "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, ?4)",
        params![actual_id, title, summary.as_deref().unwrap_or(""), parsed.body],
    )?;

    reconcile_links_for_note(&tx, &actual_id, &now)?;

    tx.commit()?;

    // suppress unused warning for root parameter (used by callers for context)
    let _ = root;

    Ok(Note {
        id: actual_id,
        path: rel_path.to_string(),
        title,
        summary,
        content_hash: hash,
        word_count,
        created_at: actual_created_at,
        updated_at: now.clone(),
        indexed_at: now,
        deleted_at: None,
    })
}


fn resolve_link_target(
    tx: &rusqlite::Transaction,
    target_raw: &str,
) -> AppResult<Option<String>> {
    let exact = tx
        .query_row(
            "SELECT id FROM notes WHERE title = ?1 AND deleted_at IS NULL LIMIT 1",
            params![target_raw],
            |row| row.get(0),
        )
        .optional()?;

    if exact.is_some() {
        return Ok(exact);
    }

    Ok(tx
        .query_row(
            "SELECT id FROM notes WHERE lower(title) = lower(?1) AND deleted_at IS NULL LIMIT 1",
            params![target_raw],
            |row| row.get(0),
        )
        .optional()?)
}

fn reconcile_links_for_note(
    tx: &rusqlite::Transaction,
    note_id: &str,
    now: &str,
) -> AppResult<()> {
    tx.execute(
        "UPDATE links
         SET target_note_id = NULL, resolved = 0, updated_at = ?1
         WHERE target_note_id = ?2
           AND NOT EXISTS (
             SELECT 1
             FROM notes n
             WHERE n.id = ?2
               AND n.deleted_at IS NULL
               AND (n.title = links.target_raw OR lower(n.title) = lower(links.target_raw))
           )",
        params![now, note_id],
    )?;

    let links = {
        let mut stmt = tx.prepare(
            "SELECT id, target_raw
             FROM links
             WHERE resolved = 0 OR target_note_id IS NULL OR target_note_id = ?1",
        )?;
        let rows = stmt.query_map(params![note_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for (link_id, target_raw) in links {
        let target_note_id = resolve_link_target(tx, &target_raw)?;
        let resolved = if target_note_id.is_some() { 1 } else { 0 };
        tx.execute(
            "UPDATE links
             SET target_note_id = ?1, resolved = ?2, updated_at = ?3
             WHERE id = ?4",
            params![target_note_id, resolved, now, link_id],
        )?;
    }

    Ok(())
}

fn upsert_tag(tx: &rusqlite::Transaction, tag_name: &str, now: &str) -> AppResult<String> {
    let normalized = tag_name.to_lowercase();
    let tag_id = Ulid::new().to_string();
    tx.execute(
        "INSERT INTO tags (id, name, normalized_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(normalized_name) DO UPDATE SET updated_at=excluded.updated_at",
        params![tag_id, tag_name, normalized, now, now],
    )?;

    tx.query_row(
        "SELECT id FROM tags WHERE normalized_name = ?1",
        params![normalized],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

fn upsert_tag_and_link(
    tx: &rusqlite::Transaction,
    note_id: &str,
    tag_name: &str,
    source: &str,
    now: &str,
) -> AppResult<()> {
    let actual_tag_id = upsert_tag(tx, tag_name, now)?;
    tx.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id, source) VALUES (?1, ?2, ?3)",
        params![note_id, actual_tag_id, source],
    )?;
    Ok(())
}

fn insert_tag_occurrence(
    tx: &rusqlite::Transaction,
    note_id: &str,
    occurrence: &InlineTagOccurrence,
    occurrence_order: i64,
    now: &str,
) -> AppResult<()> {
    let tag_id = upsert_tag(tx, &occurrence.tag_name, now)?;
    tx.execute(
        "INSERT INTO tag_occurrences (id, note_id, tag_id, source, line_start, line_end, heading_context, context_snippet, occurrence_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            Ulid::new().to_string(),
            note_id,
            tag_id,
            "inline",
            occurrence.line_start,
            occurrence.line_end,
            occurrence.heading_context.as_deref(),
            &occurrence.context_snippet,
            occurrence_order,
            now,
            now,
        ],
    )?;
    Ok(())
}

fn prune_orphan_tags(tx: &rusqlite::Transaction) -> AppResult<()> {
    tx.execute(
        "DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM note_tags WHERE note_tags.tag_id = tags.id)",
        [],
    )?;
    Ok(())
}

/// 从文件路径重新索引（供 watcher 调用）
pub fn reindex_from_path(conn: &Connection, root: &PathBuf, rel_path: &str) -> AppResult<Note> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let abs = resolve_kb_path(root, &rel_path)?;
    let content = std::fs::read_to_string(&abs)
        .map_err(|e| AppError::Io(e.to_string()))?;
    index_note_full(conn, root, &rel_path, &content)
}

/// 软删除一篇笔记并清理派生索引（供 watcher 处理外部删除/重命名旧路径）。
pub fn mark_note_deleted_by_path(conn: &Connection, rel_path: &str) -> AppResult<()> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;

    let note_id: Option<String> = tx
        .query_row(
            "SELECT id FROM notes WHERE path = ?1 AND deleted_at IS NULL",
            params![rel_path],
            |row| row.get(0),
        )
        .optional()?;

    let Some(note_id) = note_id else {
        tx.commit()?;
        return Ok(());
    };

    tx.execute(
        "UPDATE notes SET deleted_at = ?1, indexed_at = ?1 WHERE id = ?2",
        params![now, note_id],
    )?;
    tx.execute("DELETE FROM note_fts WHERE note_id = ?1", params![note_id])?;
    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", params![note_id])?;
    tx.execute("DELETE FROM tag_occurrences WHERE note_id = ?1", params![note_id])?;
    prune_orphan_tags(&tx)?;
    tx.execute("DELETE FROM links WHERE source_note_id = ?1", params![note_id])?;
    tx.execute(
        "UPDATE links
         SET target_note_id = NULL, resolved = 0, updated_at = ?1
         WHERE target_note_id = ?2",
        params![now, note_id],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn reconcile_all_links(conn: &Connection) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;

    let links = {
        let mut stmt = tx.prepare("SELECT id, target_raw FROM links ORDER BY id")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for (link_id, target_raw) in links {
        let target_note_id = resolve_link_target(&tx, &target_raw)?;
        let resolved = if target_note_id.is_some() { 1 } else { 0 };
        tx.execute(
            "UPDATE links
             SET target_note_id = ?1, resolved = ?2, updated_at = ?3
             WHERE id = ?4",
            params![target_note_id, resolved, now, link_id],
        )?;
    }

    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{index_note_full, mark_note_deleted_by_path, reconcile_all_links};
    use crate::infrastructure::db::open_and_migrate;
    use tempfile::TempDir;

    fn setup_index_db() -> (TempDir, rusqlite::Connection) {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        (dir, conn)
    }

    fn link_state(
        conn: &rusqlite::Connection,
        source_title: &str,
        target_raw: &str,
    ) -> (Option<String>, i64) {
        conn.query_row(
            "SELECT l.target_note_id, l.resolved
             FROM links l
             JOIN notes n ON n.id = l.source_note_id
             WHERE n.title = ?1 AND l.target_raw = ?2",
            rusqlite::params![source_title, target_raw],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    fn occurrence_rows(
        conn: &rusqlite::Connection,
        note_title: &str,
        tag_name: &str,
    ) -> Vec<(i64, i64, Option<String>, String, i64)> {
        let mut stmt = conn
            .prepare(
                "SELECT o.line_start, o.line_end, o.heading_context, o.context_snippet, o.occurrence_order
                 FROM tag_occurrences o
                 JOIN notes n ON n.id = o.note_id
                 JOIN tags t ON t.id = o.tag_id
                 WHERE n.title = ?1 AND t.normalized_name = ?2
                 ORDER BY o.occurrence_order",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![note_title, tag_name.to_lowercase()], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    }

    #[test]
    fn indexing_later_target_resolves_existing_unresolved_wiki_link() {
        let (root, conn) = setup_index_db();

        index_note_full(&conn, root.path(), "notes/a.md", "# A\n\n[[B]]").unwrap();
        assert_eq!(link_state(&conn, "A", "B"), (None, 0));

        let b = index_note_full(&conn, root.path(), "notes/b.md", "# B\n\n").unwrap();

        assert_eq!(link_state(&conn, "A", "B"), (Some(b.id), 1));
    }

    #[test]
    fn renaming_target_unresolves_old_title_and_resolves_new_title() {
        let (root, conn) = setup_index_db();

        index_note_full(&conn, root.path(), "notes/a.md", "# A\n\n[[B]]").unwrap();
        index_note_full(&conn, root.path(), "notes/c.md", "# C Source\n\n[[C]]").unwrap();
        let target = index_note_full(&conn, root.path(), "notes/target.md", "# B\n\n").unwrap();

        assert_eq!(link_state(&conn, "A", "B"), (Some(target.id.clone()), 1));
        assert_eq!(link_state(&conn, "C Source", "C"), (None, 0));

        let renamed = index_note_full(&conn, root.path(), "notes/target.md", "# C\n\n").unwrap();

        assert_eq!(renamed.id, target.id);
        assert_eq!(link_state(&conn, "A", "B"), (None, 0));
        assert_eq!(link_state(&conn, "C Source", "C"), (Some(renamed.id), 1));
    }

    #[test]
    fn reconcile_all_links_recomputes_links_from_current_notes() {
        let (root, conn) = setup_index_db();

        index_note_full(&conn, root.path(), "notes/source.md", "# Source\n\n[[Target]]").unwrap();
        let target = index_note_full(&conn, root.path(), "notes/target.md", "# Target\n\n").unwrap();

        conn.execute(
            "UPDATE links SET target_note_id = NULL, resolved = 0 WHERE target_raw = 'Target'",
            [],
        )
        .unwrap();
        assert_eq!(link_state(&conn, "Source", "Target"), (None, 0));

        reconcile_all_links(&conn).unwrap();

        assert_eq!(link_state(&conn, "Source", "Target"), (Some(target.id), 1));
    }

    #[test]
    fn index_note_full_rebuilds_tag_occurrences() {
        let (root, conn) = setup_index_db();

        index_note_full(
            &conn,
            root.path(),
            "notes/source.md",
            "---\ntags:\n  - 项目报告\n---\n\n# Title\n\nAlpha [[#项目报告]] here.\n```md\n[[#项目报告]]\n```\n## Section\nBeta [[#项目报告]] again.",
        )
        .unwrap();

        let occurrences = occurrence_rows(&conn, "Title", "项目报告");
        assert_eq!(occurrences.len(), 2);
        assert_eq!(occurrences[0], (8, 8, Some("Title".to_string()), "Alpha [[#项目报告]] here.".to_string(), 1));
        assert_eq!(occurrences[1], (13, 13, Some("Section".to_string()), "Beta [[#项目报告]] again.".to_string(), 2));
    }

    #[test]
    fn index_note_full_stores_file_relative_occurrence_lines_with_front_matter() {
        let (root, conn) = setup_index_db();

        index_note_full(
            &conn,
            root.path(),
            "notes/source.md",
            "---\ntitle: Demo\ntags:\n  - 项目报告\n---\n\n# Title\n\nAlpha([[#项目报告]]) here.",
        )
        .unwrap();

        let occurrences = occurrence_rows(&conn, "Demo", "项目报告");
        assert_eq!(occurrences.len(), 1);
        assert_eq!(occurrences[0], (9, 9, Some("Title".to_string()), "Alpha([[#项目报告]]) here.".to_string(), 1));
    }

    #[test]
    fn index_note_full_prunes_orphan_tags_after_rebuild() {
        let (root, conn) = setup_index_db();

        index_note_full(
            &conn,
            root.path(),
            "notes/source.md",
            "---\ntags:\n  - 项目报告\n---\n\n# Title\n\n真实标签 [[#项目报告]]",
        )
        .unwrap();

        let initial_tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE normalized_name = '项目报告'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(initial_tag_count, 1);

        index_note_full(
            &conn,
            root.path(),
            "notes/source.md",
            "# Title\n\n这里已经没有标签了",
        )
        .unwrap();

        let remaining_tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE normalized_name = '项目报告'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining_tag_count, 0);
    }

    #[test]
    fn restoring_deleted_target_clears_deleted_at_and_resolves_incoming_link() {
        let (root, conn) = setup_index_db();

        index_note_full(&conn, root.path(), "notes/a.md", "# A\n\n[[B]]").unwrap();
        let original = index_note_full(&conn, root.path(), "notes/b.md", "# B\n\n").unwrap();
        assert_eq!(link_state(&conn, "A", "B"), (Some(original.id.clone()), 1));

        mark_note_deleted_by_path(&conn, "notes/b.md").unwrap();
        assert_eq!(link_state(&conn, "A", "B"), (None, 0));

        let restored = index_note_full(&conn, root.path(), "notes/b.md", "# B\n\nRestored").unwrap();

        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM notes WHERE id = ?1",
                rusqlite::params![restored.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(restored.id, original.id);
        assert_eq!(deleted_at, None);
        assert_eq!(link_state(&conn, "A", "B"), (Some(restored.id), 1));
    }

    #[test]
    fn mark_note_deleted_clears_derived_indexes() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();

        conn.execute(
            "INSERT INTO notes (id,path,title,content_hash,word_count,front_matter_json,created_at,updated_at,indexed_at)
             VALUES ('target','notes/target.md','Target','h',0,'{}','now','now','now')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO notes (id,path,title,content_hash,word_count,front_matter_json,created_at,updated_at,indexed_at)
             VALUES ('source','notes/source.md','Source','h',0,'{}','now','now','now')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES ('target','Target','','body')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO tags (id,name,normalized_name,created_at,updated_at) VALUES ('tag','tag','tag','now','now')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_tags (note_id, tag_id, source) VALUES ('target','tag','inline')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO tag_occurrences (id, note_id, tag_id, source, line_start, line_end, heading_context, context_snippet, occurrence_order, created_at, updated_at)
             VALUES ('occ-1','target','tag','inline',2,2,'Target','See #tag',1,'now','now')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO links (id,source_note_id,target_note_id,target_raw,link_type,resolved,created_at,updated_at)
             VALUES ('incoming','source','target','Target','wiki',1,'now','now')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO links (id,source_note_id,target_raw,link_type,resolved,created_at,updated_at)
             VALUES ('outgoing','target','Other','wiki',0,'now','now')",
            [],
        ).unwrap();

        mark_note_deleted_by_path(&conn, "notes/target.md").unwrap();

        let deleted_at: Option<String> = conn
            .query_row("SELECT deleted_at FROM notes WHERE id = 'target'", [], |row| row.get(0))
            .unwrap();
        assert!(deleted_at.is_some());

        let fts_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_fts WHERE note_id = 'target'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fts_count, 0);

        let tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_tags WHERE note_id = 'target'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tag_count, 0);

        let occurrence_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tag_occurrences WHERE note_id = 'target'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(occurrence_count, 0);

        let outgoing_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM links WHERE source_note_id = 'target'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(outgoing_count, 0);

        let incoming: (Option<String>, i64) = conn
            .query_row(
                "SELECT target_note_id, resolved FROM links WHERE id = 'incoming'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(incoming, (None, 0));

        assert!(mark_note_deleted_by_path(&conn, "../outside.md").is_err());
    }
}

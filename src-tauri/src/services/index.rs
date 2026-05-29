use crate::domain::note::Note;
use crate::error::{AppError, AppResult};
use crate::infrastructure::hash::sha256_str;
use crate::infrastructure::markdown::{extract_inline_tags, extract_links, parse_note};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use ulid::Ulid;

/// 对一篇笔记执行全量索引：upsert notes + 重建 note_tags + links + note_fts
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
    let inline_tags = extract_inline_tags(&parsed.body);
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
           indexed_at=excluded.indexed_at",
        params![note_id, rel_path, title, summary, hash, word_count, now, now, now],
    )?;

    // Re-fetch actual id in case of conflict (the existing row keeps its id)
    let actual_id: String = tx.query_row(
        "SELECT id FROM notes WHERE path = ?1",
        params![rel_path],
        |r| r.get(0),
    )?;

    // 2. Rebuild note_tags
    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", params![actual_id])?;
    for tag_name in &fm_tags {
        upsert_tag_and_link(&tx, &actual_id, tag_name, "front_matter", &now)?;
    }
    for tag_name in &inline_tags {
        if !fm_tags.contains(tag_name) {
            upsert_tag_and_link(&tx, &actual_id, tag_name, "inline", &now)?;
        }
    }

    // 3. Rebuild links
    tx.execute("DELETE FROM links WHERE source_note_id = ?1", params![actual_id])?;
    for raw in &raw_links {
        let link_id = Ulid::new().to_string();
        // Resolve target_note_id by title match
        let target_note_id: Option<String> = tx
            .query_row(
                "SELECT id FROM notes WHERE title = ?1 AND deleted_at IS NULL LIMIT 1",
                params![raw.target_raw],
                |r| r.get(0),
            )
            .ok()
            .or_else(|| {
                // case-insensitive fallback
                tx.query_row(
                    "SELECT id FROM notes WHERE lower(title) = lower(?1) AND deleted_at IS NULL LIMIT 1",
                    params![raw.target_raw],
                    |r| r.get(0),
                ).ok()
            });
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

    // 4. Rebuild FTS
    tx.execute("DELETE FROM note_fts WHERE note_id = ?1", params![actual_id])?;
    tx.execute(
        "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, ?4)",
        params![actual_id, title, summary.as_deref().unwrap_or(""), parsed.body],
    )?;

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
        created_at: now.clone(),
        updated_at: now.clone(),
        indexed_at: now,
        deleted_at: None,
    })
}

fn upsert_tag_and_link(
    tx: &rusqlite::Transaction,
    note_id: &str,
    tag_name: &str,
    source: &str,
    now: &str,
) -> AppResult<()> {
    let normalized = tag_name.to_lowercase();
    let tag_id = Ulid::new().to_string();
    tx.execute(
        "INSERT INTO tags (id, name, normalized_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(normalized_name) DO UPDATE SET updated_at=excluded.updated_at",
        params![tag_id, tag_name, normalized, now, now],
    )?;
    let actual_tag_id: String = tx.query_row(
        "SELECT id FROM tags WHERE normalized_name = ?1",
        params![normalized],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id, source) VALUES (?1, ?2, ?3)",
        params![note_id, actual_tag_id, source],
    )?;
    Ok(())
}

/// 从文件路径重新索引（供 watcher 调用）
pub fn reindex_from_path(conn: &Connection, root: &PathBuf, rel_path: &str) -> AppResult<Note> {
    let abs = root.join(rel_path);
    let content = std::fs::read_to_string(&abs)
        .map_err(|e| AppError::Io(e.to_string()))?;
    index_note_full(conn, root, rel_path, &content)
}

use crate::domain::tag::{TagContext, TagContextItem};
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{atomic_write, resolve_kb_path};
use crate::infrastructure::markdown::remove_tag_from_note_content;
use crate::services::index::index_note_full;
use crate::state::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use tauri::State;

const TAG_CONTEXT_LIMIT: i64 = 5;

pub fn get_tag_context_in_conn(conn: &Connection, tag_id: &str) -> AppResult<TagContext> {
    let tag_summary: Option<(String, i64)> = conn
        .query_row(
            "SELECT t.name, COUNT(DISTINCT n.id)
             FROM tags t
             LEFT JOIN note_tags nt ON nt.tag_id = t.id
             LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
             WHERE t.id = ?1
             GROUP BY t.id",
            [tag_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let (tag_name, total_notes) = tag_summary
        .ok_or_else(|| AppError::NotFound(format!("tag not found: {tag_id}")))?;

        let mut stmt = conn.prepare(
                "WITH latest_notes AS (
                         SELECT n.id,
                                        n.path,
                                        n.title,
                                        n.updated_at,
                                        EXISTS(
                                                SELECT 1
                                                FROM note_tags nt_front_matter
                                                WHERE nt_front_matter.note_id = n.id
                                                    AND nt_front_matter.tag_id = ?1
                                                    AND nt_front_matter.source = 'front_matter'
                                        ) AS has_front_matter
                         FROM notes n
                         WHERE n.deleted_at IS NULL
                             AND EXISTS (
                                     SELECT 1
                                     FROM note_tags nt
                                     WHERE nt.note_id = n.id AND nt.tag_id = ?1
                             )
                         ORDER BY n.updated_at DESC, n.path ASC
                         LIMIT ?2
                 )
                 SELECT ln.id,
                                ln.path,
                                ln.title,
                                ln.updated_at,
                                o.source,
                                o.occurrence_order,
                                o.line_start,
                                o.line_end,
                                o.heading_context,
                                o.context_snippet,
                                ln.has_front_matter
                 FROM latest_notes ln
                 LEFT JOIN tag_occurrences o
                     ON o.note_id = ln.id AND o.tag_id = ?1
                 ORDER BY ln.updated_at DESC,
                                    ln.path ASC,
                                    CASE o.source WHEN 'inline' THEN 0 ELSE 1 END,
                                    COALESCE(o.occurrence_order, 0) ASC",
        )?;

    let mut rows = stmt.query(params![tag_id, TAG_CONTEXT_LIMIT])?;
    let mut items = Vec::new();

    while let Some(row) = rows.next()? {
        let note_id: String = row.get(0)?;
        let note_path: String = row.get(1)?;
        let note_title: String = row.get(2)?;
        let note_updated_at: String = row.get(3)?;
        let source: Option<String> = row.get(4)?;

        let item = if let Some(source) = source {
            TagContextItem {
                note_id,
                note_path,
                note_title,
                note_updated_at,
                source,
                occurrence_order: row.get(5)?,
                line_start: row.get(6)?,
                line_end: row.get(7)?,
                heading_context: row.get(8)?,
                context_snippet: row.get(9)?,
            }
        } else if row.get::<_, bool>(10)? {
            TagContextItem {
                note_id,
                note_path,
                note_title,
                note_updated_at,
                source: "front_matter".to_string(),
                occurrence_order: 0,
                line_start: 1,
                line_end: 1,
                heading_context: None,
                context_snippet: "Front Matter 标签".to_string(),
            }
        } else {
            return Err(AppError::Database(format!(
                "missing representative occurrence for note {note_id} and tag {tag_id}"
            )));
        };

        items.push(item);
    }

    Ok(TagContext {
        tag_id: tag_id.to_string(),
        tag_name,
        total_notes,
        visible_count: items.len() as i64,
        has_more: total_notes > TAG_CONTEXT_LIMIT,
        items,
    })
}

pub fn delete_tag_in_conn(conn: &Connection, root: &Path, tag_id: &str) -> AppResult<()> {
    let tag_name: String = conn
        .query_row(
            "SELECT name FROM tags WHERE id = ?1",
            [tag_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("tag not found: {tag_id}")))?;

    let mut stmt = conn.prepare(
        "SELECT DISTINCT n.path
         FROM notes n
         JOIN note_tags nt ON nt.note_id = n.id
         WHERE nt.tag_id = ?1 AND n.deleted_at IS NULL
         ORDER BY n.path",
    )?;
    let note_paths = stmt
        .query_map([tag_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    for note_path in note_paths {
        let abs_path = resolve_kb_path(root, &note_path)?;
        let original_content = std::fs::read_to_string(&abs_path)?;
        let updated_content = remove_tag_from_note_content(&original_content, &tag_name)?;

        if updated_content != original_content {
            atomic_write(&abs_path, &updated_content)?;
            index_note_full(conn, root, &note_path, &updated_content)?;
        }
    }

    conn.execute(
        "DELETE FROM tags
         WHERE id = ?1
           AND NOT EXISTS (SELECT 1 FROM note_tags WHERE tag_id = ?1)",
        params![tag_id],
    )?;

    Ok(())
}

pub fn delete_tag_service(state: &State<AppState>, tag_id: &str) -> AppResult<()> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    delete_tag_in_conn(conn, &root, tag_id)
}

pub fn get_tag_context_service(state: &State<AppState>, tag_id: &str) -> AppResult<TagContext> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    get_tag_context_in_conn(conn, tag_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::open_and_migrate;
    use crate::services::index::index_note_full;
    use tempfile::TempDir;

    fn setup_tag_delete_db() -> (TempDir, rusqlite::Connection) {
        let root = TempDir::new().unwrap();
        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();
        (root, conn)
    }

    fn set_note_updated_at(conn: &Connection, path: &str, updated_at: &str) {
        conn.execute(
            "UPDATE notes SET updated_at = ?1 WHERE path = ?2",
            params![updated_at, path],
        )
        .unwrap();
    }

    fn tag_id_by_name(conn: &Connection, normalized_name: &str) -> String {
        conn.query_row(
            "SELECT id FROM tags WHERE normalized_name = ?1",
            [normalized_name],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn delete_tag_in_conn_removes_tag_from_notes_and_prunes_it_from_db() {
        let (root, conn) = setup_tag_delete_db();
        let tagged_content = [
            "---",
            "title: Tagged",
            "tags:",
            "  - 项目报告",
            "  - 阶段一",
            "---",
            "",
            "# Tagged",
            "",
            "正文里还有 #项目报告 标签",
        ]
        .join("\n");
        let untouched_content = "# Untouched\n\n这里只有 #阶段一";

        std::fs::write(root.path().join("notes/tagged.md"), &tagged_content).unwrap();
        std::fs::write(root.path().join("notes/untouched.md"), untouched_content).unwrap();

        index_note_full(&conn, root.path(), "notes/tagged.md", &tagged_content).unwrap();
        index_note_full(&conn, root.path(), "notes/untouched.md", untouched_content).unwrap();

        let target_tag_id: String = conn
            .query_row(
                "SELECT id FROM tags WHERE normalized_name = '项目报告'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        delete_tag_in_conn(&conn, root.path(), &target_tag_id).unwrap();

        let updated_tagged = std::fs::read_to_string(root.path().join("notes/tagged.md")).unwrap();
        let updated_untouched = std::fs::read_to_string(root.path().join("notes/untouched.md")).unwrap();
        assert!(!updated_tagged.contains("项目报告"));
        assert!(updated_tagged.contains("阶段一"));
        assert_eq!(updated_untouched, untouched_content);

        let deleted_tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE normalized_name = '项目报告'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(deleted_tag_count, 0);

        let remaining_tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.normalized_name = '阶段一'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining_tag_count, 2);
    }

        #[test]
        fn get_tag_context_in_conn_returns_all_occurrences_within_latest_five_notes() {
            let (root, conn) = setup_tag_delete_db();
            let notes = [
                (
                    "notes/newest-inline.md",
                    "# Newest Inline\n\nFirst #项目报告 hit.\nLater #项目报告 again.",
                    "2026-06-01T09:00:00Z",
                ),
                (
                    "notes/front-matter-only.md",
                    "---\ntitle: Front Matter Only\ntags:\n  - 项目报告\n---\n\nNo inline tag here.",
                    "2026-06-01T08:00:00Z",
                ),
                (
                    "notes/recent-three.md",
                    "# Recent Three\n\nAlpha #项目报告.",
                    "2026-06-01T07:00:00Z",
                ),
                (
                    "notes/recent-four.md",
                    "# Recent Four\n\nAlpha #项目报告.",
                    "2026-06-01T06:00:00Z",
                ),
                (
                    "notes/recent-five.md",
                    "# Recent Five\n\nAlpha #项目报告.",
                    "2026-06-01T05:00:00Z",
                ),
                (
                    "notes/oldest-six.md",
                    "# Oldest Six\n\nAlpha #项目报告.",
                    "2026-06-01T04:00:00Z",
                ),
            ];

            for (path, content, updated_at) in notes {
                std::fs::write(root.path().join(path), content).unwrap();
                index_note_full(&conn, root.path(), path, content).unwrap();
                set_note_updated_at(&conn, path, updated_at);
            }

            let tag_id = tag_id_by_name(&conn, "项目报告");

            let context = get_tag_context_in_conn(&conn, &tag_id).unwrap();

            assert_eq!(context.tag_id, tag_id);
            assert_eq!(context.tag_name, "项目报告");
            assert_eq!(context.total_notes, 6);
            assert_eq!(context.visible_count, 6);
            assert!(context.has_more);
            assert_eq!(context.items.len(), 6);

            let titles = context
                .items
                .iter()
                .map(|item| item.note_title.as_str())
                .collect::<Vec<_>>();
            assert_eq!(
                titles,
                vec![
                    "Newest Inline",
                    "Newest Inline",
                    "Front Matter Only",
                    "Recent Three",
                    "Recent Four",
                    "Recent Five",
                ]
            );

            let newest = &context.items[0];
            assert_eq!(newest.source, "inline");
            assert_eq!(newest.occurrence_order, 1);
            assert_eq!(newest.line_start, 3);
            assert_eq!(newest.line_end, 3);
            assert_eq!(newest.heading_context.as_deref(), Some("Newest Inline"));
            assert_eq!(newest.context_snippet, "First #项目报告 hit.");

            let newest_second = &context.items[1];
            assert_eq!(newest_second.source, "inline");
            assert_eq!(newest_second.occurrence_order, 2);
            assert_eq!(newest_second.line_start, 4);
            assert_eq!(newest_second.line_end, 4);
            assert_eq!(newest_second.context_snippet, "Later #项目报告 again.");

            let front_matter = &context.items[2];
            assert_eq!(front_matter.source, "front_matter");
            assert_eq!(front_matter.occurrence_order, 0);
            assert_eq!(front_matter.line_start, 1);
            assert_eq!(front_matter.line_end, 1);
            assert_eq!(front_matter.heading_context, None);
            assert_eq!(front_matter.context_snippet, "Front Matter 标签");

            assert!(context.items.iter().all(|item| item.note_title != "Oldest Six"));
        }
}
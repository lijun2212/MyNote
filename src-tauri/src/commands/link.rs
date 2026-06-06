use crate::domain::link::{LinkItem, NoteLinks};
use crate::domain::note::Note;
use crate::error::AppError;
use crate::state::AppState;
use rusqlite::OptionalExtension;
use std::path::Path;
use tauri::State;

#[derive(Clone, Debug, PartialEq, Eq)]
struct LinkTargetContext {
    note_id: String,
    note_title: String,
    note_path: String,
}

fn build_link_href(target_raw: &str, anchor: Option<&str>) -> String {
    let anchor_suffix = anchor.map(|value| format!("#{value}")).unwrap_or_default();
    format!("{target_raw}{anchor_suffix}")
}

fn parse_atx_heading_text(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let marker_count = trimmed.chars().take_while(|ch| *ch == '#').count();
    if marker_count == 0 || marker_count > 6 {
        return None;
    }

    let after_markers = &trimmed[marker_count..];
    if !after_markers.starts_with(char::is_whitespace) {
        return None;
    }

    Some(after_markers.trim().trim_end_matches('#').trim_end())
}

fn parse_setext_heading_text<'a>(lines: &'a [&'a str], index: usize) -> Option<&'a str> {
    let current = lines.get(index)?.trim();
    if current.is_empty() {
        return None;
    }

    let underline = lines.get(index + 1)?.trim();
    let is_heading_underline = !underline.is_empty()
        && (underline.chars().all(|ch| ch == '=') || underline.chars().all(|ch| ch == '-'));

    if is_heading_underline {
        Some(current)
    } else {
        None
    }
}

fn normalize_heading_text(text: &str) -> String {
    text.trim().to_lowercase()
}

fn slugify_heading_text(text: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for ch in text.trim().chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&ch) {
            slug.push(ch);
            last_was_dash = false;
            continue;
        }

        if (ch.is_whitespace() || ch == '-' || ch == '_') && !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

fn find_anchor_line_number(content: &str, anchor: &str) -> Option<i64> {
    let normalized_anchor = normalize_heading_text(anchor);
    let slug_anchor = slugify_heading_text(anchor);
    let lines: Vec<&str> = content.lines().collect();

    for (index, line) in lines.iter().enumerate() {
        if let Some(heading_text) = parse_atx_heading_text(line) {
            let normalized_heading = normalize_heading_text(heading_text);
            let slug_heading = slugify_heading_text(heading_text);
            if normalized_heading == normalized_anchor || (!slug_anchor.is_empty() && slug_heading == slug_anchor) {
                return Some(index as i64 + 1);
            }
        }

        if let Some(heading_text) = parse_setext_heading_text(&lines, index) {
            let normalized_heading = normalize_heading_text(heading_text);
            let slug_heading = slugify_heading_text(heading_text);
            if normalized_heading == normalized_anchor || (!slug_anchor.is_empty() && slug_heading == slug_anchor) {
                return Some(index as i64 + 1);
            }
        }
    }

    None
}

fn resolve_anchor_target_line(kb_root: &Path, note_path: &str, anchor: Option<&str>) -> Option<i64> {
    let anchor = anchor?.trim();
    if anchor.is_empty() {
        return None;
    }

    let content = std::fs::read_to_string(kb_root.join(note_path)).ok()?;
    find_anchor_line_number(&content, anchor)
}

fn line_number_for_offset(content: &str, offset: i64) -> Option<i64> {
    if offset < 0 {
        return None;
    }

    let clamped = usize::min(offset as usize, content.len());
    let safe_end = if content.is_char_boundary(clamped) {
        clamped
    } else {
        content
            .char_indices()
            .take_while(|(index, _)| *index < clamped)
            .last()
            .map(|(index, ch)| index + ch.len_utf8())
            .unwrap_or(0)
    };

    Some(content[..safe_end].bytes().filter(|byte| *byte == b'\n').count() as i64 + 1)
}

fn resolve_source_line_range(
    kb_root: &Path,
    note_path: &str,
    start_offset: Option<i64>,
    end_offset: Option<i64>,
) -> Option<(i64, i64)> {
    let start_offset = start_offset?;
    let end_offset = end_offset?;
    if note_path.trim().is_empty() {
        return None;
    }

    let content = std::fs::read_to_string(kb_root.join(note_path)).ok()?;
    let line_start = line_number_for_offset(&content, start_offset)?;
    let inclusive_end_offset = end_offset.saturating_sub(1).max(start_offset);
    let line_end = line_number_for_offset(&content, inclusive_end_offset)?;
    Some((line_start, line_end))
}

fn resolve_outgoing_target_context(
    source_note: Option<&LinkTargetContext>,
    target_note_id: Option<&str>,
    target_note_title: Option<&str>,
    target_note_path: Option<&str>,
    target_raw: &str,
    anchor: Option<&str>,
) -> LinkTargetContext {
    let is_local_anchor = target_raw.trim().is_empty()
        && anchor.map(|value| !value.trim().is_empty()).unwrap_or(false);

    if is_local_anchor {
        if let Some(source_note) = source_note {
            return source_note.clone();
        }
    }

    LinkTargetContext {
        note_id: target_note_id.unwrap_or_default().to_string(),
        note_title: target_note_title.unwrap_or_default().to_string(),
        note_path: target_note_path.unwrap_or_default().to_string(),
    }
}

fn normalize_internal_markdown_target(target_raw: &str) -> Option<String> {
    let trimmed = target_raw.trim().trim_start_matches('/');
    if trimmed.is_empty() || trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return None;
    }

    if !trimmed.starts_with("notes/") || !trimmed.ends_with(".md") {
        return None;
    }

    Some(trimmed.to_string())
}

fn should_include_auto_link(
    link_type: &str,
    target_raw: &str,
    target_path: &str,
    anchor: Option<&str>,
) -> bool {
    match link_type {
        "external" | "wiki" => true,
        "markdown" => {
            let is_local_anchor = target_raw.trim().is_empty()
                && anchor.map(|value| !value.trim().is_empty()).unwrap_or(false);

            is_local_anchor
                || !target_path.trim().is_empty()
                || normalize_internal_markdown_target(target_raw).is_some()
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn get_note_links(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<NoteLinks, AppError> {
    let kb_root = state.kb_root_guard().clone();
    let db_guard = state.db_guard();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    let source_note = conn
        .query_row(
            "SELECT id, title, path FROM notes WHERE id = ?1 AND deleted_at IS NULL LIMIT 1",
            [&note_id],
            |row| {
                Ok(LinkTargetContext {
                    note_id: row.get(0)?,
                    note_title: row.get(1)?,
                    note_path: row.get(2)?,
                })
            },
        )
        .optional()?;

    let mut outgoing_stmt = conn.prepare(
        "SELECT l.id, l.target_note_id, n.title, n.path, l.display_text, l.target_raw, l.link_type, l.anchor, l.resolved, l.start_offset, l.end_offset
         FROM links l
         LEFT JOIN notes n ON n.id = l.target_note_id AND n.deleted_at IS NULL
         WHERE l.source_note_id = ?1
         ORDER BY l.resolved DESC, n.title, l.target_raw",
    )?;
    let outgoing = outgoing_stmt
        .query_map([&note_id], |row| {
            let target_note_id = row.get::<_, Option<String>>(1)?;
            let target_note_title = row.get::<_, Option<String>>(2)?;
            let target_note_path = row.get::<_, Option<String>>(3)?;
            let target_raw: String = row.get(5)?;
            let anchor = row.get::<_, Option<String>>(7)?;
            let source_line_range = kb_root
                .as_deref()
                .and_then(|root| resolve_source_line_range(root, source_note.as_ref()?.note_path.as_str(), row.get(9).ok(), row.get(10).ok()));
            let target_context = resolve_outgoing_target_context(
                source_note.as_ref(),
                target_note_id.as_deref(),
                target_note_title.as_deref(),
                target_note_path.as_deref(),
                &target_raw,
                anchor.as_deref(),
            );
            let target_line = kb_root
                .as_deref()
                .and_then(|root| (!target_context.note_path.is_empty()).then_some(root))
                .and_then(|root| resolve_anchor_target_line(root, &target_context.note_path, anchor.as_deref()));
            Ok(LinkItem {
                id: row.get(0)?,
                note_id: target_context.note_id,
                note_title: target_context.note_title,
                note_path: target_context.note_path,
                source_note_id: source_note.as_ref().map(|note| note.note_id.clone()).unwrap_or_default(),
                source_note_title: source_note.as_ref().map(|note| note.note_title.clone()).unwrap_or_default(),
                source_note_path: source_note.as_ref().map(|note| note.note_path.clone()).unwrap_or_default(),
                source_line_start: source_line_range.map(|(line_start, _)| line_start),
                source_line_end: source_line_range.map(|(_, line_end)| line_end),
                link_text: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                link_url: build_link_href(&target_raw, anchor.as_deref()),
                link_type: row.get(6)?,
                target_anchor: anchor,
                target_line_start: target_line,
                target_line_end: target_line,
                resolved: row.get::<_, i64>(8)? != 0,
            })
        })?
        .filter_map(|result| match result {
            Ok(link)
                if should_include_auto_link(
                    &link.link_type,
                    &link.link_url.split('#').next().unwrap_or_default(),
                    &link.note_path,
                    link.target_anchor.as_deref(),
                ) => Some(Ok(link)),
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut incoming_stmt = conn.prepare(
        "SELECT l.id, l.source_note_id, n.title, n.path, l.display_text, l.target_raw, l.link_type, l.anchor, l.resolved, l.start_offset, l.end_offset
         FROM links l
         JOIN notes n ON n.id = l.source_note_id AND n.deleted_at IS NULL
         WHERE l.target_note_id = ?1
         ORDER BY n.title",
    )?;
    let incoming = incoming_stmt
        .query_map([&note_id], |row| {
            let note_path: String = row.get(3)?;
            let target_raw: String = row.get(5)?;
            let anchor = row.get::<_, Option<String>>(7)?;
            let source_line_range = kb_root
                .as_deref()
                .and_then(|root| resolve_source_line_range(root, &note_path, row.get(9).ok(), row.get(10).ok()));
            let target_line = kb_root
                .as_deref()
                .and_then(|root| (!note_path.is_empty()).then_some(root))
                .and_then(|root| resolve_anchor_target_line(root, &note_path, anchor.as_deref()));
            Ok(LinkItem {
                id: row.get(0)?,
                note_id: row.get(1)?,
                note_title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                note_path,
                source_note_id: row.get(1)?,
                source_note_title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                source_note_path: row.get(3)?,
                source_line_start: source_line_range.map(|(line_start, _)| line_start),
                source_line_end: source_line_range.map(|(_, line_end)| line_end),
                link_text: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                link_url: build_link_href(&target_raw, anchor.as_deref()),
                link_type: row.get(6)?,
                target_anchor: anchor,
                target_line_start: target_line,
                target_line_end: target_line,
                resolved: row.get::<_, i64>(8)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(NoteLinks { outgoing, incoming })
}

#[cfg(test)]
mod tests {
    use super::{
        find_anchor_line_number,
        line_number_for_offset,
        normalize_internal_markdown_target,
        resolve_outgoing_target_context,
        should_include_auto_link,
        LinkTargetContext,
    };

    #[test]
    fn finds_anchor_line_for_plain_heading_text() {
        let content = "# 标题\n\n## 执行摘要\n内容";

        assert_eq!(find_anchor_line_number(content, "执行摘要"), Some(3));
    }

    #[test]
    fn finds_anchor_line_for_slugified_heading_text() {
        let content = "# Heading One\n\n## Section Title\n内容";

        assert_eq!(find_anchor_line_number(content, "section-title"), Some(3));
    }

    #[test]
    fn line_number_for_offset_handles_non_char_boundary_offsets() {
        assert_eq!(line_number_for_offset("第一行\n我好", 11), Some(2));
    }

    #[test]
    fn falls_back_to_source_note_for_local_anchor_links() {
        let source_note = LinkTargetContext {
            note_id: "note-source".to_string(),
            note_title: "源笔记".to_string(),
            note_path: "notes/source.md".to_string(),
        };

        let result = resolve_outgoing_target_context(
            Some(&source_note),
            None,
            None,
            None,
            "",
            Some("执行摘要"),
        );

        assert_eq!(result, source_note);
    }

    #[test]
    fn keeps_resolved_target_for_cross_note_links() {
        let source_note = LinkTargetContext {
            note_id: "note-source".to_string(),
            note_title: "源笔记".to_string(),
            note_path: "notes/source.md".to_string(),
        };

        let result = resolve_outgoing_target_context(
            Some(&source_note),
            Some("note-target"),
            Some("目标笔记"),
            Some("notes/target.md"),
            "notes/target.md",
            Some("执行摘要"),
        );

        assert_eq!(
            result,
            LinkTargetContext {
                note_id: "note-target".to_string(),
                note_title: "目标笔记".to_string(),
                note_path: "notes/target.md".to_string(),
            }
        );
    }

    #[test]
    fn accepts_only_notes_markdown_targets_as_auto_links() {
        assert_eq!(
            normalize_internal_markdown_target("notes/topic/demo.md"),
            Some("notes/topic/demo.md".to_string())
        );
        assert_eq!(normalize_internal_markdown_target("workflow/views/admin_views.py"), None);
    }

    #[test]
    fn excludes_unsupported_code_like_markdown_links_from_auto_links() {
        assert!(!should_include_auto_link(
            "markdown",
            "workflow/views/admin_views.py",
            "",
            None,
        ));
        assert!(!should_include_auto_link(
            "asset",
            "images/diagram.png",
            "",
            None,
        ));
        assert!(should_include_auto_link(
            "markdown",
            "notes/topic/demo.md",
            "",
            None,
        ));
        assert!(should_include_auto_link(
            "markdown",
            "",
            "notes/current.md",
            Some("结论"),
        ));
    }
}

#[tauri::command]
pub async fn get_note_by_title(
    state: State<'_, AppState>,
    title: String,
) -> Result<Option<Note>, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let mut stmt = conn.prepare(
        "SELECT id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at
         FROM notes
         WHERE title = ?1 AND deleted_at IS NULL
         LIMIT 1",
    )?;

    let result = stmt
        .query_map([&title], |row| {
            Ok(Note {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                content_hash: row.get(4)?,
                word_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                indexed_at: row.get(8)?,
                deleted_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(result.into_iter().next())
}

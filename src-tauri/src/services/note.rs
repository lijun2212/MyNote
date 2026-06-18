use crate::domain::note::{
    CreateNoteInput, CreateNotebookInput, MarkdownImportItem, MarkdownImportMessage,
    MarkdownImportRequest, MarkdownImportResult, MarkdownImportSource, Note, NoteDetail,
    NoteOutlineItem, NoteTreeNode, RenameNotebookResult, SaveNoteInput, SaveNoteResult,
    InsertImageResult,
};
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{atomic_write, normalize_kb_relative_path, normalize_relative, resolve_kb_path, safe_filename};
use crate::infrastructure::markdown::{
    extract_links, extract_note_outline_blocks_from_content, render_note, FrontMatter,
};
use crate::services::index::{index_note_full, mark_note_deleted_by_path};
use crate::services::notebook_visual::{
    delete_notebook_visual, load_notebook_visuals, rename_notebook_visual,
    save_notebook_visual, visual_for_path, NotebookVisualMap,
};
use crate::state::AppState;
use arboard::Clipboard;
use image::{ColorType, ImageEncoder, codecs::png::PngEncoder};
use reqwest::Client;
use rusqlite::params;
use rusqlite::OptionalExtension;
use std::process::Command;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::State;
use ulid::Ulid;

const SUPPORTED_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

fn is_local_conflict_path(path: &str) -> bool {
    path.ends_with(".local-conflict.md")
}

fn build_conflict_backup_path(note_path: &str) -> String {
    let note_stem = note_path.trim_end_matches(".md").replace('/', "__");
    format!(
        ".mynote/conflicts/{}.local-conflict.{}.md",
        note_stem,
        Ulid::new()
    )
}

fn move_local_conflict_file_to_internal_storage(root: &Path, source_rel_path: &str) -> AppResult<String> {
    let source_abs = resolve_kb_path(root, source_rel_path)?;
    let target_rel = build_conflict_backup_path(source_rel_path);
    let target_abs = resolve_kb_path(root, &target_rel)?;

    if let Some(parent) = target_abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::rename(&source_abs, &target_abs).or_else(|_| {
        let content = std::fs::read_to_string(&source_abs)?;
        atomic_write(&target_abs, &content)?;
        std::fs::remove_file(&source_abs)?;
        Ok::<(), AppError>(())
    })?;

    Ok(target_rel)
}

pub fn migrate_local_conflict_files_in_root(conn: &rusqlite::Connection, root: &Path) -> AppResult<Vec<String>> {
    fn visit(root: &Path, dir: &Path, files: &mut Vec<String>) -> AppResult<()> {
        let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.path());

        for entry in entries {
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                visit(root, &path, files)?;
                continue;
            }

            let rel = normalize_relative(root, &path)?;
            if is_local_conflict_path(&rel) {
                files.push(rel);
            }
        }

        Ok(())
    }

    let notes_dir = root.join("notes");
    if !notes_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut legacy_conflicts = Vec::new();
    visit(root, &notes_dir, &mut legacy_conflicts)?;

    let mut migrated = Vec::new();
    for rel_path in legacy_conflicts {
        move_local_conflict_file_to_internal_storage(root, &rel_path)?;
        mark_note_deleted_by_path(conn, &rel_path)?;
        migrated.push(rel_path);
    }

    Ok(migrated)
}

pub fn create_notebook_in_root(root: &Path, name: &str, _icon: &str, _color: &str) -> AppResult<String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::InvalidInput("Notebook name cannot be empty".into()));
    }
    if trimmed_name == "." || trimmed_name == ".." {
        return Err(AppError::InvalidInput(
            "Notebook name cannot be a reserved path segment".into(),
        ));
    }
    if trimmed_name.contains('/') || trimmed_name.contains('\\') {
        return Err(AppError::InvalidInput(
            "Notebook must be a top-level directory under notes".into(),
        ));
    }

    let notebook_name = safe_filename(trimmed_name);
    let rel_path = format!("notes/{}", notebook_name);
    let abs_path = resolve_kb_path(root, &rel_path)?;

    if abs_path.exists() {
        return Err(AppError::AlreadyExists(format!("Notebook already exists: {}", rel_path)));
    }

    std::fs::create_dir_all(&abs_path)?;
    if let Err(error) = crate::services::notebook_visual::save_notebook_visual(
        root,
        &rel_path,
        _icon,
        _color,
        None,
    ) {
        let _ = std::fs::remove_dir(&abs_path);
        return Err(error);
    }

    Ok(rel_path)
}

pub fn create_notebook_service(state: &State<AppState>, input: CreateNotebookInput) -> AppResult<String> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;

    create_notebook_in_root(root, &input.name, &input.icon, &input.color)
}

fn create_note_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    input: CreateNoteInput,
) -> AppResult<Note> {
    let safe_title = safe_filename(&input.title);
    let dir = normalize_kb_relative_path(if input.directory.is_empty() { "notes" } else { &input.directory })?;
    if dir != "notes" && !dir.starts_with("notes/") {
        return Err(AppError::InvalidInput(
            "Note directory must be under notes".into(),
        ));
    }

    let rel_path = format!("{}/{}.md", dir, safe_title);
    let abs = resolve_kb_path(root, &rel_path)?;

    if abs.exists() {
        return Err(AppError::AlreadyExists(format!("Note already exists: {}", rel_path)));
    }

    let id = Ulid::new().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let fm = FrontMatter {
        id: Some(id.clone()),
        title: Some(input.title.clone()),
        created_at: Some(now.clone()),
        updated_at: Some(now.clone()),
        ..Default::default()
    };
    let content = render_note(&fm, &format!("# {}\n\n", input.title))?;

    atomic_write(&abs, &content)?;

    index_note_full(conn, root, &rel_path, &content)
}

pub fn create_note_service(state: &State<AppState>, input: CreateNoteInput) -> AppResult<Note> {
    let root_guard = state.kb_root_guard();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db_guard();
    let conn = db_guard.as_mut().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    create_note_in_root(conn, root, input)
}

pub fn get_note_by_path_service(state: &State<AppState>, rel_path: &str) -> AppResult<NoteDetail> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let root_guard = state.kb_root_guard();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let db_guard = state.db_guard();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let abs = resolve_kb_path(root, &rel_path)?;
    let content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", rel_path)))?;

    let note = conn.query_row(
        "SELECT id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at FROM notes WHERE path = ?1",
        params![&rel_path],
        |row| Ok(Note {
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
        }),
    ).map_err(|_| AppError::NotFound(format!("Note not found in DB: {}", rel_path)))?;

    Ok(NoteDetail { note, content })
}

fn note_outline_item_from_block(block: crate::infrastructure::markdown::NoteOutlineBlock) -> NoteOutlineItem {
    NoteOutlineItem {
        id: format!("{}:{}", block.anchor, block.line_start),
        text: block.text,
        level: block.level,
        line_start: block.line_start,
        line_end: block.line_end,
        anchor: block.anchor,
        children: Vec::new(),
    }
}

fn push_outline_item(
    roots: &mut Vec<NoteOutlineItem>,
    current_h1_index: Option<usize>,
    current_h2_index: Option<usize>,
    item: NoteOutlineItem,
    level: u8,
) -> (Option<usize>, Option<usize>) {
    match level {
        1 => {
            roots.push(item);
            (Some(roots.len() - 1), None)
        }
        2 => {
            if let Some(h1_index) = current_h1_index {
                roots[h1_index].children.push(item);
                (current_h1_index, Some(roots[h1_index].children.len() - 1))
            } else {
                roots.push(item);
                (None, Some(roots.len() - 1))
            }
        }
        3 => {
            if let Some(h1_index) = current_h1_index {
                if let Some(h2_index) = current_h2_index {
                    roots[h1_index].children[h2_index].children.push(item);
                    (current_h1_index, current_h2_index)
                } else {
                    roots[h1_index].children.push(item);
                    (current_h1_index, None)
                }
            } else if let Some(h2_index) = current_h2_index {
                roots[h2_index].children.push(item);
                (None, current_h2_index)
            } else {
                roots.push(item);
                (None, None)
            }
        }
        _ => (current_h1_index, current_h2_index),
    }
}

fn build_note_outline_tree(
    blocks: Vec<crate::infrastructure::markdown::NoteOutlineBlock>,
) -> Vec<NoteOutlineItem> {
    let mut roots = Vec::new();
    let mut current_h1_index = None;
    let mut current_h2_index = None;

    for block in blocks {
        let level = block.level;
        let item = note_outline_item_from_block(block);
        (current_h1_index, current_h2_index) = push_outline_item(
            &mut roots,
            current_h1_index,
            current_h2_index,
            item,
            level,
        );
    }

    roots
}

pub fn get_note_outline_in_root(root: &Path, rel_path: &str) -> AppResult<Vec<NoteOutlineItem>> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let abs = resolve_kb_path(root, &rel_path)?;
    let content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", rel_path)))?;

    let blocks = extract_note_outline_blocks_from_content(&content, 3);
    Ok(build_note_outline_tree(blocks))
}

pub fn get_note_outline_service(state: &State<AppState>, rel_path: &str) -> AppResult<Vec<NoteOutlineItem>> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;

    get_note_outline_in_root(root, rel_path)
}

fn save_note_in_root(conn: &rusqlite::Connection, root: &Path, input: SaveNoteInput) -> AppResult<SaveNoteResult> {
    let (path, current_hash): (String, String) = conn.query_row(
        "SELECT path, content_hash FROM notes WHERE id = ?1",
        params![input.note_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| AppError::NotFound(format!("Note not found: {}", input.note_id)))?;

    if let Some(expected) = &input.expected_hash {
        if expected != &current_hash {
            let conflict_path = build_conflict_backup_path(&path);
            let abs_conflict = resolve_kb_path(root, &conflict_path)?;
            atomic_write(&abs_conflict, &input.content)?;
            let note = get_note_by_path_service_inner(conn, root, &path)?;
            return Ok(SaveNoteResult { note, conflict: true });
        }
    }

    let abs = resolve_kb_path(root, &path)?;
    atomic_write(&abs, &input.content)?;

    let note = index_note_full(conn, root, &path, &input.content)?;
    Ok(SaveNoteResult { note, conflict: false })
}

pub fn save_note_service(state: &State<AppState>, input: SaveNoteInput) -> AppResult<SaveNoteResult> {
    let root_guard = state.kb_root_guard();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db_guard();
    let conn = db_guard.as_mut().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    save_note_in_root(conn, root, input)
}

fn get_note_by_path_service_inner(conn: &rusqlite::Connection, _root: &Path, rel_path: &str) -> AppResult<Note> {
    conn.query_row(
        "SELECT id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at FROM notes WHERE path = ?1",
        params![rel_path],
        |row| Ok(Note {
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
        }),
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Note not found in DB: {}", rel_path)),
        other => AppError::Database(other.to_string()),
    })
}

fn list_notes_in_conn(conn: &rusqlite::Connection) -> AppResult<Vec<Note>> {
    let mut stmt = conn.prepare(
                "SELECT id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at
                 FROM notes
                 WHERE deleted_at IS NULL
                 ORDER BY path"
    )?;
        let notes = stmt.query_map([], |row| Ok(Note {
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
    }))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(notes
        .into_iter()
        .filter(|note| !is_local_conflict_path(&note.path))
        .collect())
}

pub fn list_notes_service(state: &State<AppState>) -> AppResult<Vec<Note>> {
    let db_guard = state.db_guard();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    list_notes_in_conn(conn)
}

fn ensure_dir_node(children: &mut Vec<NoteTreeNode>, path: &str, name: &str) -> usize {
    if let Some(index) = children.iter().position(|child| child.is_dir && child.path == path) {
        return index;
    }

    children.push(NoteTreeNode {
        id: None,
        name: name.to_string(),
        path: path.to_string(),
        is_dir: true,
        has_summary: false,
        notebook_icon: None,
        notebook_color: None,
        children: vec![],
    });
    children.len() - 1
}

fn insert_dir_path(children: &mut Vec<NoteTreeNode>, parts: &[&str], prefix: &str) {
    if parts.is_empty() {
        return;
    }

    let current_path = if prefix.is_empty() {
        parts[0].to_string()
    } else {
        format!("{}/{}", prefix, parts[0])
    };
    let child_index = ensure_dir_node(children, &current_path, parts[0]);
    insert_dir_path(&mut children[child_index].children, &parts[1..], &current_path);
}

fn collect_note_directories(root: &Path) -> AppResult<Vec<String>> {
    fn visit(abs_dir: &Path, rel_dir: &str, dirs: &mut Vec<String>) -> AppResult<()> {
        for entry in std::fs::read_dir(abs_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let child_rel = format!("{}/{}", rel_dir, name);
            dirs.push(child_rel.clone());
            visit(&entry.path(), &child_rel, dirs)?;
        }
        Ok(())
    }

    let notes_dir = root.join("notes");
    if !notes_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut dirs = Vec::new();
    visit(&notes_dir, "notes", &mut dirs)?;
    Ok(dirs)
}

fn is_top_level_notebook_path(path: &str) -> bool {
    let mut parts = path.split('/');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some("notes"), Some(_), None)
    )
}

fn normalize_managed_notebook_path(path: &str) -> AppResult<String> {
    let path = normalize_kb_relative_path(path)?;
    if !is_top_level_notebook_path(&path) || path == "notes/__unarchived__" {
        return Err(AppError::InvalidInput(format!(
            "Notebook path must be a top-level directory under notes: {}",
            path
        )));
    }

    Ok(path)
}

fn normalize_new_notebook_name(new_name: &str) -> AppResult<String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("Notebook name cannot be empty".into()));
    }
    if trimmed == "." || trimmed == ".." || trimmed == "__unarchived__" {
        return Err(AppError::InvalidInput(
            "Notebook name cannot be a reserved path segment".into(),
        ));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::InvalidInput(
            "Notebook must be a top-level directory under notes".into(),
        ));
    }

    let normalized = safe_filename(trimmed);
    if normalized.is_empty() || normalized == "." || normalized == ".." || normalized == "__unarchived__" {
        return Err(AppError::InvalidInput(
            "Notebook name cannot be a reserved path segment".into(),
        ));
    }

    Ok(normalized)
}

fn collect_top_level_notebook_paths(root: &Path) -> AppResult<Vec<String>> {
    let notes_dir = root.join("notes");
    if !notes_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut notebooks = Vec::new();
    for entry in std::fs::read_dir(notes_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name == "__unarchived__" {
            continue;
        }

        notebooks.push(format!("notes/{}", name));
    }

    Ok(notebooks)
}

fn rewrite_notebook_prefix(path: &str, old_notebook_path: &str, new_notebook_path: &str) -> String {
    if path == old_notebook_path {
        return new_notebook_path.to_string();
    }

    let suffix = path
        .strip_prefix(&(old_notebook_path.to_string() + "/"))
        .expect("path should be inside notebook");
    format!("{}/{}", new_notebook_path, suffix)
}

fn paths_differ_only_by_case(left: &Path, right: &Path) -> bool {
    if left.parent() != right.parent() {
        return false;
    }

    let Some(left_name) = left.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(right_name) = right.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    left_name != right_name && left_name.to_lowercase() == right_name.to_lowercase()
}

fn rename_directory_with_case_handling(source: &Path, target: &Path) -> AppResult<()> {
    if paths_differ_only_by_case(source, target) {
        let temp_name = format!(".mynote-rename-{}", Ulid::new());
        let temp_path = source.with_file_name(temp_name);
        std::fs::rename(source, &temp_path)?;
        if let Err(error) = std::fs::rename(&temp_path, target) {
            let _ = std::fs::rename(&temp_path, source);
            return Err(AppError::Io(error.to_string()));
        }
        return Ok(());
    }

    std::fs::rename(source, target)?;
    Ok(())
}

fn normalize_managed_note_path(path: &str) -> AppResult<String> {
    let path = normalize_kb_relative_path(path)?;
    if !path.starts_with("notes/") || !path.ends_with(".md") {
        return Err(AppError::InvalidInput(format!("Invalid note path: {}", path)));
    }
    Ok(path)
}

fn normalize_new_note_name(new_name: &str) -> AppResult<String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("Note name cannot be empty".into()));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppError::InvalidInput("Note name cannot be a reserved path segment".into()));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::InvalidInput("Note name cannot contain path separators".into()));
    }

    let normalized = safe_filename(trimmed);
    if normalized.is_empty() || normalized == "." || normalized == ".." {
        return Err(AppError::InvalidInput("Note name cannot be a reserved path segment".into()));
    }

    Ok(normalized)
}

pub fn rename_note_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    note_path: &str,
    new_name: &str,
) -> AppResult<Note> {
    let source_rel = normalize_managed_note_path(note_path)?;
    let source_abs = resolve_kb_path(root, &source_rel)?;
    if !source_abs.exists() {
      return Err(AppError::NotFound(format!("Note not found: {}", source_rel)));
    }

    let source_note = get_note_by_path_service_inner(conn, root, &source_rel)?;
    let parent_dir = Path::new(&source_rel)
        .parent()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid note path: {}", source_rel)))?;
    let new_name = normalize_new_note_name(new_name)?;
    let target_filename = format!("{}.md", new_name);
    let desired_rel = format!("{}/{}", parent_dir, target_filename);

    if desired_rel == source_rel {
        return Ok(source_note);
    }

    let target_rel = next_available_note_path(conn, root, parent_dir, &target_filename)?;

    if target_rel == source_rel {
        return Ok(source_note);
    }

    let target_abs = resolve_kb_path(root, &target_rel)?;
    let content = std::fs::read_to_string(&source_abs)?;
    rename_directory_with_case_handling(&source_abs, &target_abs)?;

    let rename_result = (|| -> AppResult<Note> {
        conn.execute(
            "UPDATE notes SET path = ?1 WHERE id = ?2",
            params![&target_rel, &source_note.id],
        )?;
        index_note_full(conn, root, &target_rel, &content)
    })();

    if let Err(err) = rename_result {
        let _ = rename_directory_with_case_handling(&target_abs, &source_abs);
        let _ = conn.execute(
            "UPDATE notes SET path = ?1 WHERE id = ?2",
            params![&source_rel, &source_note.id],
        );
        return Err(err);
    }

    rename_result
}

pub fn rename_notebook_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    old_path: &str,
    new_name: &str,
) -> AppResult<RenameNotebookResult> {
    let old_path = normalize_managed_notebook_path(old_path)?;
    let new_name = normalize_new_notebook_name(new_name)?;
    let new_path = format!("notes/{}", new_name);
    let old_abs = resolve_kb_path(root, &old_path)?;
    let new_abs = resolve_kb_path(root, &new_path)?;

    if !old_abs.is_dir() {
        return Err(AppError::NotFound(format!("Notebook not found: {}", old_path)));
    }
    if old_path != new_path && new_abs.exists() {
        let same_entry = paths_differ_only_by_case(&old_abs, &new_abs)
            && std::fs::canonicalize(&old_abs).ok() == std::fs::canonicalize(&new_abs).ok();
        if !same_entry {
            return Err(AppError::AlreadyExists(format!("Notebook already exists: {}", new_path)));
        }
    }

    let mut stmt = conn.prepare(
        "SELECT path FROM notes WHERE path = ?1 OR path LIKE ?2 ORDER BY path",
    )?;
    let existing_paths = stmt
        .query_map(params![&old_path, format!("{}/%", old_path)], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let moved_note_paths = existing_paths
        .iter()
        .map(|path| (path.clone(), rewrite_notebook_prefix(path, &old_path, &new_path)))
        .collect::<Vec<_>>();

    if old_path == new_path {
        return Ok(RenameNotebookResult {
            notebook_path: new_path,
            moved_note_paths,
        });
    }

    rename_directory_with_case_handling(&old_abs, &new_abs)?;
    if let Err(error) = rename_notebook_visual(root, &old_path, &new_path) {
        let _ = rename_directory_with_case_handling(&new_abs, &old_abs);
        return Err(error);
    }

    let update_result = (|| -> AppResult<()> {
        for (source_path, target_path) in &moved_note_paths {
            conn.execute(
                "UPDATE notes SET path = ?1 WHERE path = ?2",
                params![target_path, source_path],
            )?;
        }
        Ok(())
    })();

    if let Err(error) = update_result {
        for (source_path, target_path) in moved_note_paths.iter().rev() {
            let _ = conn.execute(
                "UPDATE notes SET path = ?1 WHERE path = ?2",
                params![source_path, target_path],
            );
        }
        let _ = rename_notebook_visual(root, &new_path, &old_path);
        let _ = rename_directory_with_case_handling(&new_abs, &old_abs);
        return Err(error);
    }

    Ok(RenameNotebookResult {
        notebook_path: new_path,
        moved_note_paths,
    })
}

pub fn update_notebook_visual_in_root(
    _conn: &rusqlite::Connection,
    root: &Path,
    notebook_path: &str,
    icon: &str,
    color: &str,
) -> AppResult<()> {
    let notebook_path = normalize_managed_notebook_path(notebook_path)?;
    let notebook_abs = resolve_kb_path(root, &notebook_path)?;
    if !notebook_abs.is_dir() {
        return Err(AppError::NotFound(format!("Notebook not found: {}", notebook_path)));
    }

    let visuals = load_notebook_visuals(root);
    let current_visual = visual_for_path(&visuals, &notebook_path);
    save_notebook_visual(root, &notebook_path, icon, color, current_visual.order)
}

pub fn delete_notebook_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    notebook_path: &str,
) -> AppResult<()> {
    let notebook_path = normalize_managed_notebook_path(notebook_path)?;
    let notebook_abs = resolve_kb_path(root, &notebook_path)?;

    if !notebook_abs.is_dir() {
        return Err(AppError::NotFound(format!("Notebook not found: {}", notebook_path)));
    }
    let indexed_note_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL AND (path = ?1 OR path LIKE ?2)",
        params![&notebook_path, format!("{}/%", notebook_path)],
        |row| row.get(0),
    )?;
    if indexed_note_count > 0 {
        return Err(AppError::InvalidInput(format!(
            "只能删除空笔记本: {}",
            notebook_path
        )));
    }
    if std::fs::read_dir(&notebook_abs)?.next().transpose()?.is_some() {
        return Err(AppError::InvalidInput(format!(
            "只能删除空笔记本: {}",
            notebook_path
        )));
    }

    std::fs::remove_dir(&notebook_abs)?;
    if let Err(error) = delete_notebook_visual(root, &notebook_path) {
        std::fs::create_dir(&notebook_abs)
            .map_err(|restore_error| AppError::Io(format!(
                "{}; failed to restore notebook directory: {}",
                error, restore_error
            )))?;
        return Err(error);
    }

    Ok(())
}

pub fn delete_note_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    note_path: &str,
) -> AppResult<()> {
    let note_rel_path = normalize_kb_relative_path(note_path)?;
    let note_abs_path = resolve_kb_path(root, &note_rel_path)?;

    if !note_abs_path.is_file() {
        return Err(AppError::NotFound(format!("Note not found: {}", note_rel_path)));
    }

    let content = std::fs::read_to_string(&note_abs_path)
        .map_err(|_| AppError::NotFound(format!("Note not found: {}", note_rel_path)))?;
    let asset_paths = collect_note_asset_paths(root, &note_rel_path, &content)?;

    std::fs::remove_file(&note_abs_path)?;
    for asset_path in asset_paths {
        if asset_path.is_file() && !is_asset_path_referenced_by_other_notes(conn, root, &note_rel_path, &asset_path)? {
            std::fs::remove_file(asset_path)?;
        }
    }

    mark_note_deleted_by_path(conn, &note_rel_path)
}

fn is_asset_path_referenced_by_other_notes(
    conn: &rusqlite::Connection,
    root: &Path,
    deleted_note_rel_path: &str,
    asset_path: &Path,
) -> AppResult<bool> {
    let mut statement = conn.prepare(
        "SELECT path FROM notes WHERE deleted_at IS NULL AND path != ?1",
    )?;
    let note_paths = statement
        .query_map(params![deleted_note_rel_path], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    for note_path in note_paths {
        let note_abs_path = resolve_kb_path(root, &note_path)?;
        if !note_abs_path.is_file() {
            continue;
        }

        let other_content = std::fs::read_to_string(&note_abs_path)?;
        let referenced_assets = collect_note_asset_paths(root, &note_path, &other_content)?;
        if referenced_assets.iter().any(|path| path == asset_path) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn collect_note_asset_paths(root: &Path, note_rel_path: &str, content: &str) -> AppResult<Vec<PathBuf>> {
    let root_abs = std::fs::canonicalize(root)?;
    let note_parent_rel = Path::new(note_rel_path)
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid note path: {}", note_rel_path)))?
        .to_string_lossy()
        .replace('\\', "/");
    let note_parent_abs = resolve_kb_path(root, &note_parent_rel)?;
    let mut asset_paths = HashSet::new();

    for link in extract_links(content)
        .into_iter()
        .filter(|link| link.link_type == "asset")
    {
        if link.target_raw.trim().is_empty() {
            continue;
        }

        let candidate = note_parent_abs.join(&link.target_raw);
        let Ok(asset_abs) = std::fs::canonicalize(&candidate) else {
            continue;
        };

        if !asset_abs.starts_with(&root_abs) || !asset_abs.is_file() {
            continue;
        }

        asset_paths.insert(asset_abs);
    }

    Ok(asset_paths.into_iter().collect())
}

pub fn reorder_notebooks_in_root(
    _conn: &rusqlite::Connection,
    root: &Path,
    ordered_paths: &[String],
) -> AppResult<()> {
    let top_level_notebooks = collect_top_level_notebook_paths(root)?;
    let existing_notebooks = top_level_notebooks.iter().cloned().collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let normalized_order = ordered_paths
        .iter()
        .map(|path| normalize_managed_notebook_path(path))
        .collect::<AppResult<Vec<_>>>()?;

    for notebook_path in &normalized_order {
        if !existing_notebooks.contains(notebook_path) {
            return Err(AppError::NotFound(format!("Notebook not found: {}", notebook_path)));
        }
        if !seen.insert(notebook_path.clone()) {
            return Err(AppError::InvalidInput(format!("Duplicate notebook path: {}", notebook_path)));
        }
    }

    let visuals = load_notebook_visuals(root);
    for notebook_path in top_level_notebooks {
        let visual = visual_for_path(&visuals, &notebook_path);
        let order = normalized_order
            .iter()
            .position(|path| path == &notebook_path)
            .map(|index| index as i64);
        save_notebook_visual(root, &notebook_path, &visual.icon, &visual.color, order)?;
    }

    Ok(())
}

fn apply_notebook_visuals(nodes: &mut [NoteTreeNode], visuals: &NotebookVisualMap) {
    for node in nodes.iter_mut() {
        if node.is_dir && node.path == "notes" {
            for child in node.children.iter_mut() {
                if child.is_dir && is_top_level_notebook_path(&child.path) {
                    let visual = visual_for_path(visuals, &child.path);
                    child.notebook_icon = Some(visual.icon);
                    child.notebook_color = Some(visual.color);
                }
            }
        }
    }
}

fn sort_note_tree_nodes(
    nodes: &mut [NoteTreeNode],
    parent_path: Option<&str>,
    visuals: &NotebookVisualMap,
) {
    nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) if parent_path == Some("notes") => {
            let a_order = visual_for_path(visuals, &a.path).order;
            let b_order = visual_for_path(visuals, &b.path).order;
            match (a_order, b_order) {
                (Some(left), Some(right)) => left.cmp(&right).then_with(|| a.name.cmp(&b.name)),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.name.cmp(&b.name),
            }
        }
        _ => a.name.cmp(&b.name),
    });

    for node in nodes.iter_mut().filter(|node| node.is_dir) {
        let node_path = node.path.clone();
        sort_note_tree_nodes(&mut node.children, Some(&node_path), visuals);
    }
}

fn next_available_note_path(
    conn: &rusqlite::Connection,
    root: &Path,
    target_dir: &str,
    filename: &str,
) -> AppResult<String> {
    fn path_is_reserved_or_taken(
        conn: &rusqlite::Connection,
        root: &Path,
        candidate: &str,
    ) -> AppResult<bool> {
        if resolve_kb_path(root, candidate)?.exists() {
            return Ok(true);
        }

        let note_exists: Option<String> = conn
            .query_row(
                "SELECT id FROM notes WHERE path = ?1 LIMIT 1",
                params![candidate],
                |row| row.get(0),
            )
            .optional()?;
        Ok(note_exists.is_some())
    }

    let target_rel = format!("{}/{}", target_dir, filename);
    if !path_is_reserved_or_taken(conn, root, &target_rel)? {
        return Ok(target_rel);
    }

    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid filename: {}", filename)))?;
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("md");

    let mut index = 1;
    loop {
        let candidate = format!("{}/{}-{}.{}", target_dir, stem, index, ext);
        if !path_is_reserved_or_taken(conn, root, &candidate)? {
            return Ok(candidate);
        }
        index += 1;
    }
}

fn path_uses_symlink_segment(root: &Path, relative: &str) -> AppResult<bool> {
    let mut current = root.to_path_buf();
    for part in normalize_kb_relative_path(relative)?.split('/') {
        current.push(part);
        if let Ok(metadata) = std::fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn validate_existing_note_target_directory(root: &Path, target_directory: &str) -> AppResult<String> {
    let target_dir = normalize_kb_relative_path(target_directory)?;
    let is_valid_notes_path = target_dir == "notes" || target_dir.starts_with("notes/");

    if !is_valid_notes_path
        || target_dir == "notes/__unarchived__"
        || target_dir.starts_with("notes/__unarchived__/")
        || path_uses_symlink_segment(root, &target_dir)?
    {
        return Err(AppError::InvalidInput(format!("Invalid target directory: {}", target_dir)));
    }

    let target_abs = resolve_kb_path(root, &target_dir)?;
    if !target_abs.exists() {
        std::fs::create_dir_all(&target_abs)?;
    }
    if !target_abs.is_dir() {
        return Err(AppError::InvalidInput(format!("Invalid target directory: {}", target_dir)));
    }

    Ok(target_dir)
}

pub fn move_note_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    source_path: &str,
    target_directory: &str,
) -> AppResult<Note> {
    let source_rel = normalize_kb_relative_path(source_path)?;
    let target_dir = validate_existing_note_target_directory(root, target_directory)?;
    let source_abs = resolve_kb_path(root, &source_rel)?;

    if !source_abs.exists() {
        return Err(AppError::NotFound(format!("Source note not found: {}", source_rel)));
    }

    let source_note = get_note_by_path_service_inner(conn, root, &source_rel)?;
    let current_dir = Path::new(&source_rel)
        .parent()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid source path: {}", source_rel)))?;

    if current_dir == target_dir {
        return Ok(source_note);
    }

    let filename = Path::new(&source_rel)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid source path: {}", source_rel)))?;
    let final_rel = next_available_note_path(conn, root, &target_dir, filename)?;
    let final_abs = resolve_kb_path(root, &final_rel)?;
    let content = std::fs::read_to_string(&source_abs)?;

    std::fs::rename(&source_abs, &final_abs)?;
    let move_result = (|| -> AppResult<Note> {
        conn.execute(
            "UPDATE notes SET path = ?1 WHERE id = ?2",
            params![&final_rel, &source_note.id],
        )?;
        index_note_full(conn, root, &final_rel, &content)
    })();

    if let Err(err) = move_result {
        let _ = std::fs::rename(&final_abs, &source_abs);
        let _ = conn.execute(
            "UPDATE notes SET path = ?1 WHERE id = ?2",
            params![&source_rel, &source_note.id],
        );
        return Err(err);
    }

    move_result
}

pub fn build_tree(notes: &[Note]) -> Vec<NoteTreeNode> {
    fn insert_node(children: &mut Vec<NoteTreeNode>, parts: &[&str], note: &Note, prefix: &str) {
        if parts.is_empty() {
            return;
        }

        let current_path = if prefix.is_empty() {
            parts[0].to_string()
        } else {
            format!("{}/{}", prefix, parts[0])
        };

        if parts.len() == 1 {
            children.push(NoteTreeNode {
                id: Some(note.id.clone()),
                name: parts[0].to_string(),
                path: current_path,
                is_dir: false,
                has_summary: note.summary.as_ref().is_some_and(|summary| !summary.trim().is_empty()),
                notebook_icon: None,
                notebook_color: None,
                children: vec![],
            });
            return;
        }

        let child_index = if let Some(index) = children.iter().position(|child| child.is_dir && child.path == current_path) {
            index
        } else {
            children.push(NoteTreeNode {
                id: None,
                name: parts[0].to_string(),
                path: current_path.clone(),
                is_dir: true,
                has_summary: false,
                notebook_icon: None,
                notebook_color: None,
                children: vec![],
            });
            children.len() - 1
        };

        insert_node(&mut children[child_index].children, &parts[1..], note, &current_path);
    }

    fn sort_nodes(nodes: &mut [NoteTreeNode]) {
        nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });

        for node in nodes.iter_mut().filter(|node| node.is_dir) {
            sort_nodes(&mut node.children);
        }
    }

    let mut root_nodes: Vec<NoteTreeNode> = Vec::new();

    for note in notes {
        let parts: Vec<&str> = note.path.split('/').filter(|part| !part.is_empty()).collect();
        insert_node(&mut root_nodes, &parts, note, "");
    }

    sort_nodes(&mut root_nodes);
    root_nodes
}

fn build_tree_with_directories(notes: &[Note], directory_paths: &[String]) -> Vec<NoteTreeNode> {
    let mut root_nodes = build_tree(notes);

    for directory_path in directory_paths {
        let parts: Vec<&str> = directory_path.split('/').filter(|part| !part.is_empty()).collect();
        insert_dir_path(&mut root_nodes, &parts, "");
    }

    fn sort_nodes(nodes: &mut [NoteTreeNode]) {
        nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });

        for node in nodes.iter_mut().filter(|node| node.is_dir) {
            sort_nodes(&mut node.children);
        }
    }

    sort_nodes(&mut root_nodes);
    root_nodes
}

fn prune_directory_nodes_missing_from_scan(nodes: &mut Vec<NoteTreeNode>, directory_paths: &[String]) {
    let existing_dirs = directory_paths.iter().cloned().collect::<HashSet<_>>();

    fn visit(nodes: &mut Vec<NoteTreeNode>, existing_dirs: &HashSet<String>) {
        nodes.retain(|node| !node.is_dir || node.path == "notes" || existing_dirs.contains(&node.path));

        for node in nodes.iter_mut().filter(|node| node.is_dir) {
            visit(&mut node.children, existing_dirs);
        }
    }

    visit(nodes, &existing_dirs);
}

fn build_tree_with_visuals(
    notes: &[Note],
    directory_paths: &[String],
    visuals: &NotebookVisualMap,
) -> Vec<NoteTreeNode> {
    let mut root_nodes = build_tree_with_directories(notes, directory_paths);
    prune_directory_nodes_missing_from_scan(&mut root_nodes, directory_paths);
    apply_notebook_visuals(&mut root_nodes, visuals);
    sort_note_tree_nodes(&mut root_nodes, None, visuals);
    root_nodes
}

pub fn rename_notebook_service(
    state: &State<AppState>,
    old_path: &str,
    new_name: &str,
) -> AppResult<RenameNotebookResult> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    rename_notebook_in_root(conn, &root, old_path, new_name)
}

pub fn update_notebook_visual_service(
    state: &State<AppState>,
    notebook_path: &str,
    icon: &str,
    color: &str,
) -> AppResult<()> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    update_notebook_visual_in_root(conn, &root, notebook_path, icon, color)
}

pub fn delete_notebook_service(state: &State<AppState>, notebook_path: &str) -> AppResult<()> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    delete_notebook_in_root(conn, &root, notebook_path)
}

pub fn delete_note_service(state: &State<AppState>, note_path: &str) -> AppResult<()> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    delete_note_in_root(conn, &root, note_path)
}

pub fn rename_note_service(
    state: &State<AppState>,
    note_path: &str,
    new_name: &str,
) -> AppResult<Note> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    rename_note_in_root(conn, &root, note_path, new_name)
}

pub fn reorder_notebooks_service(
    state: &State<AppState>,
    ordered_paths: &[String],
) -> AppResult<()> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    reorder_notebooks_in_root(conn, &root, ordered_paths)
}

pub fn get_note_tree_service(state: &State<AppState>) -> AppResult<Vec<NoteTreeNode>> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let notes = list_notes_service(state)?;
    let directory_paths = collect_note_directories(&root)?;
    let visuals = load_notebook_visuals(&root);
    Ok(build_tree_with_visuals(&notes, &directory_paths, &visuals))
}

pub fn index_note_from_file(state: &State<AppState>, rel_path: &str) -> AppResult<Note> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let root_guard = state.kb_root_guard();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db_guard();
    let conn = db_guard.as_mut().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let abs = resolve_kb_path(root, &rel_path)?;
    let content = std::fs::read_to_string(&abs)?;

    let note = index_note_full(conn, root, &rel_path, &content)?;
    Ok(note)
}

fn import_markdown_content_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    src: &Path,
    content: &str,
    dest_directory: &str,
) -> AppResult<Note> {
    let filename = src
        .file_name()
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid path: {}", src.display())))?
        .to_string_lossy()
        .to_string();

    if !filename.to_lowercase().ends_with(".md") {
        return Err(AppError::InvalidInput("Only .md files can be imported".into()));
    }

    let dir = normalize_kb_relative_path(if dest_directory.is_empty() { "notes" } else { dest_directory })?;
    let final_rel = next_available_note_path(conn, root, &dir, &filename)?;

    let abs_dest = resolve_kb_path(root, &final_rel)?;
    atomic_write(&abs_dest, content)?;

    let note = index_note_full(conn, root, &final_rel, content)?;
    Ok(note)
}

fn import_single_markdown_file_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    src_path: &str,
    dest_directory: &str,
) -> AppResult<Note> {
    let src = Path::new(src_path);

    if let Ok(src_abs) = src.canonicalize() {
        let root_abs = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());

        if src_abs.starts_with(&root_abs) {
            if let Ok(relative) = src_abs.strip_prefix(&root_abs) {
                let managed_rel = relative
                    .components()
                    .filter_map(|component| match component {
                        std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("/");

                if !managed_rel.is_empty() {
                    let managed_rel = normalize_managed_note_path(&managed_rel)?;
                    return get_note_by_path_service_inner(conn, root, &managed_rel);
                }
            }
        }
    }

    let content = std::fs::read_to_string(src_path)?;
    let validated_dest_directory = validate_existing_note_target_directory(root, dest_directory)?;
    import_markdown_content_in_root(conn, root, src, &content, &validated_dest_directory)
}

fn join_kb_relative(base: &str, extra: &Path) -> String {
    let extra = extra
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");

    if extra.is_empty() {
        base.to_string()
    } else {
        format!("{}/{}", base, extra)
    }
}

fn next_available_asset_path(root: &Path, target_rel: &str) -> AppResult<String> {
    if !resolve_kb_path(root, target_rel)?.exists() {
        return Ok(target_rel.to_string());
    }

    let target_path = Path::new(target_rel);
    let parent = target_path
        .parent()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid asset path: {}", target_rel)))?;
    let stem = target_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid asset path: {}", target_rel)))?;
    let ext = target_path.extension().and_then(|value| value.to_str());

    let mut index = 1;
    loop {
        let candidate_filename = match ext {
            Some(ext) if !ext.is_empty() => format!("{}-{}.{}", stem, index, ext),
            _ => format!("{}-{}", stem, index),
        };
        let candidate = format!("{}/{}", parent, candidate_filename);
        if !resolve_kb_path(root, &candidate)?.exists() {
            return Ok(candidate);
        }
        index += 1;
    }
}

fn paths_have_same_bytes(left: &Path, right: &Path) -> AppResult<bool> {
    if !right.exists() {
        return Ok(false);
    }

    Ok(std::fs::read(left)? == std::fs::read(right)?)
}

fn relative_path_between(base_dir: &Path, target: &Path) -> PathBuf {
    let base_components = base_dir
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_os_string()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let target_components = target
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_os_string()),
            _ => None,
        })
        .collect::<Vec<_>>();

    let mut shared = 0usize;
    while shared < base_components.len()
        && shared < target_components.len()
        && base_components[shared] == target_components[shared]
    {
        shared += 1;
    }

    let mut relative = PathBuf::new();
    for _ in shared..base_components.len() {
        relative.push("..");
    }
    for component in target_components.iter().skip(shared) {
        relative.push(component);
    }

    relative
}

pub fn supported_image_extension(path: &Path) -> AppResult<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| AppError::InvalidInput(format!("Unsupported image type: {}", path.display())))?;

    if SUPPORTED_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        Ok(extension)
    } else {
        Err(AppError::InvalidInput(format!(
            "Unsupported image type: {}",
            path.display()
        )))
    }
}

pub fn supported_image_extension_from_mime_type(mime_type: &str) -> AppResult<String> {
    let normalized = mime_type
        .split(';')
        .next()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();

    let extension = match normalized.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpeg",
        "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => {
            return Err(AppError::InvalidInput(format!(
                "Unsupported image mime type: {}",
                mime_type
            )))
        }
    };

    Ok(extension.to_string())
}

pub fn build_imported_image_filename(timestamp: &str, random_suffix: &str, extension: &str) -> String {
    format!("{}-{}.{}", timestamp, random_suffix, extension)
}

pub fn build_markdown_asset_path_for_note(note_path: &str, asset_rel_path: &str) -> AppResult<String> {
    let note_rel_path = normalize_kb_relative_path(note_path)?;
    let asset_rel_path = normalize_kb_relative_path(asset_rel_path)?;
    let note_dir = Path::new(&note_rel_path)
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid note path: {}", note_path)))?;

    Ok(relative_path_between(note_dir, Path::new(&asset_rel_path))
        .to_string_lossy()
        .replace('\\', "/"))
}

pub fn insert_image_for_note_from_selected_path(
    root: &Path,
    note_path: &str,
    selected_path: Option<&Path>,
    timestamp: &str,
    random_suffix: &str,
) -> AppResult<Option<InsertImageResult>> {
    let Some(selected_path) = selected_path else {
        return Ok(None);
    };

    let note_rel_path = normalize_kb_relative_path(note_path)?;
    let extension = supported_image_extension(selected_path)?;
    if !selected_path.is_file() {
        return Err(AppError::InvalidInput(format!(
            "Selected image not found: {}",
            selected_path.display()
        )));
    }

    let filename = build_imported_image_filename(timestamp, random_suffix, &extension);
    let asset_rel_path = format!("assets/{}", filename);
    let asset_abs_path = resolve_kb_path(root, &asset_rel_path)?;
    if let Some(parent) = asset_abs_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(selected_path, &asset_abs_path)?;

    let markdown_path = build_markdown_asset_path_for_note(&note_rel_path, &asset_rel_path)?;
    Ok(Some(InsertImageResult { markdown_path }))
}

pub fn insert_pasted_image_for_note_from_bytes(
    root: &Path,
    note_path: &str,
    mime_type: &str,
    image_bytes: &[u8],
    timestamp: &str,
    random_suffix: &str,
) -> AppResult<InsertImageResult> {
    if image_bytes.is_empty() {
        return Err(AppError::InvalidInput("Clipboard image data is empty".into()));
    }

    let note_rel_path = normalize_kb_relative_path(note_path)?;
    let extension = supported_image_extension_from_mime_type(mime_type)?;
    let filename = build_imported_image_filename(timestamp, random_suffix, &extension);
    let asset_rel_path = format!("assets/{}", filename);
    let asset_abs_path = resolve_kb_path(root, &asset_rel_path)?;
    if let Some(parent) = asset_abs_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&asset_abs_path, image_bytes)?;

    let markdown_path = build_markdown_asset_path_for_note(&note_rel_path, &asset_rel_path)?;
    Ok(InsertImageResult { markdown_path })
}

pub async fn rewrite_pasted_remote_images_in_text(
    root: &Path,
    note_path: &str,
    text: &str,
    timestamp: &str,
    random_suffix_seed: &str,
) -> AppResult<String> {
    let remote_urls = extract_remote_image_urls_from_text(text);
    if remote_urls.is_empty() {
        return Ok(text.to_string());
    }

    let client = Client::new();
    let mut rewritten_text = text.to_string();

    for (index, url) in remote_urls.iter().enumerate() {
        let response = match client.get(url).send().await {
            Ok(response) => response,
            Err(_) => continue,
        };

        if !response.status().is_success() {
            continue;
        }

        let mime_type = match infer_remote_image_mime_type(url, response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok())) {
            Some(mime_type) => mime_type,
            None => continue,
        };

        let bytes = match response.bytes().await {
            Ok(bytes) if !bytes.is_empty() => bytes,
            _ => continue,
        };

        let suffix = if index == 0 {
            random_suffix_seed.to_string()
        } else {
            format!("{}{:02}", random_suffix_seed, index)
        };

        let result = insert_pasted_image_for_note_from_bytes(
            root,
            note_path,
            &mime_type,
            bytes.as_ref(),
            timestamp,
            &suffix.chars().take(8).collect::<String>(),
        )?;

        rewritten_text = replace_remote_image_reference(&rewritten_text, url, &format!("![图片]({})", result.markdown_path));
    }

    Ok(rewritten_text)
}

pub async fn read_clipboard_text_for_paste_in_root(
    root: &Path,
    note_path: &str,
    timestamp: &str,
    random_suffix_seed: &str,
) -> AppResult<Option<String>> {
    let html = read_macos_clipboard_text("html").ok().filter(|value| !value.trim().is_empty());
    let text = read_macos_clipboard_text("txt").ok().filter(|value| !value.trim().is_empty());

    let candidate = if let Some(html) = html {
        convert_pasted_html_to_text(&html).or(text)
    } else {
        text
    };

    let Some(candidate) = candidate else {
        return Ok(None);
    };

    let rewritten = rewrite_pasted_remote_images_in_text(
        root,
        note_path,
        &candidate,
        timestamp,
        random_suffix_seed,
    ).await?;

    Ok(Some(rewritten))
}

pub fn insert_pasted_image_for_note_from_native_clipboard(
    root: &Path,
    note_path: &str,
    timestamp: &str,
    random_suffix: &str,
) -> AppResult<Option<InsertImageResult>> {
    let mut clipboard = Clipboard::new()
        .map_err(|error| AppError::InvalidInput(format!("Unable to access clipboard: {error}")))?;

    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(error) => {
            if native_clipboard_error_means_no_image(&error.to_string()) {
                return Ok(None);
            }
            return Err(AppError::InvalidInput(format!("Unable to read clipboard image: {error}")));
        }
    };

    let mut encoded = Vec::new();
    let encoder = PngEncoder::new(&mut encoded);
    encoder
        .write_image(
            image.bytes.as_ref(),
            image.width as u32,
            image.height as u32,
            ColorType::Rgba8.into(),
        )
        .map_err(|error| AppError::InvalidInput(format!("Unable to encode clipboard image: {error}")))?;

    insert_pasted_image_for_note_from_bytes(
        root,
        note_path,
        "image/png",
        &encoded,
        timestamp,
        random_suffix,
    )
    .map(Some)
}

fn native_clipboard_error_means_no_image(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("content not available")
        || normalized.contains("does not contain")
        || normalized.contains("requested format")
        || normalized.contains("clipboard is empty")
}

fn extract_remote_image_urls_from_text(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut seen = HashSet::new();

    for captures in regex::Regex::new(r#"!\[[^\]]*\]\(\s*(https?://[^)\s]+)\s*\)"#).unwrap().captures_iter(text) {
        if let Some(url) = captures.get(1).map(|m| m.as_str().to_string()) {
            if seen.insert(url.clone()) {
                urls.push(url);
            }
        }
    }

    for captures in regex::Regex::new(r#"<img\b[^>]*\bsrc=["'](https?://[^"']+)["'][^>]*>"#).unwrap().captures_iter(text) {
        if let Some(url) = captures.get(1).map(|m| m.as_str().to_string()) {
            if seen.insert(url.clone()) {
                urls.push(url);
            }
        }
    }

    urls
}

fn infer_remote_image_mime_type(url: &str, content_type: Option<&str>) -> Option<String> {
    let normalized_content_type = content_type
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();

    if matches!(normalized_content_type.as_str(), "image/png" | "image/jpeg" | "image/jpg" | "image/gif" | "image/webp" | "image/svg+xml") {
        return Some(normalized_content_type);
    }

    let normalized_url = url.to_ascii_lowercase();
    if normalized_url.ends_with(".png") {
        return Some("image/png".into());
    }
    if normalized_url.ends_with(".jpg") || normalized_url.ends_with(".jpeg") {
        return Some("image/jpeg".into());
    }
    if normalized_url.ends_with(".gif") {
        return Some("image/gif".into());
    }
    if normalized_url.ends_with(".webp") {
        return Some("image/webp".into());
    }
    if normalized_url.ends_with(".svg") {
        return Some("image/svg+xml".into());
    }

    None
}

fn replace_remote_image_reference(text: &str, url: &str, replacement: &str) -> String {
    let escaped_url = regex::escape(url);
    let markdown_pattern = regex::Regex::new(&format!(r#"!\[[^\]]*\]\(\s*{}\s*\)"#, escaped_url)).unwrap();
    let html_pattern = regex::Regex::new(&format!(r#"<img\b[^>]*\bsrc=["']{}["'][^>]*>"#, escaped_url)).unwrap();
    let replaced = markdown_pattern.replace_all(text, replacement).to_string();
    html_pattern.replace_all(&replaced, replacement).to_string()
}

fn read_macos_clipboard_text(preference: &str) -> AppResult<String> {
    let output = Command::new("pbpaste")
        .args(["-Prefer", preference])
        .output()
        .map_err(|error| AppError::InvalidInput(format!("Unable to read clipboard text: {error}")))?;

    if !output.status.success() {
        return Err(AppError::InvalidInput(format!(
            "Unable to read clipboard text with pbpaste -Prefer {}",
            preference,
        )));
    }

    String::from_utf8(output.stdout)
        .map_err(|error| AppError::InvalidInput(format!("Clipboard text is not valid UTF-8: {error}")))
}

fn convert_pasted_html_to_text(html: &str) -> Option<String> {
    let mut text = html.to_string();
    let br_pattern = regex::Regex::new(r"(?i)<br\s*/?>").unwrap();
    text = br_pattern.replace_all(&text, "\n").to_string();

    let img_pattern = regex::Regex::new(r#"(?is)<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>"#).unwrap();
    text = img_pattern
        .replace_all(&text, "\n[[MYNOTE_REMOTE_IMAGE::$1]]\n")
        .to_string();

    let block_pattern = regex::Regex::new(r"(?i)</?(p|div|section|article|li|ul|ol|table|tr|td|th|h1|h2|h3|h4|h5|h6)[^>]*>").unwrap();
    text = block_pattern.replace_all(&text, "\n").to_string();

    let tag_pattern = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
    text = tag_pattern.replace_all(&text, "").to_string();

    let normalized = text
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let normalized = regex::Regex::new(r"\n{3,}").unwrap().replace_all(&normalized, "\n\n").to_string();
    let normalized = normalized
        .lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    let normalized = regex::Regex::new(r#"\[\[MYNOTE_REMOTE_IMAGE::(https?://[^\]\n]+)\]\]"#)
        .unwrap()
        .replace_all(&normalized, "<img src=\"$1\">")
        .to_string();

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn collect_markdown_files(dir: &Path) -> AppResult<Vec<PathBuf>> {
    fn visit(dir: &Path, files: &mut Vec<PathBuf>) -> AppResult<()> {
        let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.path());
        for entry in entries {
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                visit(&path, files)?;
                continue;
            }

            let is_markdown = path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("md"));
            if is_markdown {
                files.push(path);
            }
        }

        Ok(())
    }

    let mut files = Vec::new();
    visit(dir, &mut files)?;
    Ok(files)
}

fn rewrite_directory_assets_for_markdown(
    root: &Path,
    selected_dir: &Path,
    target_base: &str,
    source_note: &Path,
    target_dir: &str,
    content: &str,
    source_path: &str,
    result: &mut MarkdownImportResult,
) -> AppResult<String> {
    let source_parent = source_note
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid path: {}", source_note.display())))?;
    let note_dest_dir = Path::new(target_dir);
    let mut replacements = Vec::new();

    for link in extract_links(content)
        .into_iter()
        .filter(|link| link.link_type == "asset")
    {
        if link.target_raw.is_empty() {
            continue;
        }

        let candidate = source_parent.join(&link.target_raw);
        let Ok(asset_abs) = std::fs::canonicalize(&candidate) else {
            result.warnings.push(MarkdownImportMessage {
                source_path: source_path.to_string(),
                message: format!("Skipped external asset {}", link.target_raw),
            });
            continue;
        };

        if !asset_abs.starts_with(selected_dir) {
            result.warnings.push(MarkdownImportMessage {
                source_path: source_path.to_string(),
                message: format!("Skipped external asset {}", link.target_raw),
            });
            continue;
        }

        let asset_rel = asset_abs
            .strip_prefix(selected_dir)
            .map_err(|_| AppError::InvalidInput(format!("Invalid asset path: {}", asset_abs.display())))?;
        let desired_asset_dest_rel = join_kb_relative(target_base, asset_rel);
        let desired_asset_dest_abs = resolve_kb_path(root, &desired_asset_dest_rel)?;
        let final_asset_dest_rel = if paths_have_same_bytes(&asset_abs, &desired_asset_dest_abs)? {
            desired_asset_dest_rel
        } else if desired_asset_dest_abs.exists() {
            next_available_asset_path(root, &desired_asset_dest_rel)?
        } else {
            desired_asset_dest_rel
        };
        let asset_dest_abs = resolve_kb_path(root, &final_asset_dest_rel)?;
        if let Some(parent) = asset_dest_abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if !asset_dest_abs.exists() {
            std::fs::copy(&asset_abs, &asset_dest_abs)?;
        }

        let rewritten_target = relative_path_between(note_dest_dir, Path::new(&final_asset_dest_rel))
            .to_string_lossy()
            .replace('\\', "/");
        if rewritten_target != link.target_raw {
            let original_segment = &content[link.start_offset..link.end_offset];
            let replacement_segment = original_segment.replacen(&link.target_raw, &rewritten_target, 1);
            replacements.push((link.start_offset, link.end_offset, replacement_segment));
        }
    }

    let mut rewritten = content.to_string();
    for (start, end, replacement) in replacements.into_iter().rev() {
        rewritten.replace_range(start..end, &replacement);
    }

    Ok(rewritten)
}

fn import_markdown_directory_into_result(
    conn: &rusqlite::Connection,
    root: &Path,
    source_path: &str,
    dest_directory: &str,
    result: &mut MarkdownImportResult,
) -> AppResult<()> {
    let source_dir = Path::new(source_path);
    if !source_dir.is_dir() {
        return Err(AppError::InvalidInput(format!("Directory not found: {}", source_path)));
    }

    let selected_dir = std::fs::canonicalize(source_dir)?;
    let selected_name = source_dir
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid directory path: {}", source_path)))?;
    let target_base = format!("{}/{}", dest_directory, selected_name);

    for markdown_file in collect_markdown_files(&selected_dir)? {
        let relative = markdown_file
            .strip_prefix(&selected_dir)
            .map_err(|_| AppError::InvalidInput(format!("Invalid markdown path: {}", markdown_file.display())))?;
        let target_dir = relative
            .parent()
            .map(|parent| join_kb_relative(&target_base, parent))
            .unwrap_or_else(|| target_base.clone());
        let source_file_path = markdown_file.to_string_lossy().to_string();

        match std::fs::read_to_string(&markdown_file).and_then(|content| {
            rewrite_directory_assets_for_markdown(
                root,
                &selected_dir,
                &target_base,
                &markdown_file,
                &target_dir,
                &content,
                &source_file_path,
                result,
            )
            .map_err(|error| std::io::Error::other(error.to_string()))
        }) {
            Ok(content) => match import_markdown_content_in_root(conn, root, &markdown_file, &content, &target_dir) {
                Ok(note) => result.imported.push(MarkdownImportItem {
                    source_path: source_file_path.clone(),
                    note,
                }),
                Err(err) => result.failures.push(MarkdownImportMessage {
                    source_path: source_file_path,
                    message: err.to_string(),
                }),
            },
            Err(err) => result.failures.push(MarkdownImportMessage {
                source_path: source_file_path,
                message: err.to_string(),
            }),
        }
    }

    Ok(())
}

pub fn import_markdown_sources_service(
    state: &State<AppState>,
    request: MarkdownImportRequest,
) -> AppResult<MarkdownImportResult> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let mut db_guard = state.db_guard();
    let conn = db_guard
        .as_mut()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    import_markdown_sources_in_root(conn, &root, request)
}

pub fn import_markdown_sources_in_root(
    conn: &mut rusqlite::Connection,
    root: &Path,
    request: MarkdownImportRequest,
) -> AppResult<MarkdownImportResult> {
    let dest_directory = validate_existing_note_target_directory(
        root,
        if request.dest_directory.is_empty() {
            "notes"
        } else {
            &request.dest_directory
        },
    )?;

    let mut result = MarkdownImportResult {
        imported: Vec::new(),
        warnings: Vec::new(),
        failures: Vec::new(),
    };

    for source in request.sources {
        match source {
            MarkdownImportSource::File { path } => match import_single_markdown_file_in_root(conn, root, &path, &dest_directory) {
                Ok(note) => result.imported.push(MarkdownImportItem { source_path: path, note }),
                Err(err) => result.failures.push(MarkdownImportMessage {
                    source_path: path,
                    message: err.to_string(),
                }),
            },
            MarkdownImportSource::Directory { path } => {
                import_markdown_directory_into_result(conn, root, &path, &dest_directory, &mut result)?;
            }
        }
    }

    Ok(result)
}

pub fn import_note_service(
    state: &State<AppState>,
    src_path: &str,
    dest_directory: &str,
) -> AppResult<Note> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let mut db_guard = state.db_guard();
    let conn = db_guard
        .as_mut()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    import_single_markdown_file_in_root(conn, &root, src_path, dest_directory)
}

#[cfg(test)]
mod tests {
    use super::{
        build_imported_image_filename, build_markdown_asset_path_for_note, build_tree,
        build_tree_with_directories, build_tree_with_visuals, create_note_in_root, create_notebook_in_root,
        convert_pasted_html_to_text,
        delete_note_in_root, delete_notebook_in_root, get_note_outline_in_root,
        import_markdown_sources_in_root, import_single_markdown_file_in_root,
        insert_image_for_note_from_selected_path, insert_pasted_image_for_note_from_bytes,
        list_notes_in_conn, move_note_in_root, rename_note_in_root, rename_notebook_in_root, reorder_notebooks_in_root,
        rewrite_pasted_remote_images_in_text, save_note_in_root,
        native_clipboard_error_means_no_image,
        supported_image_extension, supported_image_extension_from_mime_type,
        update_notebook_visual_in_root,
    };
    use crate::domain::note::{CreateNoteInput, InsertImageResult, MarkdownImportRequest, MarkdownImportSource, Note, SaveNoteInput};
    use crate::error::AppError;
    use crate::infrastructure::db::open_and_migrate;
    use crate::services::notebook_visual::NotebookVisualMap;
    use mockito::Server;
    use rusqlite::params;
    use crate::services::index::index_note_full;
    use crate::services::notebook_visual::{load_notebook_visuals, save_notebook_visual};
    use std::path::Path;
    use tempfile::TempDir;

    fn make_note(path: &str) -> Note {
        Note {
            id: format!("id-{}", path),
            path: path.to_string(),
            title: path.to_string(),
            summary: None,
            content_hash: "hash".into(),
            word_count: 0,
            created_at: "now".into(),
            updated_at: "now".into(),
            indexed_at: "now".into(),
            deleted_at: None,
        }
    }

    #[test]
    fn image_insert_accepts_supported_extensions_case_insensitively() {
        assert_eq!(supported_image_extension(Path::new("/tmp/demo.png")).unwrap(), "png");
        assert_eq!(supported_image_extension(Path::new("/tmp/demo.JPG")).unwrap(), "jpg");
        assert_eq!(supported_image_extension(Path::new("/tmp/demo.jpeg")).unwrap(), "jpeg");
        assert_eq!(supported_image_extension(Path::new("/tmp/demo.GIF")).unwrap(), "gif");
        assert_eq!(supported_image_extension(Path::new("/tmp/demo.WebP")).unwrap(), "webp");
    }

    #[test]
    fn image_insert_rejects_unsupported_extensions() {
        let err = supported_image_extension(Path::new("/tmp/demo.bmp")).unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(err.to_string().contains("Unsupported image type"));
    }

    #[test]
    fn image_insert_accepts_supported_mime_types() {
        assert_eq!(supported_image_extension_from_mime_type("image/png").unwrap(), "png");
        assert_eq!(supported_image_extension_from_mime_type("image/jpeg").unwrap(), "jpeg");
        assert_eq!(supported_image_extension_from_mime_type("image/jpg").unwrap(), "jpg");
        assert_eq!(supported_image_extension_from_mime_type("image/gif").unwrap(), "gif");
        assert_eq!(supported_image_extension_from_mime_type("image/webp").unwrap(), "webp");
        assert_eq!(supported_image_extension_from_mime_type("image/svg+xml").unwrap(), "svg");
        assert_eq!(supported_image_extension_from_mime_type("image/png; charset=binary").unwrap(), "png");
    }

    #[test]
    fn image_insert_rejects_unsupported_mime_types() {
        let err = supported_image_extension_from_mime_type("image/bmp").unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(err.to_string().contains("Unsupported image mime type"));
    }

    #[test]
    fn image_insert_builds_timestamped_filename() {
        assert_eq!(
            build_imported_image_filename("20260609-101010", "a1b2c3", "png"),
            "20260609-101010-a1b2c3.png"
        );
    }

    #[test]
    fn image_insert_builds_markdown_asset_path_relative_to_note_directory() {
        assert_eq!(
            build_markdown_asset_path_for_note("notes/current.md", "assets/demo.png").unwrap(),
            "../assets/demo.png"
        );
        assert_eq!(
            build_markdown_asset_path_for_note("notes/project/demo.md", "assets/demo.png").unwrap(),
            "../../assets/demo.png"
        );
    }

    #[test]
    fn image_insert_from_selection_returns_none_when_cancelled() {
        let root = TempDir::new().unwrap();

        let result = insert_image_for_note_from_selected_path(
            root.path(),
            "notes/current.md",
            None,
            "20260609-101010",
            "a1b2c3",
        )
        .unwrap();

        assert_eq!(result, None);
    }

    #[test]
    fn native_clipboard_no_image_detection_accepts_expected_platform_messages() {
        assert!(native_clipboard_error_means_no_image(
            "The clipboard contents were not available in the requested format or the clipboard is empty."
        ));
        assert!(native_clipboard_error_means_no_image(
            "Clipboard content not available"
        ));
        assert!(native_clipboard_error_means_no_image(
            "The clipboard does not contain an image"
        ));
    }

    #[test]
    fn native_clipboard_no_image_detection_rejects_real_failures() {
        assert!(!native_clipboard_error_means_no_image(
            "Unable to access clipboard backend"
        ));
    }

    #[test]
    fn image_insert_from_selection_copies_file_into_root_assets_and_returns_note_relative_markdown_path() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/project")).unwrap();
        std::fs::create_dir_all(root.path().join("assets")).unwrap();

        let source_dir = TempDir::new().unwrap();
        let source_path = source_dir.path().join("cover.PNG");
        std::fs::write(&source_path, b"fake-png").unwrap();

        let result = insert_image_for_note_from_selected_path(
            root.path(),
            "notes/project/demo.md",
            Some(source_path.as_path()),
            "20260609-101010",
            "a1b2c3",
        )
        .unwrap();

        assert_eq!(
            result,
            Some(InsertImageResult {
                markdown_path: "../../assets/20260609-101010-a1b2c3.png".into(),
            })
        );
        assert_eq!(
            std::fs::read(root.path().join("assets/20260609-101010-a1b2c3.png")).unwrap(),
            b"fake-png"
        );
    }

    #[test]
    fn image_insert_from_clipboard_bytes_writes_file_and_returns_note_relative_markdown_path() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/project")).unwrap();
        std::fs::create_dir_all(root.path().join("assets")).unwrap();

        let result = insert_pasted_image_for_note_from_bytes(
            root.path(),
            "notes/project/demo.md",
            "image/png",
            b"fake-png-bytes",
            "20260610-101010",
            "f0e1d2",
        )
        .unwrap();

        assert_eq!(
            result,
            InsertImageResult {
                markdown_path: "../../assets/20260610-101010-f0e1d2.png".into(),
            }
        );
        assert_eq!(
            std::fs::read(root.path().join("assets/20260610-101010-f0e1d2.png")).unwrap(),
            b"fake-png-bytes"
        );
    }

    #[tokio::test]
    async fn rewrite_pasted_remote_images_in_text_downloads_and_rewrites_remote_markdown_image() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/project")).unwrap();
        std::fs::create_dir_all(root.path().join("assets")).unwrap();

        let mut server = Server::new_async().await;
        let image_mock = server
            .mock("GET", "/remote.png")
            .with_status(200)
            .with_header("content-type", "image/png")
            .with_body(vec![1_u8, 2, 3, 4])
            .create_async()
            .await;

        let source = format!("![]({}/remote.png)", server.url());
        let rewritten = rewrite_pasted_remote_images_in_text(
            root.path(),
            "notes/project/demo.md",
            &source,
            "20260613-101010",
            "a1b2c3",
        )
        .await
        .unwrap();

        image_mock.assert_async().await;
        assert_eq!(rewritten, "![图片](../../assets/20260613-101010-a1b2c3.png)");
        assert_eq!(
            std::fs::read(root.path().join("assets/20260613-101010-a1b2c3.png")).unwrap(),
            vec![1_u8, 2, 3, 4]
        );
    }

    #[test]
    fn convert_pasted_html_to_text_preserves_remote_image_placeholders() {
        let html = "<section><p>流程图</p><img src=\"https://cdn.example.com/html.png\" width=\"600\"></section>";

        let converted = convert_pasted_html_to_text(html).unwrap();

        assert!(converted.contains("流程图"));
        assert!(converted.contains("<img src=\"https://cdn.example.com/html.png\">"));
    }

    #[test]
    fn delete_note_in_root_removes_note_and_linked_assets_and_marks_note_deleted() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join("assets")).unwrap();
        std::fs::write(root.path().join("assets/demo.png"), b"image-bytes").unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let content = "# Demo\n\n![img](../../assets/demo.png)\n";
        std::fs::write(root.path().join("notes/work/demo.md"), content).unwrap();
        index_note_full(&conn, root.path(), "notes/work/demo.md", content).unwrap();

        delete_note_in_root(&conn, root.path(), "notes/work/demo.md").unwrap();

        assert!(!root.path().join("notes/work/demo.md").exists());
        assert!(!root.path().join("assets/demo.png").exists());

        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM notes WHERE path = ?1",
                params!["notes/work/demo.md"],
                |row| row.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());
    }

    #[test]
    fn delete_note_in_root_keeps_assets_still_referenced_by_other_notes() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/other")).unwrap();
        std::fs::create_dir_all(root.path().join("assets")).unwrap();
        std::fs::write(root.path().join("assets/shared.png"), b"image-bytes").unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let demo_content = "# Demo\n\n![img](../../assets/shared.png)\n";
        let other_content = "# Other\n\n![img](../../assets/shared.png)\n";
        std::fs::write(root.path().join("notes/work/demo.md"), demo_content).unwrap();
        std::fs::write(root.path().join("notes/other/keep.md"), other_content).unwrap();
        index_note_full(&conn, root.path(), "notes/work/demo.md", demo_content).unwrap();
        index_note_full(&conn, root.path(), "notes/other/keep.md", other_content).unwrap();

        delete_note_in_root(&conn, root.path(), "notes/work/demo.md").unwrap();

        assert!(!root.path().join("notes/work/demo.md").exists());
        assert!(root.path().join("notes/other/keep.md").exists());
        assert!(root.path().join("assets/shared.png").exists());
    }

    #[test]
    fn delete_note_in_root_returns_not_found_when_note_file_missing() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();

        let err = delete_note_in_root(&conn, root.path(), "notes/work/missing.md").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn create_notebook_service_creates_top_level_notebook_under_notes_only() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let _conn = open_and_migrate(&db_path).unwrap();

        let created = create_notebook_in_root(root.path(), "法律", "book", "blue").unwrap();
        assert_eq!(created, "notes/法律");
        assert!(root.path().join("notes/法律").is_dir());

        let dotted = create_notebook_in_root(root.path(), "v1..2", "folder", "gray").unwrap();
        assert_eq!(dotted, "notes/v1..2");
        assert!(root.path().join("notes/v1..2").is_dir());

        assert!(create_notebook_in_root(root.path(), "", "book", "blue").is_err());
        assert!(create_notebook_in_root(root.path(), ".", "book", "blue").is_err());
        assert!(create_notebook_in_root(root.path(), "..", "book", "blue").is_err());
        assert!(create_notebook_in_root(root.path(), "法律", "book", "blue").is_err());
        assert!(create_notebook_in_root(root.path(), "notes/二级", "book", "blue").is_err());
        assert!(create_notebook_in_root(root.path(), "../outside", "book", "blue").is_err());
        assert!(create_notebook_in_root(root.path(), "案例\\子类", "book", "blue").is_err());
    }

    #[test]
    fn create_notebook_service_writes_visual_metadata() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();

        let created = create_notebook_in_root(root.path(), "法律", "book", "blue").unwrap();
        assert_eq!(created, "notes/法律");

        let visuals = crate::services::notebook_visual::load_notebook_visuals(root.path());
        let legal_visual = visuals.get("notes/法律").expect("expected visual metadata");
        assert_eq!(legal_visual.icon, "book");
        assert_eq!(legal_visual.color, "blue");
    }

    #[test]
    fn create_note_service_rejects_directories_outside_notes_root() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();
        std::fs::create_dir_all(root.path().join("assets")).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();

        let err = create_note_in_root(
            &conn,
            root.path(),
            CreateNoteInput {
                title: "Demo".into(),
                directory: "assets".into(),
            },
        )
        .unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(!root.path().join("assets/Demo.md").exists());
    }

    #[test]
    fn get_note_outline_in_root_returns_nested_outline_items() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();

        let rel_path = "notes/outline.md";
        let content = concat!(
            "---\n",
            "title: Outline\n",
            "---\n\n",
            "# Alpha\n",
            "intro\n\n",
            "## Beta\n",
            "beta body\n\n",
            "### Gamma\n",
            "gamma body\n\n",
            "## Delta\n",
            "delta body\n",
        );
        std::fs::write(root.path().join(rel_path), content).unwrap();

        let outline = get_note_outline_in_root(root.path(), rel_path).unwrap();

        assert_eq!(outline.len(), 1);
        assert_eq!(outline[0].id, "alpha:5");
        assert_eq!(outline[0].text, "Alpha");
        assert_eq!(outline[0].level, 1);
        assert_eq!(outline[0].line_start, 5);
        assert_eq!(outline[0].line_end, 15);
        assert_eq!(outline[0].anchor, "alpha");

        assert_eq!(outline[0].children.len(), 2);

        let beta = &outline[0].children[0];
        assert_eq!(beta.id, "beta:8");
        assert_eq!(beta.text, "Beta");
        assert_eq!(beta.level, 2);
        assert_eq!(beta.line_start, 8);
        assert_eq!(beta.line_end, 13);
        assert_eq!(beta.anchor, "beta");
        assert_eq!(beta.children.len(), 1);

        let gamma = &beta.children[0];
        assert_eq!(gamma.id, "gamma:11");
        assert_eq!(gamma.text, "Gamma");
        assert_eq!(gamma.level, 3);
        assert_eq!(gamma.line_start, 11);
        assert_eq!(gamma.line_end, 13);
        assert_eq!(gamma.anchor, "gamma");
        assert!(gamma.children.is_empty());

        let delta = &outline[0].children[1];
        assert_eq!(delta.id, "delta:14");
        assert_eq!(delta.text, "Delta");
        assert_eq!(delta.level, 2);
        assert_eq!(delta.line_start, 14);
        assert_eq!(delta.line_end, 15);
        assert_eq!(delta.anchor, "delta");
        assert!(delta.children.is_empty());
    }

    #[test]
    fn get_note_outline_in_root_supports_top_level_h2_and_duplicate_heading_ids() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();

        let rel_path = "notes/h2-outline.md";
        let content = concat!(
            "## Overview\n",
            "overview body\n\n",
            "### Details\n",
            "details body\n\n",
            "## Overview\n",
            "second overview\n",
        );
        std::fs::write(root.path().join(rel_path), content).unwrap();

        let outline = get_note_outline_in_root(root.path(), rel_path).unwrap();

        assert_eq!(outline.len(), 2);

        let first = &outline[0];
        assert_eq!(first.id, "overview:1");
        assert_eq!(first.level, 2);
        assert_eq!(first.line_start, 1);
        assert_eq!(first.line_end, 6);
        assert_eq!(first.children.len(), 1);
        assert_eq!(first.children[0].id, "details:4");
        assert_eq!(first.children[0].level, 3);

        let second = &outline[1];
        assert_eq!(second.id, "overview:7");
        assert_eq!(second.level, 2);
        assert_eq!(second.line_start, 7);
        assert_eq!(second.line_end, 8);
        assert!(second.children.is_empty());
    }

    #[test]
    fn build_tree_preserves_nested_directories_under_notes() {
        let tree = build_tree(&[
            make_note("notes/我的笔记.md"),
            make_note("notes/法律/案例.md"),
            make_note("notes/法律/法规/条文.md"),
        ]);

        let notes_root = tree.iter().find(|node| node.path == "notes").unwrap();
        assert!(notes_root.is_dir);

        let legal = notes_root.children.iter().find(|node| node.path == "notes/法律").unwrap();
        assert!(legal.is_dir);

        let nested_dir = legal.children.iter().find(|node| node.path == "notes/法律/法规").unwrap();
        assert!(nested_dir.is_dir);

        let statute = nested_dir
            .children
            .iter()
            .find(|node| node.path == "notes/法律/法规/条文.md")
            .unwrap();
        assert!(!statute.is_dir);
        assert_eq!(statute.name, "条文.md");
    }

    #[test]
    fn build_tree_marks_notes_with_summary() {
        let mut note_with_summary = make_note("notes/法律/案例.md");
        note_with_summary.summary = Some("案例摘要".into());

        let tree = build_tree(&[note_with_summary, make_note("notes/法律/空白.md")]);

        let notes_root = tree.iter().find(|node| node.path == "notes").unwrap();
        let legal = notes_root.children.iter().find(|node| node.path == "notes/法律").unwrap();
        let note_with_badge = legal.children.iter().find(|node| node.path == "notes/法律/案例.md").unwrap();
        let note_without_badge = legal.children.iter().find(|node| node.path == "notes/法律/空白.md").unwrap();

        assert!(note_with_badge.has_summary);
        assert!(!note_without_badge.has_summary);
    }

    #[test]
    fn build_tree_includes_empty_notebook_directories() {
        let tree = build_tree_with_directories(&[], &["notes/法律".to_string(), "notes/产品".to_string()]);

        let notes_root = tree.iter().find(|node| node.path == "notes").unwrap();
        assert!(notes_root.is_dir);
        assert!(notes_root.children.iter().any(|node| node.path == "notes/法律" && node.is_dir));
        assert!(notes_root.children.iter().any(|node| node.path == "notes/产品" && node.is_dir));
    }

    #[test]
    fn build_tree_excludes_notebook_subtrees_missing_from_directory_scan() {
        let tree = build_tree_with_visuals(
            &[
                make_note("notes/学习笔记/正常笔记.md"),
                make_note("notes/学习笔记_backup_2026/残留笔记.md"),
            ],
            &["notes/学习笔记".to_string()],
            &NotebookVisualMap::new(),
        );

        let notes_root = tree.iter().find(|node| node.path == "notes").unwrap();
        let child_paths = notes_root
            .children
            .iter()
            .map(|node| node.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(child_paths, vec!["notes/学习笔记"]);
    }

    #[test]
    fn build_tree_applies_visuals_only_to_top_level_notebooks() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/法律/案例")).unwrap();
        save_notebook_visual(root.path(), "notes/法律", "book", "blue", None).unwrap();
        let visuals = load_notebook_visuals(root.path());

        let tree = build_tree_with_visuals(
            &[],
            &["notes/法律".to_string(), "notes/法律/案例".to_string()],
            &visuals,
        );

        let notes_root = tree.iter().find(|node| node.path == "notes").unwrap();
        let legal = notes_root.children.iter().find(|node| node.path == "notes/法律").unwrap();
        assert_eq!(legal.notebook_icon.as_deref(), Some("book"));
        assert_eq!(legal.notebook_color.as_deref(), Some("blue"));

        let nested = legal.children.iter().find(|node| node.path == "notes/法律/案例").unwrap();
        assert_eq!(nested.notebook_icon, None);
        assert_eq!(nested.notebook_color, None);
    }

    #[test]
    fn move_note_in_root_moves_note_into_target_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let src_abs = root.path().join(src_rel);
        let content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(&src_abs, content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, content).unwrap();

        let moved = move_note_in_root(&conn, root.path(), &original.path, "notes/法律").unwrap();

        assert_eq!(moved.id, original.id);
        assert_eq!(moved.path, "notes/法律/合同审查.md");
        assert!(root.path().join("notes/法律/合同审查.md").exists());
        assert!(!root.path().join(src_rel).exists());

        let old_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes WHERE path = ?1", [src_rel], |row| row.get(0))
            .unwrap();
        assert_eq!(old_count, 0);

        let new_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes WHERE path = ?1", [moved.path.as_str()], |row| row.get(0))
            .unwrap();
        assert_eq!(new_count, 1);
    }

    #[test]
    fn move_note_in_root_renames_when_target_has_same_filename() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let src_abs = root.path().join(src_rel);
        let content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(&src_abs, content).unwrap();
        std::fs::write(root.path().join("notes/法律/合同审查.md"), "# existing\n").unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, content).unwrap();

        let moved = move_note_in_root(&conn, root.path(), &original.path, "notes/法律").unwrap();

        assert_eq!(moved.id, original.id);
        assert_eq!(moved.path, "notes/法律/合同审查-1.md");
        assert!(root.path().join("notes/法律/合同审查-1.md").exists());
    }

    #[test]
    fn move_note_in_root_is_noop_when_note_already_in_target_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

        let src_rel = "notes/法律/合同审查.md";
        let src_abs = root.path().join(src_rel);
        let content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(&src_abs, content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, content).unwrap();

        let moved = move_note_in_root(&conn, root.path(), &original.path, "notes/法律").unwrap();

        assert_eq!(moved.id, original.id);
        assert_eq!(moved.path, original.path);
        assert!(root.path().join(src_rel).exists());
    }

    #[test]
    fn rename_note_in_root_renames_note_and_preserves_note_id() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        let source_rel = "notes/work/demo.md";
        let source_abs = root.path().join(source_rel);
        let content = "---\nid: note-demo\ntitle: Demo\n---\n\n# Demo\n";
        std::fs::write(&source_abs, content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), source_rel, content).unwrap();

        let renamed = rename_note_in_root(&conn, root.path(), source_rel, "demo-renamed").unwrap();

        assert_eq!(renamed.id, original.id);
        assert_eq!(renamed.path, "notes/work/demo-renamed.md");
        assert!(root.path().join("notes/work/demo-renamed.md").exists());
        assert!(!root.path().join(source_rel).exists());
    }

    #[test]
    fn rename_note_in_root_uses_suffix_when_target_name_exists() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        std::fs::write(root.path().join("notes/work/demo-renamed.md"), "# existing\n").unwrap();

        let source_rel = "notes/work/demo.md";
        let source_abs = root.path().join(source_rel);
        let content = "---\nid: note-demo\ntitle: Demo\n---\n\n# Demo\n";
        std::fs::write(&source_abs, content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let _original = index_note_full(&conn, root.path(), source_rel, content).unwrap();

        let renamed = rename_note_in_root(&conn, root.path(), source_rel, "demo-renamed").unwrap();

        assert_eq!(renamed.path, "notes/work/demo-renamed-1.md");
        assert!(root.path().join("notes/work/demo-renamed-1.md").exists());
    }

    #[test]
    fn rename_note_in_root_keeps_same_path_when_name_is_unchanged() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        let source_rel = "notes/work/demo.md";
        let source_abs = root.path().join(source_rel);
        let content = "---\nid: note-demo\ntitle: Demo\n---\n\n# Demo\n";
        std::fs::write(&source_abs, content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), source_rel, content).unwrap();

        let renamed = rename_note_in_root(&conn, root.path(), source_rel, "demo").unwrap();

        assert_eq!(renamed.id, original.id);
        assert_eq!(renamed.path, source_rel);
        assert!(root.path().join(source_rel).exists());
        assert!(!root.path().join("notes/work/demo-1.md").exists());
    }

    #[test]
    fn move_note_in_root_skips_soft_deleted_target_path_and_uses_next_suffix() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let source_content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(root.path().join(src_rel), source_content).unwrap();

        let deleted_rel = "notes/法律/合同审查.md";
        let deleted_content = "---\nid: deleted-note\ntitle: 历史合同审查\n---\n\n# 历史合同审查\n";
        std::fs::write(root.path().join(deleted_rel), deleted_content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, source_content).unwrap();
        let deleted = index_note_full(&conn, root.path(), deleted_rel, deleted_content).unwrap();
        conn.execute(
            "UPDATE notes SET deleted_at = datetime('now') WHERE id = ?1",
            params![deleted.id],
        )
        .unwrap();
        std::fs::remove_file(root.path().join(deleted_rel)).unwrap();

        let moved = move_note_in_root(&conn, root.path(), &original.path, "notes/法律").unwrap();

        assert_eq!(moved.id, original.id);
        assert_eq!(moved.path, "notes/法律/合同审查-1.md");
        assert!(root.path().join("notes/法律/合同审查-1.md").exists());

        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM notes WHERE id = ?1",
                params![deleted.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());
    }

    #[test]
    fn move_note_in_root_moves_note_into_nested_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/法律/合同")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(root.path().join(src_rel), content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, content).unwrap();

        let moved = move_note_in_root(&conn, root.path(), &original.path, "notes/法律/合同").unwrap();

        assert_eq!(moved.id, original.id);
        assert_eq!(moved.path, "notes/法律/合同/合同审查.md");
        assert!(root.path().join("notes/法律/合同/合同审查.md").exists());
    }

    #[test]
    fn move_note_in_root_rejects_unarchived_placeholder_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/__unarchived__")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(root.path().join(src_rel), content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, content).unwrap();

        let err = move_note_in_root(&conn, root.path(), &original.path, "notes/__unarchived__")
            .unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[test]
    fn move_note_in_root_rejects_unarchived_placeholder_descendant_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/__unarchived__/子目录")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(root.path().join(src_rel), content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, content).unwrap();

        let err = move_note_in_root(&conn, root.path(), &original.path, "notes/__unarchived__/子目录")
            .unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[cfg(unix)]
    #[test]
    fn move_note_in_root_rejects_symlink_target_directory() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let external = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        symlink(external.path(), root.path().join("notes/外链")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(root.path().join(src_rel), content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, content).unwrap();

        let err = move_note_in_root(&conn, root.path(), &original.path, "notes/外链").unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(root.path().join(src_rel).exists());
    }

    #[test]
    fn move_note_in_root_rolls_back_when_reindex_fails_after_rename() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let valid_content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(root.path().join(src_rel), valid_content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let original = index_note_full(&conn, root.path(), src_rel, valid_content).unwrap();

        let invalid_content = "---\n: bad yaml\n---\n\n# Broken\n";
        std::fs::write(root.path().join(src_rel), invalid_content).unwrap();

        let err = move_note_in_root(&conn, root.path(), &original.path, "notes/法律").unwrap_err();

        assert!(matches!(err, AppError::Parse(_)));
        assert!(root.path().join(src_rel).exists());
        assert!(!root.path().join("notes/法律/合同审查.md").exists());

        let stored_path: String = conn
            .query_row("SELECT path FROM notes WHERE id = ?1", params![original.id], |row| row.get(0))
            .unwrap();
        assert_eq!(stored_path, src_rel);
    }

    #[test]
    fn move_note_in_root_returns_not_found_when_source_file_is_not_indexed() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

        let src_rel = "notes/source/合同审查.md";
        let content = "---\nid: note-contract\ntitle: 合同审查\n---\n\n# 合同审查\n";
        std::fs::write(root.path().join(src_rel), content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();

        let err = move_note_in_root(&conn, root.path(), src_rel, "notes/法律").unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
        assert!(root.path().join(src_rel).exists());
    }

    #[test]
    fn import_markdown_sources_preserves_selected_directory_name_and_nested_paths() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        let source_root = TempDir::new().unwrap();
        let project_dir = source_root.path().join("project");
        std::fs::create_dir_all(project_dir.join("docs")).unwrap();
        std::fs::write(project_dir.join("docs/a.md"), "# A\n").unwrap();

        let result = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::Directory {
                    path: project_dir.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/work".into(),
            },
        )
        .unwrap();

        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].note.path, "notes/work/project/docs/a.md");
    }

    #[test]
    fn import_markdown_sources_copies_relative_images_inside_selected_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        let source_root = TempDir::new().unwrap();
        let project_dir = source_root.path().join("project");
        std::fs::create_dir_all(project_dir.join("docs/images")).unwrap();
        std::fs::write(project_dir.join("docs/images/p1.png"), b"png").unwrap();
        std::fs::write(
            project_dir.join("docs/a.md"),
            "# A\n\n![cover](./images/p1.png)\n",
        )
        .unwrap();

        let result = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::Directory {
                    path: project_dir.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/work".into(),
            },
        )
        .unwrap();

        assert!(root.path().join("notes/work/project/docs/images/p1.png").exists());
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn import_markdown_sources_warns_when_relative_image_points_outside_selected_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        let source_root = TempDir::new().unwrap();
        let project_dir = source_root.path().join("project");
        let shared_dir = source_root.path().join("shared");
        std::fs::create_dir_all(project_dir.join("docs")).unwrap();
        std::fs::create_dir_all(&shared_dir).unwrap();
        std::fs::write(shared_dir.join("cover.png"), b"png").unwrap();
        std::fs::write(
            project_dir.join("docs/a.md"),
            "# A\n\n![cover](../shared/cover.png)\n",
        )
        .unwrap();

        let result = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::Directory {
                    path: project_dir.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/work".into(),
            },
        )
        .unwrap();

        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.warnings.len(), 1);
    }

    #[test]
    fn import_markdown_sources_rejects_invalid_target_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/__unarchived__")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        let source_root = TempDir::new().unwrap();
        let markdown_path = source_root.path().join("a.md");
        std::fs::write(&markdown_path, "# A\n").unwrap();

        let err = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::File {
                    path: markdown_path.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/__unarchived__".into(),
            },
        )
        .unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[test]
    fn import_markdown_sources_creates_missing_target_directory_under_notes() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        let source_root = TempDir::new().unwrap();
        let markdown_path = source_root.path().join("a.md");
        std::fs::write(&markdown_path, "# A\n").unwrap();

        let result = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::File {
                    path: markdown_path.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/new-folder".into(),
            },
        )
        .unwrap();

        assert_eq!(result.imported.len(), 1);
        assert!(root.path().join("notes/new-folder").is_dir());
        assert_eq!(result.imported[0].note.path, "notes/new-folder/a.md");
    }

    #[test]
    fn import_markdown_sources_allows_notes_root_as_target_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        let source_root = TempDir::new().unwrap();
        let markdown_path = source_root.path().join("root-note.md");
        std::fs::write(&markdown_path, "# Root\n").unwrap();

        let result = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::File {
                    path: markdown_path.to_string_lossy().to_string(),
                }],
                dest_directory: "notes".into(),
            },
        )
        .unwrap();

        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].note.path, "notes/root-note.md");
    }

    #[cfg(unix)]
    #[test]
    fn import_markdown_sources_rejects_symlink_target_directory() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let external = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();
        symlink(external.path(), root.path().join("notes/外链")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        let source_root = TempDir::new().unwrap();
        let markdown_path = source_root.path().join("a.md");
        std::fs::write(&markdown_path, "# A\n").unwrap();

        let err = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::File {
                    path: markdown_path.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/外链".into(),
            },
        )
        .unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[test]
    fn import_markdown_sources_uses_next_available_path_when_database_already_reserves_target() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at) \
             VALUES (?1, ?2, ?3, NULL, ?4, 0, datetime('now'), datetime('now'), datetime('now'), datetime('now'))",
            params!["reserved-note", "notes/work/a.md", "Reserved", "hash"],
        )
        .unwrap();

        let source_root = TempDir::new().unwrap();
        let markdown_path = source_root.path().join("a.md");
        std::fs::write(&markdown_path, "# Imported\n").unwrap();

        let result = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::File {
                    path: markdown_path.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/work".into(),
            },
        )
        .unwrap();

        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].note.path, "notes/work/a-1.md");
        assert!(root.path().join("notes/work/a-1.md").exists());

        let reserved_deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM notes WHERE id = ?1",
                params!["reserved-note"],
                |row| row.get(0),
            )
            .unwrap();
        assert!(reserved_deleted_at.is_some());
    }

        #[test]
        fn import_single_markdown_file_in_root_reuses_same_managed_path_without_copy_suffix() {
            let root = TempDir::new().unwrap();
            std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

            let source_rel = "notes/work/demo.md";
            let source_abs = root.path().join(source_rel);
            let content = "---\nid: note-demo\ntitle: Demo\n---\n\n# Demo\n";
            std::fs::write(&source_abs, content).unwrap();

            let db_path = root.path().join("index.sqlite");
            let conn = open_and_migrate(&db_path).unwrap();
            let original = index_note_full(&conn, root.path(), source_rel, content).unwrap();

            let imported = import_single_markdown_file_in_root(
                &conn,
                root.path(),
                &source_abs.to_string_lossy(),
                "notes/work",
            )
            .unwrap();

            assert_eq!(imported.id, original.id);
            assert_eq!(imported.path, source_rel);
            assert!(root.path().join(source_rel).exists());
            assert!(!root.path().join("notes/work/demo-1.md").exists());
        }

    #[test]
    fn import_markdown_sources_renames_conflicting_assets_and_rewrites_imported_note_links() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        let db_path = root.path().join("index.sqlite");
        let mut conn = open_and_migrate(&db_path).unwrap();

        let first_source_root = TempDir::new().unwrap();
        let first_project_dir = first_source_root.path().join("project");
        std::fs::create_dir_all(first_project_dir.join("docs/images")).unwrap();
        std::fs::write(first_project_dir.join("docs/images/p1.png"), b"first-image").unwrap();
        std::fs::write(
            first_project_dir.join("docs/a.md"),
            "# A\n\n![cover](./images/p1.png)\n",
        )
        .unwrap();

        let second_source_root = TempDir::new().unwrap();
        let second_project_dir = second_source_root.path().join("project");
        std::fs::create_dir_all(second_project_dir.join("docs/images")).unwrap();
        std::fs::write(second_project_dir.join("docs/images/p1.png"), b"second-image").unwrap();
        std::fs::write(
            second_project_dir.join("docs/a.md"),
            "# A\n\n![cover](./images/p1.png)\n",
        )
        .unwrap();

        import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::Directory {
                    path: first_project_dir.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/work".into(),
            },
        )
        .unwrap();

        let second_result = import_markdown_sources_in_root(
            &mut conn,
            root.path(),
            MarkdownImportRequest {
                sources: vec![MarkdownImportSource::Directory {
                    path: second_project_dir.to_string_lossy().to_string(),
                }],
                dest_directory: "notes/work".into(),
            },
        )
        .unwrap();

        assert_eq!(std::fs::read(root.path().join("notes/work/project/docs/images/p1.png")).unwrap(), b"first-image");
        assert_eq!(std::fs::read(root.path().join("notes/work/project/docs/images/p1-1.png")).unwrap(), b"second-image");
        assert_eq!(second_result.imported.len(), 1);
        assert_eq!(second_result.imported[0].note.path, "notes/work/project/docs/a-1.md");

        let imported_content = std::fs::read_to_string(root.path().join("notes/work/project/docs/a-1.md")).unwrap();
        assert!(imported_content.contains("![cover](images/p1-1.png)"));
    }

    #[test]
    fn rename_notebook_in_root_updates_directory_and_note_paths() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();

        let first_rel = "notes/source/alpha.md";
        let second_rel = "notes/source/nested/beta.md";
        std::fs::create_dir_all(root.path().join("notes/source/nested")).unwrap();
        let first_content = "---\nid: note-alpha\ntitle: Alpha\n---\n\n# Alpha\n";
        let second_content = "---\nid: note-beta\ntitle: Beta\n---\n\n# Beta\n";
        std::fs::write(root.path().join(first_rel), first_content).unwrap();
        std::fs::write(root.path().join(second_rel), second_content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        index_note_full(&conn, root.path(), first_rel, first_content).unwrap();
        index_note_full(&conn, root.path(), second_rel, second_content).unwrap();
        save_notebook_visual(root.path(), "notes/source", "book", "blue", Some(7)).unwrap();

        let result = rename_notebook_in_root(&conn, root.path(), "notes/source", "target").unwrap();

        assert_eq!(result.notebook_path, "notes/target");
        assert_eq!(result.moved_note_paths.len(), 2);
        assert!(result
            .moved_note_paths
            .contains(&(first_rel.to_string(), "notes/target/alpha.md".to_string())));
        assert!(result
            .moved_note_paths
            .contains(&(second_rel.to_string(), "notes/target/nested/beta.md".to_string())));
        assert!(!root.path().join("notes/source").exists());
        assert!(root.path().join("notes/target/alpha.md").exists());
        assert!(root.path().join("notes/target/nested/beta.md").exists());

        let stored_paths = conn
            .prepare("SELECT path FROM notes ORDER BY path")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(stored_paths, vec!["notes/target/alpha.md", "notes/target/nested/beta.md"]);
    }

    #[test]
    fn rename_notebook_in_root_preserves_metadata_order() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        save_notebook_visual(root.path(), "notes/source", "book", "blue", Some(12)).unwrap();

        rename_notebook_in_root(&conn, root.path(), "notes/source", "renamed").unwrap();

        let visuals = load_notebook_visuals(root.path());
        assert!(visuals.get("notes/source").is_none());
        let renamed = visuals.get("notes/renamed").unwrap();
        assert_eq!(renamed.icon, "book");
        assert_eq!(renamed.color, "blue");
        assert_eq!(renamed.order, Some(12));
    }

    #[test]
    fn rename_notebook_in_root_supports_case_only_rename_on_case_insensitive_filesystems() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        if !root.path().join("notes/Work").exists() {
            return;
        }

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        save_notebook_visual(root.path(), "notes/work", "book", "blue", Some(3)).unwrap();

        let result = rename_notebook_in_root(&conn, root.path(), "notes/work", "Work").unwrap();

        assert_eq!(result.notebook_path, "notes/Work");
        assert!(root.path().join("notes/Work").is_dir());
        let visuals = load_notebook_visuals(root.path());
        assert!(visuals.get("notes/work").is_none());
        assert_eq!(visuals.get("notes/Work").unwrap().order, Some(3));
    }

    #[test]
    fn delete_notebook_in_root_rejects_non_empty_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::write(root.path().join("notes/work/todo.md"), "# todo\n").unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        save_notebook_visual(root.path(), "notes/work", "idea", "cyan", Some(2)).unwrap();

        let err = delete_notebook_in_root(&conn, root.path(), "notes/work").unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(err.to_string().contains("只能删除空笔记本"));
        assert!(root.path().join("notes/work").exists());
        assert!(load_notebook_visuals(root.path()).get("notes/work").is_some());
    }

    #[test]
    fn delete_notebook_in_root_removes_empty_directory_and_metadata() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        save_notebook_visual(root.path(), "notes/work", "idea", "cyan", Some(2)).unwrap();

        delete_notebook_in_root(&conn, root.path(), "notes/work").unwrap();

        assert!(!root.path().join("notes/work").exists());
        assert!(load_notebook_visuals(root.path()).get("notes/work").is_none());
    }

    #[test]
    fn delete_notebook_in_root_rejects_indexed_notes_when_directory_is_empty() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        let note_rel = "notes/work/ghost.md";
        let note_content = "---\nid: ghost\ntitle: Ghost\n---\n\n# Ghost\n";
        std::fs::write(root.path().join(note_rel), note_content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        index_note_full(&conn, root.path(), note_rel, note_content).unwrap();
        std::fs::remove_file(root.path().join(note_rel)).unwrap();

        let err = delete_notebook_in_root(&conn, root.path(), "notes/work").unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(err.to_string().contains("只能删除空笔记本"));
        assert!(root.path().join("notes/work").exists());
    }

    #[test]
    fn delete_notebook_in_root_restores_directory_when_metadata_delete_fails() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join(".mynote")).unwrap();
        std::fs::write(
            root.path().join(".mynote/notebook-visuals.json"),
            "{not-valid-json",
        )
        .unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();

        let err = delete_notebook_in_root(&conn, root.path(), "notes/work").unwrap_err();

        assert!(matches!(err, AppError::Parse(_)));
        assert!(root.path().join("notes/work").is_dir());
    }

    #[test]
    fn list_notes_in_conn_excludes_local_conflict_files() {
        let root = TempDir::new().unwrap();
        let conn = open_and_migrate(&root.path().join("index.sqlite")).unwrap();

        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at)
             VALUES (?1, ?2, ?3, NULL, 'hash-1', 0, '{}', 'now', 'now', 'now')",
            params!["note-1", "notes/visible.md", "Visible"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at)
             VALUES (?1, ?2, ?3, NULL, 'hash-2', 0, '{}', 'now', 'now', 'now')",
            params!["note-2", "notes/visible.local-conflict.md", "Conflict"],
        )
        .unwrap();

        let notes = list_notes_in_conn(&conn).unwrap();

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].path, "notes/visible.md");
    }

    #[test]
    fn save_note_conflict_writes_backup_outside_notes_directory() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        let note_rel = "notes/work/demo.md";
        let original_content = "---\nid: demo\ntitle: Demo\n---\n\n# Demo\n";
        std::fs::write(root.path().join(note_rel), original_content).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        let indexed = index_note_full(&conn, root.path(), note_rel, original_content).unwrap();

        let stale_hash = "stale-hash";
        let draft_content = "# local draft\n\nchanged";

        let conflict_result = save_note_in_root(
            &conn,
            root.path(),
            SaveNoteInput {
                note_id: indexed.id.clone(),
                content: draft_content.to_string(),
                expected_hash: Some(stale_hash.to_string()),
            },
        )
        .unwrap();

        assert!(conflict_result.conflict);
        assert_eq!(std::fs::read_to_string(root.path().join(note_rel)).unwrap(), original_content);
        assert!(!root.path().join("notes/work/demo.local-conflict.md").exists());

        let conflict_dir = root.path().join(".mynote/conflicts");
        let entries = std::fs::read_dir(&conflict_dir)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(std::fs::read_to_string(entries[0].path()).unwrap(), draft_content);
    }

    #[test]
    fn reorder_notebooks_in_root_updates_top_level_tree_order() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/zeta/topic")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/alpha")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/beta")).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        save_notebook_visual(root.path(), "notes/zeta", "book", "blue", Some(50)).unwrap();
        save_notebook_visual(root.path(), "notes/alpha", "idea", "cyan", Some(10)).unwrap();

        reorder_notebooks_in_root(
            &conn,
            root.path(),
            &[
                "notes/beta".to_string(),
                "notes/zeta".to_string(),
                "notes/alpha".to_string(),
            ],
        )
        .unwrap();

        let visuals = load_notebook_visuals(root.path());
        assert_eq!(visuals.get("notes/beta").unwrap().order, Some(0));
        assert_eq!(visuals.get("notes/zeta").unwrap().order, Some(1));
        assert_eq!(visuals.get("notes/alpha").unwrap().order, Some(2));

        let tree = build_tree_with_visuals(
            &[],
            &[
                "notes/zeta".to_string(),
                "notes/zeta/topic".to_string(),
                "notes/alpha".to_string(),
                "notes/beta".to_string(),
            ],
            &visuals,
        );

        let notes_root = tree.iter().find(|node| node.path == "notes").unwrap();
        let ordered_paths = notes_root
            .children
            .iter()
            .map(|node| node.path.clone())
            .collect::<Vec<_>>();
        assert_eq!(ordered_paths, vec!["notes/beta", "notes/zeta", "notes/alpha"]);

        let zeta = notes_root.children.iter().find(|node| node.path == "notes/zeta").unwrap();
        assert_eq!(zeta.children.iter().map(|node| node.path.as_str()).collect::<Vec<_>>(), vec!["notes/zeta/topic"]);
    }

    #[test]
    fn update_notebook_visual_in_root_preserves_order() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        save_notebook_visual(root.path(), "notes/work", "book", "blue", Some(9)).unwrap();

        update_notebook_visual_in_root(&conn, root.path(), "notes/work", "star", "orange").unwrap();

        let visuals = load_notebook_visuals(root.path());
        let work = visuals.get("notes/work").unwrap();
        assert_eq!(work.icon, "star");
        assert_eq!(work.color, "orange");
        assert_eq!(work.order, Some(9));
    }

    #[test]
    fn reorder_notebooks_in_root_clears_order_for_unlisted_top_level_notebooks() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/alpha")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/beta")).unwrap();

        let db_path = root.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        save_notebook_visual(root.path(), "notes/alpha", "book", "blue", Some(5)).unwrap();
        save_notebook_visual(root.path(), "notes/beta", "idea", "cyan", Some(6)).unwrap();

        reorder_notebooks_in_root(&conn, root.path(), &["notes/beta".to_string()]).unwrap();

        let visuals = load_notebook_visuals(root.path());
        assert_eq!(visuals.get("notes/beta").unwrap().order, Some(0));
        assert_eq!(visuals.get("notes/alpha").unwrap().order, None);
    }
}

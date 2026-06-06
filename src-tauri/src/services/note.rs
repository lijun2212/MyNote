use crate::domain::note::{
    CreateNoteInput, CreateNotebookInput, Note, NoteDetail, NoteTreeNode,
    RenameNotebookResult, SaveNoteInput, SaveNoteResult,
};
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{atomic_write, normalize_kb_relative_path, resolve_kb_path, safe_filename};
use crate::infrastructure::markdown::{render_note, FrontMatter};
use crate::services::index::index_note_full;
use crate::services::notebook_visual::{
    delete_notebook_visual, load_notebook_visuals, rename_notebook_visual,
    save_notebook_visual, visual_for_path, NotebookVisualMap,
};
use crate::state::AppState;
use rusqlite::params;
use rusqlite::OptionalExtension;
use std::collections::HashSet;
use std::path::Path;
use tauri::State;
use ulid::Ulid;

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

pub fn create_note_service(state: &State<AppState>, input: CreateNoteInput) -> AppResult<Note> {
    let root_guard = state.kb_root_guard();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db_guard();
    let conn = db_guard.as_mut().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let safe_title = safe_filename(&input.title);
    let dir = normalize_kb_relative_path(if input.directory.is_empty() { "notes" } else { &input.directory })?;
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

    let note = index_note_full(conn, root, &rel_path, &content)?;
    Ok(note)
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

pub fn save_note_service(state: &State<AppState>, input: SaveNoteInput) -> AppResult<SaveNoteResult> {
    let root_guard = state.kb_root_guard();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db_guard();
    let conn = db_guard.as_mut().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let (path, current_hash): (String, String) = conn.query_row(
        "SELECT path, content_hash FROM notes WHERE id = ?1",
        params![input.note_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| AppError::NotFound(format!("Note not found: {}", input.note_id)))?;

    // Conflict detection
    if let Some(expected) = &input.expected_hash {
        if expected != &current_hash {
            let conflict_path = path.replace(".md", ".local-conflict.md");
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

pub fn list_notes_service(state: &State<AppState>) -> AppResult<Vec<Note>> {
    let db_guard = state.db_guard();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let mut stmt = conn.prepare(
        "SELECT id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at FROM notes WHERE deleted_at IS NULL ORDER BY path"
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

    Ok(notes)
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
            "Notebook directory is not empty: {}",
            notebook_path
        )));
    }
    if std::fs::read_dir(&notebook_abs)?.next().transpose()?.is_some() {
        return Err(AppError::InvalidInput(format!(
            "Notebook directory is not empty: {}",
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

pub fn move_note_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    source_path: &str,
    target_directory: &str,
) -> AppResult<Note> {
    let source_rel = normalize_kb_relative_path(source_path)?;
    let target_dir = normalize_kb_relative_path(target_directory)?;
    let source_abs = resolve_kb_path(root, &source_rel)?;
    let target_abs = resolve_kb_path(root, &target_dir)?;

    if !source_abs.exists() {
        return Err(AppError::NotFound(format!("Source note not found: {}", source_rel)));
    }
    if !target_abs.is_dir()
        || !target_dir.starts_with("notes/")
        || target_dir == "notes/__unarchived__"
        || target_dir.starts_with("notes/__unarchived__/")
        || path_uses_symlink_segment(root, &target_dir)?
    {
        return Err(AppError::InvalidInput(format!("Invalid target directory: {}", target_dir)));
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

fn build_tree_with_visuals(
    notes: &[Note],
    directory_paths: &[String],
    visuals: &NotebookVisualMap,
) -> Vec<NoteTreeNode> {
    let mut root_nodes = build_tree_with_directories(notes, directory_paths);
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

    let src = Path::new(src_path);
    let filename = src
        .file_name()
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid path: {}", src_path)))?
        .to_string_lossy()
        .to_string();

    if !filename.to_lowercase().ends_with(".md") {
        return Err(AppError::InvalidInput("Only .md files can be imported".into()));
    }

    let content = std::fs::read_to_string(src_path)?;
    let dir = normalize_kb_relative_path(if dest_directory.is_empty() { "notes" } else { dest_directory })?;

    // Ensure destination directory exists
    let abs_dir = resolve_kb_path(&root, &dir)?;
    std::fs::create_dir_all(&abs_dir)?;

    // Handle filename conflicts
    let base_rel = format!("{}/{}", dir, filename);
    let final_rel = if resolve_kb_path(&root, &base_rel)?.exists() {
        let stem = src.file_stem().unwrap_or_default().to_string_lossy();
        let mut i = 1;
        loop {
            let candidate = format!("{}/{}-{}.md", dir, stem, i);
            if !resolve_kb_path(&root, &candidate)?.exists() {
                break candidate;
            }
            i += 1;
        }
    } else {
        base_rel
    };

    let abs_dest = resolve_kb_path(&root, &final_rel)?;
    atomic_write(&abs_dest, &content)?;

    let note = index_note_full(conn, &root, &final_rel, &content)?;
    Ok(note)
}

#[cfg(test)]
mod tests {
    use super::{
        build_tree, build_tree_with_directories, build_tree_with_visuals, create_notebook_in_root,
        delete_notebook_in_root, move_note_in_root, rename_notebook_in_root,
        reorder_notebooks_in_root, update_notebook_visual_in_root,
    };
    use crate::domain::note::Note;
    use crate::error::AppError;
    use crate::infrastructure::db::open_and_migrate;
    use rusqlite::params;
    use crate::services::index::index_note_full;
    use crate::services::notebook_visual::{load_notebook_visuals, save_notebook_visual};
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

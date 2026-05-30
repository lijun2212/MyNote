use crate::domain::note::{CreateNoteInput, Note, NoteDetail, NoteTreeNode, SaveNoteInput, SaveNoteResult};
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{atomic_write, normalize_kb_relative_path, resolve_kb_path, safe_filename};
use crate::infrastructure::markdown::{render_note, FrontMatter};
use crate::services::index::index_note_full;
use crate::state::AppState;
use rusqlite::params;
use std::path::Path;
use tauri::State;
use ulid::Ulid;

pub fn create_note_service(state: &State<AppState>, input: CreateNoteInput) -> AppResult<Note> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db.lock().unwrap();
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
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let db_guard = state.db.lock().unwrap();
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
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db.lock().unwrap();
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
    ).map_err(|e| AppError::Database(e.to_string()))
}

pub fn list_notes_service(state: &State<AppState>) -> AppResult<Vec<Note>> {
    let db_guard = state.db.lock().unwrap();
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

pub fn build_tree(notes: &[Note]) -> Vec<NoteTreeNode> {
    use std::collections::HashMap;

    let mut root_nodes: Vec<NoteTreeNode> = Vec::new();
    let mut dirs: HashMap<String, Vec<NoteTreeNode>> = HashMap::new();

    for note in notes {
        let parts: Vec<&str> = note.path.splitn(2, '/').collect();
        if parts.len() == 1 {
            root_nodes.push(NoteTreeNode {
                id: Some(note.id.clone()),
                name: parts[0].to_string(),
                path: note.path.clone(),
                is_dir: false,
                children: vec![],
            });
        } else {
            let dir = parts[0].to_string();
            let file_part = parts[1].to_string();
            dirs.entry(dir.clone()).or_default().push(NoteTreeNode {
                id: Some(note.id.clone()),
                name: file_part,
                path: note.path.clone(),
                is_dir: false,
                children: vec![],
            });
        }
    }

    for (dir, children) in dirs {
        root_nodes.push(NoteTreeNode {
            id: None,
            name: dir.clone(),
            path: dir,
            is_dir: true,
            children,
        });
    }

    root_nodes.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    root_nodes
}

pub fn get_note_tree_service(state: &State<AppState>) -> AppResult<Vec<NoteTreeNode>> {
    let notes = list_notes_service(state)?;
    Ok(build_tree(&notes))
}

pub fn index_note_from_file(state: &State<AppState>, rel_path: &str) -> AppResult<Note> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db.lock().unwrap();
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
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let mut db_guard = state.db.lock().unwrap();
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

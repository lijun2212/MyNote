use crate::domain::note::{CreateNoteInput, Note, NoteDetail, NoteTreeNode, SaveNoteInput, SaveNoteResult};
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{abs_path, atomic_write, safe_filename};
use crate::infrastructure::hash::sha256_str;
use crate::infrastructure::markdown::{parse_note, render_note, FrontMatter};
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
    let dir = if input.directory.is_empty() { "notes".to_string() } else { input.directory.clone() };
    let rel_path = format!("{}/{}.md", dir, safe_title);
    let abs = abs_path(root, &rel_path);

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
    let hash = sha256_str(&content);

    atomic_write(&abs, &content)?;

    let word_count = parse_note(&content, &safe_title)?.word_count as i64;

    conn.execute(
        "INSERT INTO notes (id, path, title, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at) VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6, ?7, ?8)",
        params![id, rel_path, input.title, hash, word_count, now, now, now],
    )?;

    Ok(Note {
        id,
        path: rel_path,
        title: input.title,
        summary: None,
        content_hash: hash,
        word_count,
        created_at: now.clone(),
        updated_at: now.clone(),
        indexed_at: now,
        deleted_at: None,
    })
}

pub fn get_note_by_path_service(state: &State<AppState>, rel_path: &str) -> AppResult<NoteDetail> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let abs = abs_path(root, rel_path);
    let content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", rel_path)))?;

    let note = conn.query_row(
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
            let abs_conflict = abs_path(root, &conflict_path);
            atomic_write(&abs_conflict, &input.content)?;
            let note = get_note_by_path_service_inner(conn, root, &path)?;
            return Ok(SaveNoteResult { note, conflict: true });
        }
    }

    let abs = abs_path(root, &path);
    atomic_write(&abs, &input.content)?;

    let new_hash = sha256_str(&input.content);
    let now = chrono::Utc::now().to_rfc3339();
    let stem = Path::new(&path).file_stem().unwrap_or_default().to_string_lossy().to_string();
    let parsed = parse_note(&input.content, &stem)?;

    conn.execute(
        "UPDATE notes SET title = ?1, content_hash = ?2, word_count = ?3, updated_at = ?4, indexed_at = ?5 WHERE id = ?6",
        params![parsed.title, new_hash, parsed.word_count as i64, now, now, input.note_id],
    )?;

    let note = get_note_by_path_service_inner(conn, root, &path)?;
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
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let mut db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_mut().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let abs = abs_path(root, rel_path);
    let content = std::fs::read_to_string(&abs)?;
    let stem = Path::new(rel_path).file_stem().unwrap_or_default().to_string_lossy().to_string();
    let parsed = parse_note(&content, &stem)?;
    let hash = sha256_str(&content);
    let now = chrono::Utc::now().to_rfc3339();

    let id = parsed.front_matter.id.clone().unwrap_or_else(|| Ulid::new().to_string());
    let title = parsed.title;
    let word_count = parsed.word_count as i64;

    conn.execute(
        "INSERT INTO notes (id, path, title, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6, ?7, ?8)
         ON CONFLICT(path) DO UPDATE SET title=excluded.title, content_hash=excluded.content_hash, word_count=excluded.word_count, updated_at=excluded.updated_at, indexed_at=excluded.indexed_at",
        params![id, rel_path, title, hash, word_count, now, now, now],
    )?;

    Ok(Note {
        id,
        path: rel_path.to_string(),
        title: parsed.front_matter.title.unwrap_or_else(|| stem.clone()),
        summary: parsed.front_matter.summary,
        content_hash: hash,
        word_count,
        created_at: now.clone(),
        updated_at: now.clone(),
        indexed_at: now,
        deleted_at: None,
    })
}

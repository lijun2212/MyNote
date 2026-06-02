use crate::domain::note::{CreateNoteInput, CreateNotebookInput, Note, NoteDetail, NoteTreeNode, SaveNoteInput, SaveNoteResult};
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{atomic_write, normalize_kb_relative_path, resolve_kb_path, safe_filename};
use crate::infrastructure::markdown::{render_note, FrontMatter};
use crate::services::index::index_note_full;
use crate::state::AppState;
use rusqlite::params;
use rusqlite::OptionalExtension;
use std::path::Path;
use tauri::State;
use ulid::Ulid;

pub fn create_notebook_in_root(root: &Path, name: &str) -> AppResult<String> {
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
    Ok(rel_path)
}

pub fn create_notebook_service(state: &State<AppState>, input: CreateNotebookInput) -> AppResult<String> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;

    create_notebook_in_root(root, &input.name)
}

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
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Note not found in DB: {}", rel_path)),
        other => AppError::Database(other.to_string()),
    })
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

fn ensure_dir_node(children: &mut Vec<NoteTreeNode>, path: &str, name: &str) -> usize {
    if let Some(index) = children.iter().position(|child| child.is_dir && child.path == path) {
        return index;
    }

    children.push(NoteTreeNode {
        id: None,
        name: name.to_string(),
        path: path.to_string(),
        is_dir: true,
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

pub fn get_note_tree_service(state: &State<AppState>) -> AppResult<Vec<NoteTreeNode>> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let notes = list_notes_service(state)?;
    let directory_paths = collect_note_directories(&root)?;
    Ok(build_tree_with_directories(&notes, &directory_paths))
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

#[cfg(test)]
mod tests {
    use super::{build_tree, build_tree_with_directories, create_notebook_in_root, move_note_in_root};
    use crate::domain::note::Note;
    use crate::error::AppError;
    use crate::infrastructure::db::open_and_migrate;
    use rusqlite::params;
    use crate::services::index::index_note_full;
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

        let created = create_notebook_in_root(root.path(), "法律").unwrap();
        assert_eq!(created, "notes/法律");
        assert!(root.path().join("notes/法律").is_dir());

        let dotted = create_notebook_in_root(root.path(), "v1..2").unwrap();
        assert_eq!(dotted, "notes/v1..2");
        assert!(root.path().join("notes/v1..2").is_dir());

        assert!(create_notebook_in_root(root.path(), "").is_err());
        assert!(create_notebook_in_root(root.path(), ".").is_err());
        assert!(create_notebook_in_root(root.path(), "..").is_err());
        assert!(create_notebook_in_root(root.path(), "法律").is_err());
        assert!(create_notebook_in_root(root.path(), "notes/二级").is_err());
        assert!(create_notebook_in_root(root.path(), "../outside").is_err());
        assert!(create_notebook_in_root(root.path(), "案例\\子类").is_err());
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
    fn build_tree_includes_empty_notebook_directories() {
        let tree = build_tree_with_directories(&[], &["notes/法律".to_string(), "notes/产品".to_string()]);

        let notes_root = tree.iter().find(|node| node.path == "notes").unwrap();
        assert!(notes_root.is_dir);
        assert!(notes_root.children.iter().any(|node| node.path == "notes/法律" && node.is_dir));
        assert!(notes_root.children.iter().any(|node| node.path == "notes/产品" && node.is_dir));
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
}

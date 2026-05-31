use crate::domain::relation::{NoteRelations, Relation, RelationItem, RelationType};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use ulid::Ulid;

fn ensure_note_exists(conn: &Connection, note_id: &str, role: &str) -> AppResult<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE id = ?1 AND deleted_at IS NULL",
        [note_id],
        |row| row.get(0),
    )?;

    if exists == 0 {
        return Err(AppError::NotFound(format!("{role} note not found: {note_id}")));
    }

    Ok(())
}

fn parse_relation_type(value: &str) -> AppResult<RelationType> {
    RelationType::parse(value)
        .ok_or_else(|| AppError::InvalidInput(format!("invalid relation type: {value}")))
}

fn map_relation_item(row: &rusqlite::Row<'_>) -> Result<RelationItem, rusqlite::Error> {
    let relation_type_raw: String = row.get(1)?;
    let relation_type = RelationType::parse(&relation_type_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid relation type in database: {relation_type_raw}"),
            )),
        )
    })?;

    Ok(RelationItem {
        id: row.get(0)?,
        relation_type,
        description: row.get(2)?,
        note_id: row.get(3)?,
        note_title: row.get(4)?,
        note_path: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn create_relation_in_conn(
    conn: &Connection,
    source_note_id: &str,
    target_note_id: &str,
    relation_type: &str,
    description: Option<String>,
) -> AppResult<Relation> {
    ensure_note_exists(conn, source_note_id, "source")?;
    ensure_note_exists(conn, target_note_id, "target")?;

    if source_note_id == target_note_id {
        return Err(AppError::InvalidInput("self relation is not allowed".into()));
    }

    let relation_type = parse_relation_type(relation_type)?;
    let duplicate_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM relations WHERE source_note_id = ?1 AND target_note_id = ?2 AND relation_type = ?3",
        params![source_note_id, target_note_id, relation_type.as_str()],
        |row| row.get(0),
    )?;

    if duplicate_count > 0 {
        return Err(AppError::AlreadyExists("relation already exists".into()));
    }

    let id = Ulid::new().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO relations (id, source_note_id, target_note_id, relation_type, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            &id,
            source_note_id,
            target_note_id,
            relation_type.as_str(),
            description.as_deref(),
            &now,
            &now
        ],
    )?;

    Ok(Relation {
        id,
        source_note_id: source_note_id.to_string(),
        target_note_id: target_note_id.to_string(),
        relation_type,
        description,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn delete_relation_in_conn(conn: &Connection, relation_id: &str) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM relations WHERE id = ?1", [relation_id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("relation not found: {relation_id}")));
    }

    Ok(())
}

pub fn list_relations_in_conn(conn: &Connection, note_id: &str) -> AppResult<NoteRelations> {
    ensure_note_exists(conn, note_id, "source")?;

    let mut outgoing_stmt = conn.prepare(
        "SELECT r.id, r.relation_type, r.description, n.id, n.title, n.path, r.created_at, r.updated_at
         FROM relations r
         JOIN notes n ON n.id = r.target_note_id AND n.deleted_at IS NULL
         WHERE r.source_note_id = ?1
         ORDER BY n.title, r.created_at",
    )?;
    let outgoing = outgoing_stmt
        .query_map([note_id], map_relation_item)?
        .collect::<Result<Vec<_>, _>>()?;

    let mut incoming_stmt = conn.prepare(
        "SELECT r.id, r.relation_type, r.description, n.id, n.title, n.path, r.created_at, r.updated_at
         FROM relations r
         JOIN notes n ON n.id = r.source_note_id AND n.deleted_at IS NULL
         WHERE r.target_note_id = ?1
         ORDER BY n.title, r.created_at",
    )?;
    let incoming = incoming_stmt
        .query_map([note_id], map_relation_item)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(NoteRelations { outgoing, incoming })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::open_and_migrate;
    use rusqlite::params;
    use tempfile::TempDir;

    fn setup_db() -> (TempDir, rusqlite::Connection) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES (?1, ?2, ?3, NULL, 'hash', 0, '{}', datetime('now'), datetime('now'), datetime('now'), NULL)",
            params!["n1", "notes/a.md", "A"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES (?1, ?2, ?3, NULL, 'hash', 0, '{}', datetime('now'), datetime('now'), datetime('now'), NULL)",
            params!["n2", "notes/b.md", "B"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES (?1, ?2, ?3, NULL, 'hash', 0, '{}', datetime('now'), datetime('now'), datetime('now'), NULL)",
            params!["n3", "notes/c.md", "C"],
        )
        .unwrap();
        (temp_dir, conn)
    }

    #[test]
    fn create_relation_rejects_self_relation() {
        let (_temp_dir, conn) = setup_db();
        let error = create_relation_in_conn(&conn, "n1", "n1", "related", None).unwrap_err();
        assert!(error.to_string().contains("self relation"));
    }

    #[test]
    fn create_relation_rejects_duplicates() {
        let (_temp_dir, conn) = setup_db();
        create_relation_in_conn(&conn, "n1", "n2", "related", None).unwrap();
        let error = create_relation_in_conn(&conn, "n1", "n2", "related", Some("again".into())).unwrap_err();
        assert!(error.to_string().contains("already exists"));
    }

    #[test]
    fn create_relation_reports_missing_source_and_target_separately() {
        let (_temp_dir, conn) = setup_db();

        let source_error = create_relation_in_conn(&conn, "missing", "n2", "related", None).unwrap_err();
        match source_error {
            AppError::NotFound(message) => assert_eq!(message, "source note not found: missing"),
            other => panic!("unexpected error: {other}"),
        }

        let target_error = create_relation_in_conn(&conn, "n1", "missing", "related", None).unwrap_err();
        match target_error {
            AppError::NotFound(message) => assert_eq!(message, "target note not found: missing"),
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn list_relations_groups_outgoing_and_incoming() {
        let (_temp_dir, conn) = setup_db();
        create_relation_in_conn(&conn, "n1", "n2", "related", None).unwrap();
        create_relation_in_conn(&conn, "n3", "n1", "supports", Some("evidence".into())).unwrap();

        let relations = list_relations_in_conn(&conn, "n1").unwrap();
        assert_eq!(relations.outgoing.len(), 1);
        assert_eq!(relations.incoming.len(), 1);
        assert_eq!(relations.outgoing[0].note_id, "n2");
        assert_eq!(relations.incoming[0].note_id, "n3");
    }

    #[test]
    fn list_relations_excludes_soft_deleted_notes() {
        let (_temp_dir, conn) = setup_db();
        create_relation_in_conn(&conn, "n1", "n2", "related", None).unwrap();
        create_relation_in_conn(&conn, "n3", "n1", "supports", None).unwrap();

        conn.execute(
            "UPDATE notes SET deleted_at = datetime('now') WHERE id = ?1",
            ["n2"],
        )
        .unwrap();
        conn.execute(
            "UPDATE notes SET deleted_at = datetime('now') WHERE id = ?1",
            ["n3"],
        )
        .unwrap();

        let relations = list_relations_in_conn(&conn, "n1").unwrap();
        assert!(relations.outgoing.is_empty());
        assert!(relations.incoming.is_empty());
    }

    #[test]
    fn delete_relation_removes_row() {
        let (_temp_dir, conn) = setup_db();
        let relation = create_relation_in_conn(&conn, "n1", "n2", "related", None).unwrap();
        delete_relation_in_conn(&conn, &relation.id).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM relations WHERE id = ?1", [&relation.id], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
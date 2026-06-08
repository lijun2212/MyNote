use crate::domain::relation::{NoteRelations, Relation, RelationItem, RelationOrigin, RelationType};
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

    let relation_origin_raw: String = row.get(2)?;
    let relation_origin = RelationOrigin::parse(&relation_origin_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid relation origin in database: {relation_origin_raw}"),
            )),
        )
    })?;

    Ok(RelationItem {
        id: row.get(0)?,
        relation_type,
        relation_origin,
        description: row.get(3)?,
        accepted_candidate_id: row.get(4)?,
        note_id: row.get(5)?,
        note_title: row.get(6)?,
        note_path: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn ensure_relation_absent(
    conn: &Connection,
    source_note_id: &str,
    target_note_id: &str,
    relation_type: RelationType,
) -> AppResult<()> {
    let duplicate_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM relations WHERE source_note_id = ?1 AND target_note_id = ?2 AND relation_type = ?3",
        params![source_note_id, target_note_id, relation_type.as_str()],
        |row| row.get(0),
    )?;

    if duplicate_count > 0 {
        return Err(AppError::AlreadyExists("relation already exists".into()));
    }

    Ok(())
}

fn insert_relation_record_in_conn(
    conn: &Connection,
    source_note_id: &str,
    target_note_id: &str,
    relation_type: RelationType,
    relation_origin: RelationOrigin,
    description: Option<String>,
    accepted_candidate_id: Option<String>,
) -> AppResult<Relation> {
    let id = Ulid::new().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO relations (id, source_note_id, target_note_id, relation_type, relation_origin, description, accepted_candidate_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            &id,
            source_note_id,
            target_note_id,
            relation_type.as_str(),
            relation_origin.as_str(),
            description.as_deref(),
            accepted_candidate_id.as_deref(),
            &now,
            &now
        ],
    )?;

    Ok(Relation {
        id,
        source_note_id: source_note_id.to_string(),
        target_note_id: target_note_id.to_string(),
        relation_type,
        relation_origin,
        description,
        accepted_candidate_id,
        created_at: now.clone(),
        updated_at: now,
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
    ensure_relation_absent(conn, source_note_id, target_note_id, relation_type)?;

    insert_relation_record_in_conn(
        conn,
        source_note_id,
        target_note_id,
        relation_type,
        RelationOrigin::Manual,
        description,
        None,
    )
}

pub fn create_relation_with_origin_in_conn(
    conn: &Connection,
    source_note_id: &str,
    target_note_id: &str,
    relation_type: RelationType,
    relation_origin: RelationOrigin,
    description: Option<String>,
    accepted_candidate_id: Option<String>,
) -> AppResult<Relation> {
    ensure_note_exists(conn, source_note_id, "source")?;
    ensure_note_exists(conn, target_note_id, "target")?;

    if source_note_id == target_note_id {
        return Err(AppError::InvalidInput("self relation is not allowed".into()));
    }

    ensure_relation_absent(conn, source_note_id, target_note_id, relation_type)?;

    insert_relation_record_in_conn(
        conn,
        source_note_id,
        target_note_id,
        relation_type,
        relation_origin,
        description,
        accepted_candidate_id,
    )
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
        "SELECT r.id, r.relation_type, r.relation_origin, r.description, r.accepted_candidate_id, n.id, n.title, n.path, r.created_at, r.updated_at
         FROM relations r
         JOIN notes n ON n.id = r.target_note_id AND n.deleted_at IS NULL
         WHERE r.source_note_id = ?1
         ORDER BY n.title, r.created_at",
    )?;
    let outgoing = outgoing_stmt
        .query_map([note_id], map_relation_item)?
        .collect::<Result<Vec<_>, _>>()?;

    let mut incoming_stmt = conn.prepare(
        "SELECT r.id, r.relation_type, r.relation_origin, r.description, r.accepted_candidate_id, n.id, n.title, n.path, r.created_at, r.updated_at
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
        assert_eq!(relations.outgoing[0].relation_origin, RelationOrigin::Manual);
    }

    #[test]
    fn create_relation_with_origin_persists_candidate_tracking() {
        let (_temp_dir, conn) = setup_db();
        conn.execute(
            "INSERT INTO graph_candidate_relations (id, source_note_id, source_heading_id, target_note_id, target_heading_id, relation_type, rationale, evidence_excerpt, candidate_status, provider_name, created_at, updated_at, accepted_relation_id)
             VALUES ('candidate-1', 'n1', NULL, 'n2', NULL, 'supports', 'candidate rationale', NULL, 'pending', 'provider', datetime('now'), datetime('now'), NULL)",
            [],
        )
        .unwrap();

        let relation = create_relation_with_origin_in_conn(
            &conn,
            "n1",
            "n2",
            RelationType::Supports,
            RelationOrigin::CandidateEdited,
            Some("edited rationale".into()),
            Some("candidate-1".into()),
        )
        .unwrap();

        assert_eq!(relation.relation_origin, RelationOrigin::CandidateEdited);
        assert_eq!(relation.accepted_candidate_id.as_deref(), Some("candidate-1"));
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
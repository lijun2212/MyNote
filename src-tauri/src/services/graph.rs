use crate::domain::graph::{
    GraphCandidateRelation, GraphConflictItem, GraphFactualRelationItem, GraphLogicPath,
    GraphLogicPathStep, GraphNodeRef, GraphOverview, GraphRelationDirection, GraphRelationItem,
    NoteGraphAnalysis,
};
use crate::domain::ai::{AiProfile, AiTextRequest};
use crate::domain::relation::{GraphCandidateStatus, Relation, RelationOrigin, RelationType};
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::resolve_kb_path;
use crate::services::ai::{
    load_ai_profile_with_secret, resolve_ai_profile_selection, AiOrchestrator, SystemSecretStore,
};
use crate::services::relation::{create_relation_with_origin_in_conn, list_relations_in_conn};
use crate::state::AppState;
use rusqlite::{params, Connection};
use serde::Deserialize;
use std::collections::BTreeSet;
use ulid::Ulid;

const GRAPH_CANDIDATE_CONTEXT_CHARS: usize = 2400;
const GRAPH_CANDIDATE_NOTE_POOL_LIMIT: usize = 40;
const GRAPH_CANDIDATE_RELATION_TYPES: [RelationType; 10] = [
    RelationType::Related,
    RelationType::Prerequisite,
    RelationType::Extension,
    RelationType::Opposes,
    RelationType::Supports,
    RelationType::Similar,
    RelationType::Premise,
    RelationType::Conclusion,
    RelationType::Example,
    RelationType::Rebuts,
];

#[derive(Debug, Clone)]
struct ParsedGraphCandidate {
    source_note_id: String,
    source_heading_id: Option<String>,
    target_note_id: String,
    target_heading_id: Option<String>,
    relation_type: RelationType,
    rationale: String,
    evidence_excerpt: Option<String>,
    provider_name: Option<String>,
}

#[derive(Debug)]
struct GraphCandidatePromptContext {
    focus_note: GraphNodeRef,
    content: String,
    overview: GraphOverview,
    candidate_notes: Vec<GraphCandidatePromptNote>,
}

#[derive(Debug, Clone)]
struct GraphCandidatePromptNote {
    note_id: String,
    note_title: String,
    note_path: String,
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphCandidateGenerationPayload {
    candidates: Vec<GraphCandidateGenerationCandidate>,
}

#[derive(Debug, Deserialize)]
struct GraphCandidateGenerationCandidate {
    source_note_id: String,
    #[serde(default)]
    source_heading_id: Option<String>,
    target_note_id: String,
    #[serde(default)]
    target_heading_id: Option<String>,
    relation_type: String,
    rationale: String,
    #[serde(default)]
    evidence_excerpt: Option<String>,
    #[serde(default)]
    provider_name: Option<String>,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn map_graph_candidate_relation(row: &rusqlite::Row<'_>) -> Result<GraphCandidateRelation, rusqlite::Error> {
    let relation_type_raw: String = row.get(5)?;
    let relation_type = RelationType::parse(&relation_type_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            5,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid graph candidate relation type: {relation_type_raw}"),
            )),
        )
    })?;

    let candidate_status_raw: String = row.get(8)?;
    let candidate_status = GraphCandidateStatus::parse(&candidate_status_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            8,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid graph candidate status: {candidate_status_raw}"),
            )),
        )
    })?;

    Ok(GraphCandidateRelation {
        id: row.get(0)?,
        source_note_id: row.get(1)?,
        source_heading_id: row.get(2)?,
        target_note_id: row.get(3)?,
        target_heading_id: row.get(4)?,
        relation_type,
        rationale: row.get(6)?,
        evidence_excerpt: row.get(7)?,
        candidate_status,
        provider_name: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        accepted_relation_id: row.get(12)?,
    })
}

fn load_graph_candidate_relation_in_conn(
    conn: &Connection,
    candidate_id: &str,
) -> AppResult<GraphCandidateRelation> {
    conn.query_row(
        "SELECT id, source_note_id, source_heading_id, target_note_id, target_heading_id, relation_type,
                rationale, evidence_excerpt, candidate_status, provider_name, created_at, updated_at,
                accepted_relation_id
         FROM graph_candidate_relations
         WHERE id = ?1",
        [candidate_id],
        map_graph_candidate_relation,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("graph candidate not found: {candidate_id}"))
        }
        other => other.into(),
    })
}

fn ensure_candidate_pending(candidate: &GraphCandidateRelation) -> AppResult<()> {
    if candidate.candidate_status != GraphCandidateStatus::Pending {
        return Err(AppError::Conflict(format!(
            "graph candidate is already {}: {}",
            candidate.candidate_status.as_str(),
            candidate.id
        )));
    }

    Ok(())
}

fn ensure_graph_candidate_note_exists(conn: &Connection, note_id: &str, role: &str) -> AppResult<()> {
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

fn find_existing_relation_in_conn(
    conn: &Connection,
    source_note_id: &str,
    target_note_id: &str,
    relation_type: RelationType,
) -> AppResult<Option<Relation>> {
    conn.query_row(
        "SELECT id, source_note_id, target_note_id, relation_type, relation_origin, description, accepted_candidate_id, created_at, updated_at
         FROM relations
         WHERE source_note_id = ?1 AND target_note_id = ?2 AND relation_type = ?3",
        params![source_note_id, target_note_id, relation_type.as_str()],
        |row| {
            let relation_type_raw: String = row.get(3)?;
            let relation_type = RelationType::parse(&relation_type_raw).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    3,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("invalid relation type in database: {relation_type_raw}"),
                    )),
                )
            })?;

            let relation_origin_raw: String = row.get(4)?;
            let relation_origin = RelationOrigin::parse(&relation_origin_raw).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("invalid relation origin in database: {relation_origin_raw}"),
                    )),
                )
            })?;

            Ok(Relation {
                id: row.get(0)?,
                source_note_id: row.get(1)?,
                target_note_id: row.get(2)?,
                relation_type,
                relation_origin,
                description: row.get(5)?,
                accepted_candidate_id: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

pub fn insert_graph_candidate_relation_in_conn(
    conn: &Connection,
    source_note_id: &str,
    source_heading_id: Option<&str>,
    target_note_id: &str,
    target_heading_id: Option<&str>,
    relation_type: RelationType,
    rationale: &str,
    evidence_excerpt: Option<&str>,
    provider_name: Option<&str>,
) -> AppResult<GraphCandidateRelation> {
    ensure_graph_candidate_note_exists(conn, source_note_id, "source")?;
    ensure_graph_candidate_note_exists(conn, target_note_id, "target")?;

    if source_note_id == target_note_id {
        return Err(AppError::InvalidInput("self candidate is not allowed".into()));
    }

    let id = Ulid::new().to_string();
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO graph_candidate_relations (
            id,
            source_note_id,
            source_heading_id,
            target_note_id,
            target_heading_id,
            relation_type,
            rationale,
            evidence_excerpt,
            candidate_status,
            provider_name,
            created_at,
            updated_at,
            accepted_relation_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL)",
        params![
            &id,
            source_note_id,
            source_heading_id,
            target_note_id,
            target_heading_id,
            relation_type.as_str(),
            rationale,
            evidence_excerpt,
            GraphCandidateStatus::Pending.as_str(),
            provider_name,
            &now,
            &now
        ],
    )?;

    load_graph_candidate_relation_in_conn(conn, &id)
}

pub fn get_graph_candidate_relation_in_conn(
    conn: &Connection,
    candidate_id: &str,
) -> AppResult<GraphCandidateRelation> {
    load_graph_candidate_relation_in_conn(conn, candidate_id)
}

pub fn list_graph_candidates_in_conn(
    conn: &Connection,
    note_id: &str,
) -> AppResult<Vec<GraphCandidateRelation>> {
    load_graph_node_ref(conn, note_id)?;

    let mut stmt = conn.prepare(
        "SELECT id, source_note_id, source_heading_id, target_note_id, target_heading_id, relation_type,
                rationale, evidence_excerpt, candidate_status, provider_name, created_at, updated_at,
                accepted_relation_id
         FROM graph_candidate_relations
         WHERE candidate_status = ?1
           AND (source_note_id = ?2 OR target_note_id = ?2)
         ORDER BY created_at DESC, id DESC",
    )?;

    let candidates = stmt
        .query_map([GraphCandidateStatus::Pending.as_str(), note_id], map_graph_candidate_relation)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    Ok(candidates)
}

pub fn accept_graph_candidate_in_conn(
    conn: &Connection,
    candidate_id: &str,
    relation_type: Option<String>,
    description: Option<String>,
) -> AppResult<Relation> {
    let candidate = load_graph_candidate_relation_in_conn(conn, candidate_id)?;
    ensure_candidate_pending(&candidate)?;

    let relation_type = match relation_type {
        Some(value) => RelationType::parse(&value)
            .ok_or_else(|| AppError::InvalidInput(format!("invalid relation type: {value}")))?,
        None => candidate.relation_type,
    };
    let relation_description = description.or_else(|| Some(candidate.rationale.clone()));
    let relation_origin = if relation_type == candidate.relation_type
        && relation_description.as_deref() == Some(candidate.rationale.as_str())
    {
        RelationOrigin::CandidateAccepted
    } else {
        RelationOrigin::CandidateEdited
    };

    let formal_relation = match create_relation_with_origin_in_conn(
        conn,
        &candidate.source_note_id,
        &candidate.target_note_id,
        relation_type,
        relation_origin,
        relation_description,
        Some(candidate.id.clone()),
    ) {
        Ok(relation) => relation,
        Err(AppError::AlreadyExists(_)) => find_existing_relation_in_conn(
            conn,
            &candidate.source_note_id,
            &candidate.target_note_id,
            relation_type,
        )?
        .ok_or_else(|| {
            AppError::Conflict(format!(
                "graph candidate matched an existing relation, but it could not be loaded: {candidate_id}"
            ))
        })?,
        Err(error) => return Err(error),
    };

    let now = now_rfc3339();
    let updated = conn.execute(
        "UPDATE graph_candidate_relations
         SET candidate_status = ?2,
             accepted_relation_id = ?3,
             updated_at = ?4
         WHERE id = ?1 AND candidate_status = ?5",
        params![
            candidate_id,
            GraphCandidateStatus::Accepted.as_str(),
            &formal_relation.id,
            &now,
            GraphCandidateStatus::Pending.as_str()
        ],
    )?;

    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "graph candidate is no longer pending: {candidate_id}"
        )));
    }

    Ok(formal_relation)
}

pub fn ignore_graph_candidate_in_conn(conn: &Connection, candidate_id: &str) -> AppResult<()> {
    let candidate = load_graph_candidate_relation_in_conn(conn, candidate_id)?;
    ensure_candidate_pending(&candidate)?;

    let now = now_rfc3339();
    let updated = conn.execute(
        "UPDATE graph_candidate_relations
         SET candidate_status = ?2,
             updated_at = ?3
         WHERE id = ?1 AND candidate_status = ?4",
        params![
            candidate_id,
            GraphCandidateStatus::Ignored.as_str(),
            &now,
            GraphCandidateStatus::Pending.as_str()
        ],
    )?;

    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "graph candidate is no longer pending: {candidate_id}"
        )));
    }

    Ok(())
}

fn load_graph_node_ref(conn: &Connection, note_id: &str) -> AppResult<GraphNodeRef> {
    conn.query_row(
        "SELECT id, title, path FROM notes WHERE id = ?1 AND deleted_at IS NULL",
        [note_id],
        |row| {
            Ok(GraphNodeRef {
                note_id: row.get(0)?,
                note_title: row.get(1)?,
                note_path: row.get(2)?,
                heading_id: None,
                heading_text: None,
                line_start: None,
                line_end: None,
            })
        },
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("note not found: {note_id}"))
        }
        other => other.into(),
    })
}

fn load_confirmed_graph_relations(conn: &Connection, note_id: &str) -> AppResult<Vec<GraphRelationItem>> {
    let relations = list_relations_in_conn(conn, note_id)?;
    let mut items = relations
        .outgoing
        .into_iter()
        .map(|item| GraphRelationItem {
            relation_id: item.id,
            relation_type: item.relation_type,
            relation_origin: item.relation_origin,
            direction: GraphRelationDirection::Outgoing,
            note: GraphNodeRef {
                note_id: item.note_id,
                note_title: item.note_title,
                note_path: item.note_path,
                heading_id: None,
                heading_text: None,
                line_start: None,
                line_end: None,
            },
            rationale: item.description,
            accepted_candidate_id: item.accepted_candidate_id,
        })
        .collect::<Vec<_>>();

    items.extend(relations.incoming.into_iter().map(|item| GraphRelationItem {
        relation_id: item.id,
        relation_type: item.relation_type,
        relation_origin: item.relation_origin,
        direction: GraphRelationDirection::Incoming,
        note: GraphNodeRef {
            note_id: item.note_id,
            note_title: item.note_title,
            note_path: item.note_path,
            heading_id: None,
            heading_text: None,
            line_start: None,
            line_end: None,
        },
        rationale: item.description,
        accepted_candidate_id: item.accepted_candidate_id,
    }));

    items.sort_by(|left, right| {
        left.note
            .note_title
            .cmp(&right.note.note_title)
            .then_with(|| left.relation_id.cmp(&right.relation_id))
    });

    Ok(items)
}

fn load_factual_graph_relations(
    conn: &Connection,
    note_id: &str,
) -> AppResult<Vec<GraphFactualRelationItem>> {
    let mut outgoing_stmt = conn.prepare(
        "SELECT l.id, n.id, n.title, n.path, l.display_text, l.link_type, l.anchor
         FROM links l
         JOIN notes n ON n.id = l.target_note_id AND n.deleted_at IS NULL
         WHERE l.source_note_id = ?1
           AND l.resolved = 1
           AND l.target_note_id IS NOT NULL
           AND l.target_note_id != ?1
         ORDER BY n.title, l.id",
    )?;
    let mut items = outgoing_stmt
        .query_map([note_id], |row| {
            Ok(GraphFactualRelationItem {
                link_id: row.get(0)?,
                direction: GraphRelationDirection::Outgoing,
                note: GraphNodeRef {
                    note_id: row.get(1)?,
                    note_title: row.get(2)?,
                    note_path: row.get(3)?,
                    heading_id: None,
                    heading_text: None,
                    line_start: None,
                    line_end: None,
                },
                link_text: row.get(4)?,
                link_type: row.get(5)?,
                target_anchor: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut incoming_stmt = conn.prepare(
        "SELECT l.id, n.id, n.title, n.path, l.display_text, l.link_type, l.anchor
         FROM links l
         JOIN notes n ON n.id = l.source_note_id AND n.deleted_at IS NULL
         WHERE l.target_note_id = ?1
           AND l.resolved = 1
           AND l.source_note_id != ?1
         ORDER BY n.title, l.id",
    )?;
    items.extend(
        incoming_stmt
            .query_map([note_id], |row| {
                Ok(GraphFactualRelationItem {
                    link_id: row.get(0)?,
                    direction: GraphRelationDirection::Incoming,
                    note: GraphNodeRef {
                        note_id: row.get(1)?,
                        note_title: row.get(2)?,
                        note_path: row.get(3)?,
                        heading_id: None,
                        heading_text: None,
                        line_start: None,
                        line_end: None,
                    },
                    link_text: row.get(4)?,
                    link_type: row.get(5)?,
                    target_anchor: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?,
    );

    items.sort_by(|left, right| {
        left.note
            .note_title
            .cmp(&right.note.note_title)
            .then_with(|| left.link_id.cmp(&right.link_id))
    });

    Ok(items)
}

fn is_logic_relation(relation_type: RelationType) -> bool {
    matches!(
        relation_type,
        RelationType::Supports
            | RelationType::Prerequisite
            | RelationType::Premise
            | RelationType::Example
    )
}

fn is_conflict_relation(relation_type: RelationType) -> bool {
    matches!(relation_type, RelationType::Opposes | RelationType::Rebuts)
}

fn load_graph_candidate_prompt_context(
    conn: &Connection,
    kb_root: &std::path::Path,
    note_id: &str,
) -> AppResult<GraphCandidatePromptContext> {
    let focus_note = load_graph_node_ref(conn, note_id)?;
    let absolute_path = resolve_kb_path(kb_root, &focus_note.note_path)?;
    let content = std::fs::read_to_string(&absolute_path)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", focus_note.note_path)))?;
    let overview = GraphOverview {
        confirmed_relations: load_confirmed_graph_relations(conn, note_id)?,
        factual_relations: load_factual_graph_relations(conn, note_id)?,
    };
    let candidate_notes = load_graph_candidate_prompt_notes(conn, note_id)?;

    Ok(GraphCandidatePromptContext {
        focus_note,
        content,
        overview,
        candidate_notes,
    })
}

fn load_graph_candidate_prompt_notes(
    conn: &Connection,
    note_id: &str,
) -> AppResult<Vec<GraphCandidatePromptNote>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, path, summary
         FROM notes
         WHERE deleted_at IS NULL
           AND id != ?1
         ORDER BY updated_at DESC, title ASC
         LIMIT ?2",
    )?;

    let rows = stmt
        .query_map(params![note_id, GRAPH_CANDIDATE_NOTE_POOL_LIMIT as i64], |row| {
            Ok(GraphCandidatePromptNote {
                note_id: row.get(0)?,
                note_title: row.get(1)?,
                note_path: row.get(2)?,
                summary: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

fn trim_graph_candidate_context(content: &str, max_chars: usize) -> String {
    let normalized = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    normalized.chars().take(max_chars).collect()
}

fn format_confirmed_relation_line(item: &GraphRelationItem) -> String {
    format!(
        "- direction={} note_id={} title={} relation_type={} rationale={}",
        match item.direction {
            GraphRelationDirection::Incoming => "incoming",
            GraphRelationDirection::Outgoing => "outgoing",
        },
        item.note.note_id,
        item.note.note_title,
        item.relation_type.as_str(),
        item.rationale.as_deref().unwrap_or(""),
    )
}

fn format_factual_relation_line(item: &GraphFactualRelationItem) -> String {
    format!(
        "- direction={} note_id={} title={} link_type={} link_text={}",
        match item.direction {
            GraphRelationDirection::Incoming => "incoming",
            GraphRelationDirection::Outgoing => "outgoing",
        },
        item.note.note_id,
        item.note.note_title,
        item.link_type,
        item.link_text.as_deref().unwrap_or(""),
    )
}

fn collect_graph_candidate_available_note_ids(
    context: &GraphCandidatePromptContext,
) -> BTreeSet<String> {
    let mut available_note_ids = BTreeSet::from([context.focus_note.note_id.clone()]);
    for item in &context.overview.confirmed_relations {
        available_note_ids.insert(item.note.note_id.clone());
    }
    for item in &context.overview.factual_relations {
        available_note_ids.insert(item.note.note_id.clone());
    }
    for item in &context.candidate_notes {
        available_note_ids.insert(item.note_id.clone());
    }

    available_note_ids
}

fn format_graph_candidate_prompt_note(item: &GraphCandidatePromptNote) -> String {
    format!(
        "- note_id={} title={} path={} summary={}",
        item.note_id,
        item.note_title,
        item.note_path,
        item.summary.as_deref().unwrap_or("")
    )
}

fn build_graph_candidate_prompt(
    profile: &AiProfile,
    context: &GraphCandidatePromptContext,
) -> AppResult<AiTextRequest> {
    let available_note_ids = collect_graph_candidate_available_note_ids(context);

    let confirmed_relations = if context.overview.confirmed_relations.is_empty() {
        "- none".to_string()
    } else {
        context
            .overview
            .confirmed_relations
            .iter()
            .map(format_confirmed_relation_line)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let factual_relations = if context.overview.factual_relations.is_empty() {
        "- none".to_string()
    } else {
        context
            .overview
            .factual_relations
            .iter()
            .map(format_factual_relation_line)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let candidate_notes = if context.candidate_notes.is_empty() {
        "- none".to_string()
    } else {
        context
            .candidate_notes
            .iter()
            .map(format_graph_candidate_prompt_note)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let content_excerpt = trim_graph_candidate_context(&context.content, GRAPH_CANDIDATE_CONTEXT_CHARS);
    let allowed_relation_types = GRAPH_CANDIDATE_RELATION_TYPES
        .iter()
        .map(|relation_type| relation_type.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let available_note_ids = available_note_ids.into_iter().collect::<Vec<_>>().join(", ");

    Ok(AiTextRequest {
        prompt: format!(
            concat!(
                "你是 MyNote 的知识图谱候选关系助手。",
                "请仅基于给定上下文判断当前笔记与上下文笔记之间是否存在明确的候选关系。",
                "输出必须是严格 JSON，对象顶层只允许包含 candidates 数组。",
                "不要输出 Markdown，不要使用代码块，不要补充解释。",
                "如果无法可靠判断，请返回 {{\"candidates\":[]}}。\n\n",
                "模型：{}\n",
                "当前笔记 note_id：{}\n",
                "当前笔记标题：{}\n",
                "可用 note_id：{}\n",
                "允许 relation_type：{}\n\n",
                "约束：\n",
                "1. 每个 candidate 必须使用可用 note_id，且至少一端是当前笔记。\n",
                "2. source_note_id 与 target_note_id 不能相同。\n",
                "3. relation_type 只能使用允许值。\n",
                "4. rationale 必须简洁说明判断依据。\n",
                "5. evidence_excerpt 必须摘录原文或可见事实，不能虚构。\n",
                "6. 仅输出 JSON：{{\"candidates\":[{{\"source_note_id\":\"...\",\"target_note_id\":\"...\",\"relation_type\":\"supports\",\"rationale\":\"...\",\"evidence_excerpt\":\"...\"}}]}}\n\n",
                "当前笔记内容：\n{}\n\n",
                "已确认关系：\n{}\n\n",
                "事实关系：\n{}\n\n",
                "候选笔记池：\n{}"
            ),
            profile.model,
            context.focus_note.note_id,
            context.focus_note.note_title,
            available_note_ids,
            allowed_relation_types,
            content_excerpt,
            confirmed_relations,
            factual_relations,
            candidate_notes,
        ),
        max_tokens: profile.max_tokens,
        temperature: Some(profile.temperature.unwrap_or(0.2)),
        expected_text: None,
    })
}

fn parse_graph_candidate_generation(raw: &str) -> AppResult<Vec<ParsedGraphCandidate>> {
    let payload: GraphCandidateGenerationPayload = serde_json::from_str(raw)
        .map_err(|error| AppError::InvalidInput(format!("invalid graph candidate payload: {error}")))?;

    payload
        .candidates
        .into_iter()
        .map(|candidate| {
            let source_note_id = candidate.source_note_id.trim().to_string();
            let target_note_id = candidate.target_note_id.trim().to_string();
            let rationale = candidate.rationale.trim().to_string();
            let relation_type = RelationType::parse(candidate.relation_type.trim()).ok_or_else(|| {
                AppError::InvalidInput(format!(
                    "invalid graph candidate relation type: {}",
                    candidate.relation_type
                ))
            })?;

            if source_note_id.is_empty() {
                return Err(AppError::InvalidInput(
                    "graph candidate source_note_id cannot be blank".into(),
                ));
            }

            if target_note_id.is_empty() {
                return Err(AppError::InvalidInput(
                    "graph candidate target_note_id cannot be blank".into(),
                ));
            }

            if rationale.is_empty() {
                return Err(AppError::InvalidInput(
                    "graph candidate rationale cannot be blank".into(),
                ));
            }

            Ok(ParsedGraphCandidate {
                source_note_id,
                source_heading_id: candidate.source_heading_id,
                target_note_id,
                target_heading_id: candidate.target_heading_id,
                relation_type,
                rationale,
                evidence_excerpt: candidate
                    .evidence_excerpt
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                provider_name: candidate
                    .provider_name
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
            })
        })
        .collect()
}

fn validate_generated_graph_candidate(
    candidate: &ParsedGraphCandidate,
    current_note_id: &str,
    available_note_ids: &BTreeSet<String>,
) -> AppResult<()> {
    if !available_note_ids.contains(&candidate.source_note_id) {
        return Err(AppError::InvalidInput(format!(
            "graph candidate source_note_id is outside available_note_ids: {}",
            candidate.source_note_id
        )));
    }

    if !available_note_ids.contains(&candidate.target_note_id) {
        return Err(AppError::InvalidInput(format!(
            "graph candidate target_note_id is outside available_note_ids: {}",
            candidate.target_note_id
        )));
    }

    if candidate.source_note_id != current_note_id && candidate.target_note_id != current_note_id {
        return Err(AppError::InvalidInput(format!(
            "graph candidate must involve current note: {current_note_id}"
        )));
    }

    if candidate.source_note_id == candidate.target_note_id {
        return Err(AppError::InvalidInput(
            "graph candidate cannot be a self relation".into(),
        ));
    }

    Ok(())
}

fn pending_graph_candidate_exists_in_conn(
    conn: &Connection,
    source_note_id: &str,
    target_note_id: &str,
    relation_type: RelationType,
) -> AppResult<bool> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM graph_candidate_relations
         WHERE source_note_id = ?1
           AND target_note_id = ?2
           AND relation_type = ?3
           AND candidate_status = ?4",
        params![
            source_note_id,
            target_note_id,
            relation_type.as_str(),
            GraphCandidateStatus::Pending.as_str()
        ],
        |row| row.get(0),
    )?;

    Ok(exists > 0)
}

fn persist_generated_graph_candidates_in_conn(
    conn: &Connection,
    current_note_id: &str,
    available_note_ids: &[String],
    parsed_candidates: Vec<ParsedGraphCandidate>,
    default_provider_name: Option<&str>,
) -> AppResult<Vec<GraphCandidateRelation>> {
    let mut allowed_note_ids = available_note_ids.iter().cloned().collect::<BTreeSet<_>>();
    allowed_note_ids.insert(current_note_id.to_string());

    let tx = conn.unchecked_transaction()?;
    let mut inserted = Vec::new();
    let mut seen_triplets = BTreeSet::new();

    for candidate in parsed_candidates {
        validate_generated_graph_candidate(&candidate, current_note_id, &allowed_note_ids)?;

        let dedupe_key = (
            candidate.source_note_id.clone(),
            candidate.target_note_id.clone(),
            candidate.relation_type.as_str().to_string(),
        );
        if !seen_triplets.insert(dedupe_key) {
            continue;
        }

        if find_existing_relation_in_conn(
            &tx,
            &candidate.source_note_id,
            &candidate.target_note_id,
            candidate.relation_type,
        )?
        .is_some()
        {
            continue;
        }

        if pending_graph_candidate_exists_in_conn(
            &tx,
            &candidate.source_note_id,
            &candidate.target_note_id,
            candidate.relation_type,
        )? {
            continue;
        }

        inserted.push(insert_graph_candidate_relation_in_conn(
            &tx,
            &candidate.source_note_id,
            candidate.source_heading_id.as_deref(),
            &candidate.target_note_id,
            candidate.target_heading_id.as_deref(),
            candidate.relation_type,
            &candidate.rationale,
            candidate.evidence_excerpt.as_deref(),
            candidate
                .provider_name
                .as_deref()
                .or(default_provider_name),
        )?);
    }

    tx.commit()?;
    Ok(inserted)
}

pub async fn generate_graph_candidates(
    state: &AppState,
    note_id: &str,
    profile_id: Option<&str>,
) -> AppResult<Vec<GraphCandidateRelation>> {
    let kb_root = state
        .kb_root_guard()
        .clone()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;

    let (profile, api_key, prompt_context) = {
        let db_guard = state.db_guard();
        let conn = db_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

        let selected_profile_id = resolve_ai_profile_selection(conn, profile_id)?.ok_or_else(|| {
            AppError::InvalidInput(
                "AI candidate generation requires an enabled default profile or explicit profile id"
                    .into(),
            )
        })?;

        let (profile, api_key) =
            load_ai_profile_with_secret(conn, &SystemSecretStore, &kb_root, &selected_profile_id)?;
        if !profile.enabled {
            return Err(AppError::InvalidInput(format!(
                "AI profile {} is disabled",
                profile.id
            )));
        }

        let prompt_context = load_graph_candidate_prompt_context(conn, &kb_root, note_id)?;
        (profile, api_key, prompt_context)
    };

    let available_note_ids = collect_graph_candidate_available_note_ids(&prompt_context)
        .into_iter()
        .collect::<Vec<_>>();
    let request = build_graph_candidate_prompt(&profile, &prompt_context)?;
    let response = AiOrchestrator::default()
        .invoke_text(&profile, &api_key, &request)
        .await?;
    let parsed_candidates = parse_graph_candidate_generation(&response.text)?;
    let default_provider_name = profile.name.clone();

    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    persist_generated_graph_candidates_in_conn(
        conn,
        note_id,
        &available_note_ids,
        parsed_candidates,
        Some(default_provider_name.as_str()),
    )
}

pub fn analyze_note_graph_in_conn(conn: &Connection, note_id: &str) -> AppResult<NoteGraphAnalysis> {
    let focus = load_graph_node_ref(conn, note_id)?;
    let confirmed_relations = load_confirmed_graph_relations(conn, note_id)?;
    let factual_relations = load_factual_graph_relations(conn, note_id)?;

    let logic_paths = confirmed_relations
        .iter()
        .filter(|item| is_logic_relation(item.relation_type))
        .map(|item| {
            let (from_node, to_node) = match item.direction {
                GraphRelationDirection::Incoming => (item.note.clone(), focus.clone()),
                GraphRelationDirection::Outgoing => (focus.clone(), item.note.clone()),
            };

            GraphLogicPath {
                id: format!("path:{note_id}:{}", item.relation_id),
                label: format!("{} -> {}", from_node.note_title, to_node.note_title),
                steps: vec![
                    GraphLogicPathStep {
                        node: from_node,
                        relation_type: Some(item.relation_type),
                        rationale: item.rationale.clone(),
                    },
                    GraphLogicPathStep {
                        node: to_node,
                        relation_type: None,
                        rationale: None,
                    },
                ],
            }
        })
        .collect();

    let conflicts = confirmed_relations
        .iter()
        .filter(|item| is_conflict_relation(item.relation_type))
        .map(|item| GraphConflictItem {
            relation_id: item.relation_id.clone(),
            counterparty: item.note.clone(),
            relation_type: item.relation_type,
            direction: item.direction,
            rationale: item.rationale.clone(),
        })
        .collect();

    Ok(NoteGraphAnalysis {
        note_id: note_id.to_string(),
        overview: GraphOverview {
            confirmed_relations,
            factual_relations,
        },
        logic_paths,
        conflicts,
        missing_premises: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use crate::domain::ai::{AiProfile, AiProviderKind};
    use crate::domain::graph::GraphRelationDirection;
    use crate::domain::relation::{RelationOrigin, RelationType};
    use crate::infrastructure::db::open_and_migrate;
    use crate::services::relation::create_relation_in_conn;
    use rusqlite::{params, Connection};
    use std::fs;
    use tempfile::TempDir;

    fn setup_graph_test_conn() -> Connection {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("graph.sqlite");
        fs::create_dir_all(temp_dir.path()).unwrap();
        open_and_migrate(&db_path).unwrap()
    }

    fn seed_graph_note(conn: &Connection, note_id: &str, title: &str, path: &str) {
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES (?1, ?2, ?3, NULL, 'hash', 0, '{}', datetime('now'), datetime('now'), datetime('now'), NULL)",
            params![note_id, path, title],
        )
        .unwrap();
    }

    fn write_graph_note_file(root: &std::path::Path, relative_path: &str, content: &str) {
        let absolute_path = root.join(relative_path);
        if let Some(parent) = absolute_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(absolute_path, content).unwrap();
    }

    fn make_graph_ai_profile() -> AiProfile {
        AiProfile {
            id: "profile-1".into(),
            name: "Graph Test Profile".into(),
            provider: AiProviderKind::Anthropic,
            model: "test-model".into(),
            base_url: None,
            max_tokens: Some(1024),
            temperature: Some(0.2),
            enabled: true,
        }
    }

    fn seed_resolved_link(
        conn: &Connection,
        link_id: &str,
        source_note_id: &str,
        target_note_id: &str,
        target_raw: &str,
        display_text: &str,
    ) {
        conn.execute(
            "INSERT INTO links (id, source_note_id, target_note_id, target_raw, display_text, link_type, anchor, resolved, start_offset, end_offset, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'wiki', NULL, 1, NULL, NULL, datetime('now'), datetime('now'))",
            params![link_id, source_note_id, target_note_id, target_raw, display_text],
        )
        .unwrap();
    }

    fn seed_graph_candidate_relation(
        conn: &Connection,
        candidate_id: &str,
        source_note_id: &str,
        target_note_id: &str,
        relation_type: &str,
        rationale: &str,
    ) {
        conn.execute(
            "INSERT INTO graph_candidate_relations (
                id,
                source_note_id,
                source_heading_id,
                target_note_id,
                target_heading_id,
                relation_type,
                rationale,
                evidence_excerpt,
                candidate_status,
                provider_name,
                created_at,
                updated_at,
                accepted_relation_id
            ) VALUES (
                ?1,
                ?2,
                NULL,
                ?3,
                NULL,
                ?4,
                ?5,
                NULL,
                'pending',
                'test-provider',
                datetime('now'),
                datetime('now'),
                NULL
            )",
            params![candidate_id, source_note_id, target_note_id, relation_type, rationale],
        )
        .unwrap();
    }

    fn count_pending_candidates(
        conn: &Connection,
        source_note_id: &str,
        target_note_id: &str,
        relation_type: &str,
    ) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM graph_candidate_relations
             WHERE source_note_id = ?1
               AND target_note_id = ?2
               AND relation_type = ?3
               AND candidate_status = 'pending'",
            params![source_note_id, target_note_id, relation_type],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn analyze_note_graph_in_conn_returns_overview_paths_and_conflicts() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");
        create_relation_in_conn(&conn, "n2", "n1", "supports", Some("beta supports alpha".into())).unwrap();
        create_relation_in_conn(&conn, "n3", "n1", "opposes", Some("gamma conflicts with alpha".into())).unwrap();

        let analysis = super::analyze_note_graph_in_conn(&conn, "n1").unwrap();

        assert_eq!(analysis.note_id, "n1");
        assert_eq!(analysis.overview.confirmed_relations.len(), 2);
        assert_eq!(analysis.overview.confirmed_relations[0].direction, GraphRelationDirection::Incoming);
        assert_eq!(analysis.logic_paths.len(), 1);
        assert_eq!(analysis.logic_paths[0].steps.len(), 2);
        assert_eq!(analysis.conflicts.len(), 1);
        assert_eq!(analysis.conflicts[0].counterparty.note_id, "n3");
        assert_eq!(analysis.conflicts[0].direction, GraphRelationDirection::Incoming);
    }

    #[test]
    fn analyze_note_graph_in_conn_keeps_outgoing_logic_direction() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        create_relation_in_conn(&conn, "n1", "n2", "supports", Some("alpha supports beta".into())).unwrap();

        let analysis = super::analyze_note_graph_in_conn(&conn, "n1").unwrap();

        assert_eq!(analysis.logic_paths.len(), 1);
        assert_eq!(analysis.overview.confirmed_relations[0].direction, GraphRelationDirection::Outgoing);
        assert_eq!(analysis.logic_paths[0].label, "Alpha -> Beta");
        assert_eq!(analysis.logic_paths[0].steps[0].node.note_id, "n1");
        assert_eq!(analysis.logic_paths[0].steps[1].node.note_id, "n2");
    }

    #[test]
    fn analyze_note_graph_in_conn_distinguishes_incoming_and_outgoing_logic_paths() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");
        create_relation_in_conn(&conn, "n2", "n1", "supports", Some("beta supports alpha".into())).unwrap();
        create_relation_in_conn(&conn, "n1", "n3", "prerequisite", Some("alpha before gamma".into())).unwrap();

        let analysis = super::analyze_note_graph_in_conn(&conn, "n1").unwrap();

        assert_eq!(analysis.logic_paths.len(), 2);
        let labels = analysis
            .logic_paths
            .iter()
            .map(|path| path.label.as_str())
            .collect::<Vec<_>>();
        assert!(labels.contains(&"Beta -> Alpha"));
        assert!(labels.contains(&"Alpha -> Gamma"));
    }

    #[test]
    fn analyze_note_graph_in_conn_includes_resolved_factual_links_with_direction() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");
        seed_resolved_link(&conn, "l1", "n1", "n2", "Beta", "[[Beta]]");
        seed_resolved_link(&conn, "l2", "n3", "n1", "Alpha", "[[Alpha]]");

        let analysis = super::analyze_note_graph_in_conn(&conn, "n1").unwrap();

        assert_eq!(analysis.overview.factual_relations.len(), 2);

        let outgoing = analysis
            .overview
            .factual_relations
            .iter()
            .find(|item| item.direction == GraphRelationDirection::Outgoing)
            .unwrap();
        assert_eq!(outgoing.note.note_id, "n2");

        let incoming = analysis
            .overview
            .factual_relations
            .iter()
            .find(|item| item.direction == GraphRelationDirection::Incoming)
            .unwrap();
        assert_eq!(incoming.note.note_id, "n3");
    }

    #[test]
    fn analyze_note_graph_in_conn_excludes_conclusion_from_logic_paths() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        create_relation_in_conn(&conn, "n1", "n2", "conclusion", Some("alpha concludes beta".into()))
            .unwrap();

        let analysis = super::analyze_note_graph_in_conn(&conn, "n1").unwrap();

        assert!(analysis.logic_paths.is_empty());
    }

    #[test]
    fn accept_graph_candidate_creates_formal_relation_and_marks_candidate_accepted() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_candidate_relation(&conn, "candidate-1", "n1", "n2", "supports", "alpha supports beta");

        let relation = super::accept_graph_candidate_in_conn(&conn, "candidate-1", None, None).unwrap();

        assert_eq!(relation.source_note_id, "n1");
        assert_eq!(relation.target_note_id, "n2");
        assert_eq!(relation.relation_origin, RelationOrigin::CandidateAccepted);
        assert_eq!(relation.accepted_candidate_id.as_deref(), Some("candidate-1"));

        let candidate_status: String = conn
            .query_row(
                "SELECT candidate_status FROM graph_candidate_relations WHERE id = ?1",
                ["candidate-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(candidate_status, "accepted");
    }

    #[test]
    fn accept_graph_candidate_duplicate_relation_marks_candidate_accepted_with_existing_relation() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        let existing_relation =
            create_relation_in_conn(&conn, "n1", "n2", "supports", Some("existing relation".into()))
                .unwrap();
        seed_graph_candidate_relation(&conn, "candidate-duplicate", "n1", "n2", "supports", "candidate rationale");

        let accepted =
            super::accept_graph_candidate_in_conn(&conn, "candidate-duplicate", None, None).unwrap();

        assert_eq!(accepted.id, existing_relation.id);

        let (candidate_status, accepted_relation_id): (String, Option<String>) = conn
            .query_row(
                "SELECT candidate_status, accepted_relation_id FROM graph_candidate_relations WHERE id = ?1",
                ["candidate-duplicate"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(candidate_status, "accepted");
        assert_eq!(accepted_relation_id.as_deref(), Some(existing_relation.id.as_str()));
    }

    #[test]
    fn accept_graph_candidate_with_overrides_marks_relation_as_candidate_edited() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_candidate_relation(
            &conn,
            "candidate-edited",
            "n1",
            "n2",
            "supports",
            "alpha supports beta",
        );

        let relation = super::accept_graph_candidate_in_conn(
            &conn,
            "candidate-edited",
            Some("example".into()),
            Some("edited rationale".into()),
        )
        .unwrap();

        assert_eq!(relation.relation_type, RelationType::Example);
        assert_eq!(relation.relation_origin, RelationOrigin::CandidateEdited);
        assert_eq!(relation.accepted_candidate_id.as_deref(), Some("candidate-edited"));
    }

    #[test]
    fn insert_graph_candidate_rejects_self_candidate() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");

        let error = super::insert_graph_candidate_relation_in_conn(
            &conn,
            "n1",
            None,
            "n1",
            None,
            crate::domain::relation::RelationType::Supports,
            "self candidate",
            None,
            None,
        )
        .unwrap_err();

        assert!(error.to_string().contains("self candidate"));
    }

    #[test]
    fn insert_graph_candidate_rejects_missing_notes() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");

        let source_error = super::insert_graph_candidate_relation_in_conn(
            &conn,
            "missing",
            None,
            "n1",
            None,
            crate::domain::relation::RelationType::Supports,
            "missing source",
            None,
            None,
        )
        .unwrap_err();
        assert!(source_error.to_string().contains("source note not found"));

        let target_error = super::insert_graph_candidate_relation_in_conn(
            &conn,
            "n1",
            None,
            "missing",
            None,
            crate::domain::relation::RelationType::Supports,
            "missing target",
            None,
            None,
        )
        .unwrap_err();
        assert!(target_error.to_string().contains("target note not found"));
    }

    #[test]
    fn list_graph_candidates_returns_pending_candidates_for_note() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");
        seed_graph_candidate_relation(&conn, "candidate-pending", "n1", "n2", "supports", "pending rationale");
        seed_graph_candidate_relation(&conn, "candidate-other", "n2", "n3", "supports", "other rationale");
        conn.execute(
            "UPDATE graph_candidate_relations SET candidate_status = 'accepted' WHERE id = ?1",
            ["candidate-other"],
        )
        .unwrap();

        let candidates = super::list_graph_candidates_in_conn(&conn, "n1").unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "candidate-pending");
        assert_eq!(candidates[0].candidate_status.as_str(), "pending");
    }

    #[test]
    fn list_graph_candidates_rejects_missing_note() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_candidate_relation(&conn, "candidate-pending", "n1", "n2", "supports", "pending rationale");

        let error = super::list_graph_candidates_in_conn(&conn, "missing-note").unwrap_err();

        assert!(error.to_string().contains("note not found: missing-note"));
    }

    #[test]
    fn ignore_graph_candidate_marks_candidate_ignored() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_candidate_relation(&conn, "candidate-ignore", "n1", "n2", "supports", "ignore rationale");

        super::ignore_graph_candidate_in_conn(&conn, "candidate-ignore").unwrap();

        let (candidate_status, accepted_relation_id): (String, Option<String>) = conn
            .query_row(
                "SELECT candidate_status, accepted_relation_id FROM graph_candidate_relations WHERE id = ?1",
                ["candidate-ignore"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(candidate_status, "ignored");
        assert_eq!(accepted_relation_id, None);
    }

    #[test]
    fn ignore_graph_candidate_rejects_non_pending_candidate() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_candidate_relation(&conn, "candidate-ignored", "n1", "n2", "supports", "ignore rationale");
        conn.execute(
            "UPDATE graph_candidate_relations SET candidate_status = 'ignored' WHERE id = ?1",
            ["candidate-ignored"],
        )
        .unwrap();

        let error = super::ignore_graph_candidate_in_conn(&conn, "candidate-ignored").unwrap_err();

        assert!(error.to_string().contains("graph candidate is already ignored: candidate-ignored"));
    }

    #[test]
    fn generate_graph_candidates_parses_structured_llm_response() {
        let payload = r#"{"candidates":[{"source_note_id":"n2","target_note_id":"n1","relation_type":"supports","rationale":"n2 provides supporting context for n1","evidence_excerpt":"supporting excerpt"}]}"#;

        let candidates = super::parse_graph_candidate_generation(payload).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].relation_type, crate::domain::relation::RelationType::Supports);
        assert_eq!(candidates[0].target_note_id, "n1");
    }

    #[test]
    fn generate_graph_candidates_rejects_invalid_json_payload() {
        let error = super::parse_graph_candidate_generation("not-json").unwrap_err();

        match error {
            crate::error::AppError::InvalidInput(message) => {
                assert!(message.contains("invalid graph candidate payload"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn build_graph_candidate_prompt_includes_other_notes_without_existing_edges() {
        let root = TempDir::new().unwrap();
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Current", "notes/current.md");
        seed_graph_note(&conn, "n2", "Sibling", "notes/sibling.md");
        write_graph_note_file(root.path(), "notes/current.md", "# Current\n\nCurrent note content");

        let context = super::load_graph_candidate_prompt_context(&conn, root.path(), "n1").unwrap();
        let request = super::build_graph_candidate_prompt(&make_graph_ai_profile(), &context).unwrap();

        assert!(request.prompt.contains("可用 note_id：n1, n2"));
        assert!(request.prompt.contains("Sibling"));
    }

    #[test]
    fn persist_generated_candidates_rejects_note_outside_available_note_ids() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");

        let error = super::persist_generated_graph_candidates_in_conn(
            &conn,
            "n1",
            &["n1".to_string(), "n2".to_string()],
            vec![super::ParsedGraphCandidate {
                source_note_id: "n3".into(),
                source_heading_id: None,
                target_note_id: "n1".into(),
                target_heading_id: None,
                relation_type: crate::domain::relation::RelationType::Supports,
                rationale: "gamma supports alpha".into(),
                evidence_excerpt: Some("excerpt".into()),
                provider_name: None,
            }],
            Some("provider"),
        )
        .unwrap_err();

        assert!(error.to_string().contains("outside available_note_ids"));
        assert_eq!(count_pending_candidates(&conn, "n3", "n1", "supports"), 0);
    }

    #[test]
    fn persist_generated_candidates_rejects_candidate_without_current_note() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");

        let error = super::persist_generated_graph_candidates_in_conn(
            &conn,
            "n1",
            &["n1".to_string(), "n2".to_string(), "n3".to_string()],
            vec![super::ParsedGraphCandidate {
                source_note_id: "n2".into(),
                source_heading_id: None,
                target_note_id: "n3".into(),
                target_heading_id: None,
                relation_type: crate::domain::relation::RelationType::Supports,
                rationale: "beta supports gamma".into(),
                evidence_excerpt: Some("excerpt".into()),
                provider_name: None,
            }],
            Some("provider"),
        )
        .unwrap_err();

        assert!(error.to_string().contains("must involve current note"));
        assert_eq!(count_pending_candidates(&conn, "n2", "n3", "supports"), 0);
    }

    #[test]
    fn persist_generated_candidates_rejects_self_candidate() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");

        let error = super::persist_generated_graph_candidates_in_conn(
            &conn,
            "n1",
            &["n1".to_string()],
            vec![super::ParsedGraphCandidate {
                source_note_id: "n1".into(),
                source_heading_id: None,
                target_note_id: "n1".into(),
                target_heading_id: None,
                relation_type: crate::domain::relation::RelationType::Supports,
                rationale: "self relation".into(),
                evidence_excerpt: Some("excerpt".into()),
                provider_name: None,
            }],
            Some("provider"),
        )
        .unwrap_err();

        assert!(error.to_string().contains("cannot be a self relation"));
        assert_eq!(count_pending_candidates(&conn, "n1", "n1", "supports"), 0);
    }

    #[test]
    fn persist_generated_candidates_rolls_back_when_any_candidate_is_invalid() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");

        let error = super::persist_generated_graph_candidates_in_conn(
            &conn,
            "n1",
            &["n1".to_string(), "n2".to_string()],
            vec![
                super::ParsedGraphCandidate {
                    source_note_id: "n2".into(),
                    source_heading_id: None,
                    target_note_id: "n1".into(),
                    target_heading_id: None,
                    relation_type: crate::domain::relation::RelationType::Supports,
                    rationale: "beta supports alpha".into(),
                    evidence_excerpt: Some("valid".into()),
                    provider_name: None,
                },
                super::ParsedGraphCandidate {
                    source_note_id: "n3".into(),
                    source_heading_id: None,
                    target_note_id: "n1".into(),
                    target_heading_id: None,
                    relation_type: crate::domain::relation::RelationType::Supports,
                    rationale: "gamma supports alpha".into(),
                    evidence_excerpt: Some("invalid".into()),
                    provider_name: None,
                },
            ],
            Some("provider"),
        )
        .unwrap_err();

        assert!(error.to_string().contains("outside available_note_ids"));
        assert_eq!(count_pending_candidates(&conn, "n2", "n1", "supports"), 0);
        assert_eq!(count_pending_candidates(&conn, "n3", "n1", "supports"), 0);
    }

    #[test]
    fn persist_generated_candidates_skips_existing_formal_and_pending_duplicates() {
        let conn = setup_graph_test_conn();
        seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
        seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
        seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");
        create_relation_in_conn(&conn, "n2", "n1", "supports", Some("formal duplicate".into()))
            .unwrap();
        seed_graph_candidate_relation(&conn, "candidate-existing", "n3", "n1", "rebuts", "pending duplicate");

        let inserted = super::persist_generated_graph_candidates_in_conn(
            &conn,
            "n1",
            &["n1".to_string(), "n2".to_string(), "n3".to_string()],
            vec![
                super::ParsedGraphCandidate {
                    source_note_id: "n2".into(),
                    source_heading_id: None,
                    target_note_id: "n1".into(),
                    target_heading_id: None,
                    relation_type: crate::domain::relation::RelationType::Supports,
                    rationale: "formal duplicate".into(),
                    evidence_excerpt: Some("formal".into()),
                    provider_name: None,
                },
                super::ParsedGraphCandidate {
                    source_note_id: "n3".into(),
                    source_heading_id: None,
                    target_note_id: "n1".into(),
                    target_heading_id: None,
                    relation_type: crate::domain::relation::RelationType::Rebuts,
                    rationale: "pending duplicate".into(),
                    evidence_excerpt: Some("pending".into()),
                    provider_name: None,
                },
                super::ParsedGraphCandidate {
                    source_note_id: "n3".into(),
                    source_heading_id: None,
                    target_note_id: "n1".into(),
                    target_heading_id: None,
                    relation_type: crate::domain::relation::RelationType::Supports,
                    rationale: "new candidate".into(),
                    evidence_excerpt: Some("new".into()),
                    provider_name: None,
                },
            ],
            Some("provider"),
        )
        .unwrap();

        assert_eq!(inserted.len(), 1);
        assert_eq!(inserted[0].source_note_id, "n3");
        assert_eq!(inserted[0].target_note_id, "n1");
        assert_eq!(inserted[0].relation_type, crate::domain::relation::RelationType::Supports);
        assert_eq!(count_pending_candidates(&conn, "n2", "n1", "supports"), 0);
        assert_eq!(count_pending_candidates(&conn, "n3", "n1", "rebuts"), 1);
        assert_eq!(count_pending_candidates(&conn, "n3", "n1", "supports"), 1);
    }
}
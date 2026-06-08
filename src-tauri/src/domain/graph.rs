use crate::domain::relation::{GraphCandidateStatus, RelationOrigin, RelationType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphNodeRef {
    pub note_id: String,
    pub note_title: String,
    pub note_path: String,
    pub heading_id: Option<String>,
    pub heading_text: Option<String>,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GraphRelationDirection {
    Incoming,
    Outgoing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphRelationItem {
    pub relation_id: String,
    pub relation_type: RelationType,
    pub relation_origin: RelationOrigin,
    pub direction: GraphRelationDirection,
    pub note: GraphNodeRef,
    pub rationale: Option<String>,
    pub accepted_candidate_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphFactualRelationItem {
    pub link_id: String,
    pub direction: GraphRelationDirection,
    pub note: GraphNodeRef,
    pub link_text: Option<String>,
    pub link_type: String,
    pub target_anchor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GraphOverview {
    pub confirmed_relations: Vec<GraphRelationItem>,
    pub factual_relations: Vec<GraphFactualRelationItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphLogicPathStep {
    pub node: GraphNodeRef,
    pub relation_type: Option<RelationType>,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphLogicPath {
    pub id: String,
    pub label: String,
    pub steps: Vec<GraphLogicPathStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphConflictItem {
    pub relation_id: String,
    pub counterparty: GraphNodeRef,
    pub relation_type: RelationType,
    pub direction: GraphRelationDirection,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphCandidateRelation {
    pub id: String,
    pub source_note_id: String,
    pub source_heading_id: Option<String>,
    pub target_note_id: String,
    pub target_heading_id: Option<String>,
    pub relation_type: RelationType,
    pub rationale: String,
    pub evidence_excerpt: Option<String>,
    pub candidate_status: GraphCandidateStatus,
    pub provider_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub accepted_relation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteGraphAnalysis {
    pub note_id: String,
    pub overview: GraphOverview,
    pub logic_paths: Vec<GraphLogicPath>,
    pub conflicts: Vec<GraphConflictItem>,
    pub missing_premises: Vec<String>,
}
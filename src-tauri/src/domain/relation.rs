use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationType {
    Related,
    Prerequisite,
    Extension,
    Opposes,
    Supports,
    Similar,
    Premise,
    Conclusion,
    Example,
    Rebuts,
}

impl RelationType {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "related" => Some(Self::Related),
            "prerequisite" => Some(Self::Prerequisite),
            "extension" => Some(Self::Extension),
            "opposes" => Some(Self::Opposes),
            "supports" => Some(Self::Supports),
            "similar" => Some(Self::Similar),
            "premise" => Some(Self::Premise),
            "conclusion" => Some(Self::Conclusion),
            "example" => Some(Self::Example),
            "rebuts" => Some(Self::Rebuts),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Related => "related",
            Self::Prerequisite => "prerequisite",
            Self::Extension => "extension",
            Self::Opposes => "opposes",
            Self::Supports => "supports",
            Self::Similar => "similar",
            Self::Premise => "premise",
            Self::Conclusion => "conclusion",
            Self::Example => "example",
            Self::Rebuts => "rebuts",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphCandidateStatus {
    Pending,
    Accepted,
    Ignored,
}

impl GraphCandidateStatus {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "accepted" => Some(Self::Accepted),
            "ignored" => Some(Self::Ignored),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Ignored => "ignored",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relation {
    pub id: String,
    pub source_note_id: String,
    pub target_note_id: String,
    pub relation_type: RelationType,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationItem {
    pub id: String,
    pub relation_type: RelationType,
    pub description: Option<String>,
    pub note_id: String,
    pub note_title: String,
    pub note_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteRelations {
    pub outgoing: Vec<RelationItem>,
    pub incoming: Vec<RelationItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_is_relation_type(_: RelationType) {}

    #[test]
    fn relation_models_use_relation_type_enum() {
        let relation = Relation {
            id: "r1".to_string(),
            source_note_id: "n1".to_string(),
            target_note_id: "n2".to_string(),
            relation_type: RelationType::Supports,
            description: Some("supports context".to_string()),
            created_at: "2026-05-31T00:00:00Z".to_string(),
            updated_at: "2026-05-31T00:00:00Z".to_string(),
        };
        let relation_item = RelationItem {
            id: "r2".to_string(),
            relation_type: RelationType::Opposes,
            description: None,
            note_id: "n3".to_string(),
            note_title: "Note".to_string(),
            note_path: "notes/n3.md".to_string(),
            created_at: "2026-05-31T00:00:00Z".to_string(),
            updated_at: "2026-05-31T00:00:00Z".to_string(),
        };

        assert_is_relation_type(relation.relation_type);
        assert_is_relation_type(relation_item.relation_type);
    }

    #[test]
    fn relation_type_parse_supports_graph_semantics() {
        assert_eq!(RelationType::parse("premise"), Some(RelationType::Premise));
        assert_eq!(RelationType::parse("conclusion"), Some(RelationType::Conclusion));
        assert_eq!(RelationType::parse("example"), Some(RelationType::Example));
        assert_eq!(RelationType::parse("rebuts"), Some(RelationType::Rebuts));
    }
}
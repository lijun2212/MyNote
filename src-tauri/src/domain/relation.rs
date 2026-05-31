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
}
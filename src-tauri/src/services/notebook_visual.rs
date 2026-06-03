use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{atomic_write, normalize_kb_relative_path};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const NOTEBOOK_VISUALS_FILE: &str = ".mynote/notebook-visuals.json";
const DEFAULT_ICON: &str = "folder";
const DEFAULT_COLOR: &str = "gray";
const ALLOWED_ICONS: &[&str] = &[
    "folder", "book", "idea", "code", "list", "archive", "star", "tag",
];
const ALLOWED_COLORS: &[&str] = &[
    "blue", "cyan", "green", "orange", "red", "pink", "brown", "gray",
];

static NOTEBOOK_VISUAL_SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub type NotebookVisualMap = BTreeMap<String, NotebookVisual>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotebookVisual {
    pub icon: String,
    pub color: String,
    pub order: Option<i64>,
}

impl Default for NotebookVisual {
    fn default() -> Self {
        Self {
            icon: DEFAULT_ICON.to_string(),
            color: DEFAULT_COLOR.to_string(),
            order: None,
        }
    }
}

pub fn load_notebook_visuals(root: &Path) -> NotebookVisualMap {
    let content = match std::fs::read_to_string(notebook_visuals_path(root)) {
        Ok(content) => content,
        Err(_) => return NotebookVisualMap::new(),
    };

    let value: Value = match serde_json::from_str(&content) {
        Ok(value) => value,
        Err(_) => return NotebookVisualMap::new(),
    };

    let Some(entries) = value.as_object() else {
        return NotebookVisualMap::new();
    };

    let mut visuals = NotebookVisualMap::new();
    for (notebook_path, raw_visual) in entries {
        let Ok(notebook_path) = normalize_notebook_path(notebook_path) else {
            continue;
        };

        if !notebook_directory_exists(root, &notebook_path) {
            continue;
        }

        let Some(visual) = normalize_visual_from_value(raw_visual) else {
            continue;
        };

        visuals.insert(notebook_path, visual);
    }

    visuals
}

pub fn save_notebook_visual(
    root: &Path,
    notebook_path: &str,
    icon: &str,
    color: &str,
    order: Option<i64>,
) -> AppResult<()> {
    let _lock = NOTEBOOK_VISUAL_SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| AppError::InvalidInput(format!("Notebook visual save lock poisoned: {}", error)))?;

    let notebook_path = normalize_notebook_path(notebook_path)?;
    let mut visuals = load_notebook_visuals_for_save(root)?;
    let normalized = normalize_visual(icon, color);
    let visual_entry = visuals
        .entry(notebook_path)
        .or_insert_with(|| Value::Object(Map::new()));

    let visual_object = match visual_entry {
        Value::Object(object) => object,
        other => {
            *other = Value::Object(Map::new());
            match other {
                Value::Object(object) => object,
                _ => unreachable!(),
            }
        }
    };

    visual_object.insert("icon".into(), Value::String(normalized.icon));
    visual_object.insert("color".into(), Value::String(normalized.color));
    match order {
        Some(order) => {
            visual_object.insert("order".into(), Value::Number(order.into()));
        }
        None => {
            visual_object.remove("order");
        }
    }

    write_notebook_visuals(root, &visuals)
}

pub fn rename_notebook_visual(root: &Path, old_path: &str, new_path: &str) -> AppResult<()> {
    let _lock = NOTEBOOK_VISUAL_SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| AppError::InvalidInput(format!("Notebook visual save lock poisoned: {}", error)))?;

    let old_path = normalize_notebook_path(old_path)?;
    let new_path = normalize_notebook_path(new_path)?;
    let mut visuals = load_raw_notebook_visuals(root)?;

    if let Some(value) = visuals.remove(&old_path) {
        visuals.insert(new_path, value);
        write_notebook_visuals(root, &visuals)?;
    }

    Ok(())
}

pub fn delete_notebook_visual(root: &Path, notebook_path: &str) -> AppResult<()> {
    let _lock = NOTEBOOK_VISUAL_SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| AppError::InvalidInput(format!("Notebook visual save lock poisoned: {}", error)))?;

    let notebook_path = normalize_notebook_path(notebook_path)?;
    let mut visuals = load_raw_notebook_visuals(root)?;
    visuals.remove(&notebook_path);

    write_notebook_visuals(root, &visuals)
}

pub fn visual_for_path(visuals: &NotebookVisualMap, notebook_path: &str) -> NotebookVisual {
    let Ok(notebook_path) = normalize_notebook_path(notebook_path) else {
        return NotebookVisual::default();
    };

    visuals.get(&notebook_path).cloned().unwrap_or_default()
}

fn notebook_visuals_path(root: &Path) -> PathBuf {
    root.join(NOTEBOOK_VISUALS_FILE)
}

fn normalize_visual(icon: &str, color: &str) -> NotebookVisual {
    NotebookVisual {
        icon: normalize_token(icon, ALLOWED_ICONS, DEFAULT_ICON),
        color: normalize_token(color, ALLOWED_COLORS, DEFAULT_COLOR),
        order: None,
    }
}

fn write_notebook_visuals(root: &Path, visuals: &Map<String, Value>) -> AppResult<()> {
    let content = serde_json::to_string_pretty(visuals)
        .map_err(|error| AppError::Parse(error.to_string()))?;

    atomic_write(&notebook_visuals_path(root), &format!("{}\n", content))
}

fn load_raw_notebook_visuals(root: &Path) -> AppResult<Map<String, Value>> {
    let path = notebook_visuals_path(root);
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Map::new())
        }
        Err(error) => return Err(AppError::Io(error.to_string())),
    };

    let value: Value = serde_json::from_str(&content)
        .map_err(|error| AppError::Parse(error.to_string()))?;

    value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::Parse("Notebook visuals metadata must be a JSON object".into()))
}

fn load_notebook_visuals_for_save(root: &Path) -> AppResult<Map<String, Value>> {
    let entries = load_raw_notebook_visuals(root)?;

    let mut visuals = Map::new();
    for (notebook_path, raw_visual) in &entries {
        let Ok(notebook_path) = normalize_notebook_path(notebook_path) else {
            continue;
        };

        if !notebook_directory_exists(root, &notebook_path) {
            continue;
        }

        match raw_visual {
            Value::Object(object) => {
                let normalized = normalize_visual_from_value(raw_visual)
                    .expect("object notebook visual should normalize");
                let mut visual_object = object.clone();
                visual_object.insert("icon".into(), Value::String(normalized.icon));
                visual_object.insert("color".into(), Value::String(normalized.color));
                match normalized.order {
                    Some(order) => {
                        visual_object.insert("order".into(), Value::Number(order.into()));
                    }
                    None => {
                        visual_object.remove("order");
                    }
                }
                visuals.insert(notebook_path, Value::Object(visual_object));
            }
            _ => {
                visuals.insert(notebook_path, raw_visual.clone());
            }
        }
    }

    Ok(visuals)
}

fn normalize_visual_from_value(value: &Value) -> Option<NotebookVisual> {
    let Some(object) = value.as_object() else {
        return None;
    };

    let mut visual = normalize_visual(
        object.get("icon").and_then(Value::as_str).unwrap_or(DEFAULT_ICON),
        object
            .get("color")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_COLOR),
    );
    visual.order = object.get("order").and_then(Value::as_i64);

    Some(visual)
}

fn normalize_token(value: &str, allowed: &[&str], default: &str) -> String {
    if allowed.contains(&value) {
        value.to_string()
    } else {
        default.to_string()
    }
}

fn normalize_notebook_path(notebook_path: &str) -> AppResult<String> {
    let notebook_path = normalize_kb_relative_path(notebook_path)?;
    let parts = notebook_path.split('/').collect::<Vec<_>>();

    if parts.len() != 2 || parts[0] != "notes" {
        return Err(AppError::InvalidInput(format!(
            "Notebook path must be a top-level directory under notes: {}",
            notebook_path
        )));
    }

    Ok(notebook_path)
}

fn notebook_directory_exists(root: &Path, notebook_path: &str) -> bool {
    root.join(notebook_path.replace('/', std::path::MAIN_SEPARATOR_STR))
        .is_dir()
}

#[cfg(test)]
mod tests {
    use super::{
        delete_notebook_visual, load_notebook_visuals, rename_notebook_visual,
        save_notebook_visual, visual_for_path,
    };
    use serde_json::Value;
    use tempfile::TempDir;

    #[test]
    fn load_notebook_visuals_returns_empty_when_file_missing() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();

        let visuals = load_notebook_visuals(root.path());

        assert!(visuals.is_empty());
    }

    #[test]
    fn save_notebook_visual_persists_and_reload_filters_missing_directories() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/stale")).unwrap();

        save_notebook_visual(root.path(), "notes/work", "idea", "cyan", None).unwrap();
        save_notebook_visual(
            root.path(),
            "notes/stale",
            "invalid-icon",
            "invalid-color",
            None,
        )
            .unwrap();

        let raw = std::fs::read_to_string(root.path().join(".mynote/notebook-visuals.json"))
            .unwrap();
        let stored: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(stored["notes/stale"]["icon"], Value::String("folder".into()));
        assert_eq!(stored["notes/stale"]["color"], Value::String("gray".into()));

        std::fs::remove_dir_all(root.path().join("notes/stale")).unwrap();

        let visuals = load_notebook_visuals(root.path());
        assert_eq!(visuals.len(), 1);

        let work_visual = visual_for_path(&visuals, "notes/work");
        assert_eq!(work_visual.icon, "idea");
        assert_eq!(work_visual.color, "cyan");
        assert_eq!(work_visual.order, None);

        let stale_visual = visual_for_path(&visuals, "notes/stale");
        assert_eq!(stale_visual.icon, "folder");
        assert_eq!(stale_visual.color, "gray");
        assert_eq!(stale_visual.order, None);
    }

    #[test]
    fn save_notebook_visual_rejects_malformed_existing_metadata_file() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join(".mynote")).unwrap();
        let metadata_path = root.path().join(".mynote/notebook-visuals.json");
        std::fs::write(&metadata_path, "{not-valid-json").unwrap();

        let result = save_notebook_visual(root.path(), "notes/work", "idea", "cyan", None);

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&metadata_path).unwrap(), "{not-valid-json");
    }

    #[test]
    fn save_notebook_visual_preserves_unknown_fields_in_existing_records() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/ideas")).unwrap();
        std::fs::create_dir_all(root.path().join(".mynote")).unwrap();
        let metadata_path = root.path().join(".mynote/notebook-visuals.json");
        std::fs::write(
            &metadata_path,
            concat!(
                "{\n",
                "  \"notes/work\": {\n",
                "    \"icon\": \"book\",\n",
                "    \"color\": \"blue\",\n",
                "    \"description\": \"keep me\",\n",
                "    \"updated_at\": \"2026-06-03T00:00:00Z\"\n",
                "  },\n",
                "  \"notes/ideas\": {\n",
                "    \"icon\": \"idea\",\n",
                "    \"color\": \"cyan\",\n",
                "    \"sort_order\": 7\n",
                "  }\n",
                "}\n"
            ),
        )
        .unwrap();

        save_notebook_visual(root.path(), "notes/work", "star", "orange", None).unwrap();

        let raw = std::fs::read_to_string(&metadata_path).unwrap();
        assert!(raw.contains("\"notes/work\""));
        assert!(raw.contains("\"icon\": \"star\""));
        assert!(raw.contains("\"color\": \"orange\""));
        assert!(raw.contains("\"description\": \"keep me\""));
        assert!(raw.contains("\"updated_at\": \"2026-06-03T00:00:00Z\""));
        assert!(raw.contains("\"notes/ideas\""));
        assert!(raw.contains("\"sort_order\": 7"));
    }

    #[test]
    fn load_skips_invalid_record_shapes_and_save_preserves_them_for_other_paths() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/ideas")).unwrap();
        std::fs::create_dir_all(root.path().join(".mynote")).unwrap();
        let metadata_path = root.path().join(".mynote/notebook-visuals.json");
        std::fs::write(
            &metadata_path,
            concat!(
                "{\n",
                "  \"notes/work\": {\n",
                "    \"icon\": \"book\",\n",
                "    \"color\": \"blue\"\n",
                "  },\n",
                "  \"notes/ideas\": 42\n",
                "}\n"
            ),
        )
        .unwrap();

        let visuals = load_notebook_visuals(root.path());
        assert_eq!(visuals.len(), 1);
        assert!(visuals.get("notes/ideas").is_none());

        save_notebook_visual(root.path(), "notes/work", "star", "orange", None).unwrap();

        let raw = std::fs::read_to_string(&metadata_path).unwrap();
        assert!(raw.contains("\"notes/work\""));
        assert!(raw.contains("\"icon\": \"star\""));
        assert!(raw.contains("\"notes/ideas\": 42"));
    }

    #[test]
    fn save_notebook_visual_persists_order_field() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        save_notebook_visual(root.path(), "notes/work", "idea", "cyan", Some(20)).unwrap();

        let raw = std::fs::read_to_string(root.path().join(".mynote/notebook-visuals.json"))
            .unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["notes/work"]["order"], 20);
    }

    #[test]
    fn rename_notebook_visual_moves_existing_record_without_losing_fields() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
        std::fs::create_dir_all(root.path().join("notes/target")).unwrap();

        save_notebook_visual(root.path(), "notes/source", "book", "blue", Some(10)).unwrap();
        rename_notebook_visual(root.path(), "notes/source", "notes/target").unwrap();

        let visuals = load_notebook_visuals(root.path());
        assert!(visuals.get("notes/source").is_none());
        let target = visuals.get("notes/target").unwrap();
        assert_eq!(target.icon, "book");
        assert_eq!(target.color, "blue");
        assert_eq!(target.order, Some(10));
    }

    #[test]
    fn rename_notebook_visual_preserves_record_after_filesystem_rename() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/source")).unwrap();

        save_notebook_visual(root.path(), "notes/source", "book", "blue", Some(10)).unwrap();
        std::fs::rename(
            root.path().join("notes/source"),
            root.path().join("notes/target"),
        )
        .unwrap();

        rename_notebook_visual(root.path(), "notes/source", "notes/target").unwrap();

        let visuals = load_notebook_visuals(root.path());
        assert!(visuals.get("notes/source").is_none());
        let target = visuals.get("notes/target").unwrap();
        assert_eq!(target.icon, "book");
        assert_eq!(target.color, "blue");
        assert_eq!(target.order, Some(10));
    }

    #[test]
    fn delete_notebook_visual_removes_record() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        save_notebook_visual(root.path(), "notes/work", "tag", "pink", Some(30)).unwrap();
        delete_notebook_visual(root.path(), "notes/work").unwrap();

        let visuals = load_notebook_visuals(root.path());
        assert!(visuals.get("notes/work").is_none());
    }

    #[test]
    fn delete_notebook_visual_removes_record_after_directory_delete() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

        save_notebook_visual(root.path(), "notes/work", "tag", "pink", Some(30)).unwrap();
        std::fs::remove_dir(root.path().join("notes/work")).unwrap();

        delete_notebook_visual(root.path(), "notes/work").unwrap();

        let raw = std::fs::read_to_string(root.path().join(".mynote/notebook-visuals.json"))
            .unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert!(value.get("notes/work").is_none());
    }
}

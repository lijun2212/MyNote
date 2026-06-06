use crate::domain::ai::{AiProfile, AiProfileInput, AiProviderKind, AiSettings};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use ulid::Ulid;

const AI_SCOPE: &str = "ai";
const DEFAULT_PROFILE_KEY: &str = "default_profile_id";
const ENABLED_KEY: &str = "enabled";
const PROFILE_SCOPE_PREFIX: &str = "ai_profile:";

pub fn load_ai_settings(conn: &Connection) -> AppResult<AiSettings> {
    let enabled = load_bool_setting(conn, AI_SCOPE, ENABLED_KEY)?.unwrap_or(false);
    let default_profile_id = load_string_setting(conn, AI_SCOPE, DEFAULT_PROFILE_KEY)?;

    let mut stmt = conn.prepare(
        "SELECT scope, key, value FROM settings WHERE scope LIKE ?1 ORDER BY scope, key",
    )?;
    let rows = stmt.query_map(params![format!("{PROFILE_SCOPE_PREFIX}%")], |row| {
        let scope: String = row.get(0)?;
        let key: String = row.get(1)?;
        let value: String = row.get(2)?;
        Ok((scope, key, value))
    })?;

    let mut grouped_fields: HashMap<String, HashMap<String, String>> = HashMap::new();
    for row in rows {
        let (scope, key, value) = row?;
        grouped_fields.entry(scope).or_default().insert(key, value);
    }

    let mut profiles = grouped_fields
        .into_iter()
        .map(|(scope, fields)| build_profile_from_scope(scope.as_str(), &fields))
        .collect::<AppResult<Vec<_>>>()?;
    profiles.sort_by(|left, right| left.name.cmp(&right.name).then_with(|| left.id.cmp(&right.id)));

    if let Some(profile_id) = default_profile_id.as_deref() {
        if !profiles.iter().any(|profile| profile.id == profile_id) {
            return Err(AppError::InvalidInput(format!(
                "Default AI profile does not exist: {profile_id}"
            )));
        }
    }

    Ok(AiSettings {
        enabled,
        default_profile_id,
        profiles,
    })
}

pub fn load_ai_profile(conn: &Connection, profile_id: &str) -> AppResult<AiProfile> {
    let scope = profile_scope(profile_id);
    let mut stmt = conn.prepare("SELECT key, value FROM settings WHERE scope = ?1 ORDER BY key")?;
    let rows = stmt.query_map(params![scope.clone()], |row| {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        Ok((key, value))
    })?;

    let mut fields = HashMap::new();
    for row in rows {
        let (key, value) = row?;
        fields.insert(key, value);
    }

    if fields.is_empty() {
        return Err(AppError::NotFound(format!("AI profile not found: {profile_id}")));
    }

    build_profile_from_scope(&scope, &fields)
}

pub fn upsert_ai_profile(conn: &Connection, input: AiProfileInput) -> AppResult<AiProfile> {
    let profile = AiProfile {
        id: normalize_profile_id(input.id)?,
        name: normalize_required_string("name", input.name)?,
        provider: input.provider,
        model: normalize_required_string("model", input.model)?,
        base_url: input.base_url.map(normalize_optional_string),
        max_tokens: input.max_tokens,
        temperature: input.temperature,
        enabled: input.enabled,
    };

    let scope = profile_scope(&profile.id);
    let tx = conn.unchecked_transaction()?;

    upsert_setting(&tx, &scope, "name", &profile.name)?;
    upsert_setting(&tx, &scope, "provider", profile.provider.as_setting_value())?;
    upsert_setting(&tx, &scope, "model", &profile.model)?;
    upsert_optional_setting(&tx, &scope, "base_url", profile.base_url.as_deref())?;
    upsert_optional_setting(
        &tx,
        &scope,
        "max_tokens",
        profile.max_tokens.map(|value| value.to_string()).as_deref(),
    )?;
    upsert_optional_setting(
        &tx,
        &scope,
        "temperature",
        profile.temperature.map(|value| value.to_string()).as_deref(),
    )?;
    upsert_setting(&tx, &scope, "enabled", if profile.enabled { "true" } else { "false" })?;

    tx.commit()?;

    Ok(profile)
}

pub fn save_ai_settings(
    conn: &Connection,
    enabled: bool,
    default_profile_id: Option<String>,
) -> AppResult<AiSettings> {
    let normalized_default_profile_id = default_profile_id
        .map(|profile_id| normalize_profile_id(Some(profile_id)))
        .transpose()?;

    if let Some(profile_id) = normalized_default_profile_id.as_deref() {
        load_ai_profile(conn, profile_id)?;
    }

    let tx = conn.unchecked_transaction()?;
    upsert_setting(&tx, AI_SCOPE, ENABLED_KEY, if enabled { "true" } else { "false" })?;
    upsert_optional_setting(
        &tx,
        AI_SCOPE,
        DEFAULT_PROFILE_KEY,
        normalized_default_profile_id.as_deref(),
    )?;
    tx.commit()?;

    load_ai_settings(conn)
}

fn build_profile_from_scope(scope: &str, fields: &HashMap<String, String>) -> AppResult<AiProfile> {
    let id = scope
        .strip_prefix(PROFILE_SCOPE_PREFIX)
        .ok_or_else(|| AppError::Parse(format!("Invalid AI profile scope: {scope}")))?
        .to_string();
    let name = fields
        .get("name")
        .cloned()
        .ok_or_else(|| AppError::Parse(format!("AI profile {id} is missing name")))?;
    let provider = AiProviderKind::from_setting_value(
        fields
            .get("provider")
            .ok_or_else(|| AppError::Parse(format!("AI profile {id} is missing provider")))?
            .as_str(),
    )
    .ok_or_else(|| AppError::Parse(format!("AI profile {id} has invalid provider")))?;
    let model = fields
        .get("model")
        .cloned()
        .ok_or_else(|| AppError::Parse(format!("AI profile {id} is missing model")))?;
    let base_url = fields.get("base_url").cloned().filter(|value| !value.trim().is_empty());
    let max_tokens = match fields.get("max_tokens") {
        Some(value) => Some(
            value
                .parse::<u32>()
                .map_err(|_| AppError::Parse(format!("AI profile {id} has invalid max_tokens")))?,
        ),
        None => None,
    };
    let temperature = match fields.get("temperature") {
        Some(value) => Some(
            value
                .parse::<f32>()
                .map_err(|_| AppError::Parse(format!("AI profile {id} has invalid temperature")))?,
        ),
        None => None,
    };
    let enabled = fields.get("enabled").is_some_and(|value| value == "true");

    Ok(AiProfile {
        id,
        name,
        provider,
        model,
        base_url,
        max_tokens,
        temperature,
        enabled,
    })
}

fn load_string_setting(conn: &Connection, scope: &str, key: &str) -> AppResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE scope = ?1 AND key = ?2")?;
    match stmt.query_row(params![scope, key], |row| row.get::<_, String>(0)) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(AppError::Database(error.to_string())),
    }
}

fn load_bool_setting(conn: &Connection, scope: &str, key: &str) -> AppResult<Option<bool>> {
    Ok(load_string_setting(conn, scope, key)?.map(|value| value == "true"))
}

fn upsert_setting(conn: &Connection, scope: &str, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (scope, key, value, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![scope, key, value],
    )?;
    Ok(())
}

fn upsert_optional_setting(
    conn: &Connection,
    scope: &str,
    key: &str,
    value: Option<&str>,
) -> AppResult<()> {
    if let Some(value) = value {
        upsert_setting(conn, scope, key, value)?;
    } else {
        conn.execute("DELETE FROM settings WHERE scope = ?1 AND key = ?2", params![scope, key])?;
    }
    Ok(())
}

fn profile_scope(profile_id: &str) -> String {
    format!("{PROFILE_SCOPE_PREFIX}{profile_id}")
}

fn normalize_profile_id(input: Option<String>) -> AppResult<String> {
    match input {
        Some(id) => {
            let trimmed = id.trim();
            if trimmed.is_empty() {
                Err(AppError::InvalidInput("AI profile id cannot be blank".into()))
            } else {
                Ok(trimmed.to_string())
            }
        }
        None => Ok(Ulid::new().to_string()),
    }
}

fn normalize_required_string(field: &str, value: String) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(AppError::InvalidInput(format!("AI profile {field} cannot be blank")))
    } else {
        Ok(trimmed.to_string())
    }
}

fn normalize_optional_string(value: String) -> String {
    value.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::{load_ai_profile, load_ai_settings, save_ai_settings, upsert_ai_profile};
    use crate::domain::ai::{AiProfileInput, AiProviderKind};
    use crate::error::AppError;
    use crate::infrastructure::db::open_and_migrate;
    use rusqlite::params;
    use tempfile::tempdir;

    #[test]
    fn upsert_ai_profile_persists_non_secret_fields_into_settings() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        let profile = AiProfileInput {
            id: None,
            name: "OpenAI Prod".into(),
            provider: AiProviderKind::OpenAiCompatible,
            model: "gpt-4.1-mini".into(),
            base_url: Some("https://api.openai.com/v1".into()),
            max_tokens: Some(240),
            temperature: Some(0.3),
            enabled: true,
        };

        let saved = upsert_ai_profile(&conn, profile).unwrap();
        let settings = load_ai_settings(&conn).unwrap();

        assert_eq!(settings.default_profile_id, None);
        assert_eq!(settings.profiles.len(), 1);
        assert_eq!(settings.profiles[0].id, saved.id);
        assert_eq!(settings.profiles[0].model, "gpt-4.1-mini");
        assert_eq!(
            settings.profiles[0].base_url.as_deref(),
            Some("https://api.openai.com/v1")
        );
    }

    #[test]
    fn load_ai_profile_returns_not_found_for_unknown_profile() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        let error = load_ai_profile(&conn, "missing-profile").unwrap_err();

        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn load_ai_settings_reads_global_enabled_and_default_profile() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai", "enabled", "true"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai", "default_profile_id", "profile-1"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai_profile:profile-1", "name", "Anthropic Main"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai_profile:profile-1", "provider", "anthropic"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai_profile:profile-1", "model", "claude-3-5-sonnet"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai_profile:profile-1", "enabled", "true"],
        )
        .unwrap();

        let settings = load_ai_settings(&conn).unwrap();

        assert!(settings.enabled);
        assert_eq!(settings.default_profile_id.as_deref(), Some("profile-1"));
        assert_eq!(settings.profiles.len(), 1);
        assert_eq!(settings.profiles[0].provider, AiProviderKind::Anthropic);
    }

    #[test]
    fn load_ai_settings_rejects_dangling_default_profile_id() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai", "default_profile_id", "missing-profile"],
        )
        .unwrap();

        let error = load_ai_settings(&conn).unwrap_err();

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn upsert_ai_profile_rejects_blank_profile_id() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        let error = upsert_ai_profile(
            &conn,
            AiProfileInput {
                id: Some("   ".into()),
                name: "OpenAI Prod".into(),
                provider: AiProviderKind::OpenAiCompatible,
                model: "gpt-4.1-mini".into(),
                base_url: None,
                max_tokens: None,
                temperature: None,
                enabled: true,
            },
        )
        .unwrap_err();

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn save_ai_settings_persists_enabled_flag_and_default_profile() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        upsert_ai_profile(
            &conn,
            AiProfileInput {
                id: Some("profile-1".into()),
                name: "OpenAI Prod".into(),
                provider: AiProviderKind::OpenAiCompatible,
                model: "gpt-4.1-mini".into(),
                base_url: None,
                max_tokens: None,
                temperature: None,
                enabled: true,
            },
        )
        .unwrap();

        let settings = save_ai_settings(&conn, true, Some("profile-1".into())).unwrap();

        assert!(settings.enabled);
        assert_eq!(settings.default_profile_id.as_deref(), Some("profile-1"));
    }

    #[test]
    fn save_ai_settings_rejects_missing_default_profile() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        let error = save_ai_settings(&conn, true, Some("missing-profile".into())).unwrap_err();

        assert!(matches!(error, AppError::NotFound(_)));
    }
}

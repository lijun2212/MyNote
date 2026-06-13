use crate::domain::ai::{
    AiProfile, AiProfileInput, AiProfileTestErrorKind, AiProfileTestResult,
    AiProfileTestStatus, AiSettings,
};
use crate::error::AppError;
use crate::services::ai::{
    build_secret_store_key, cache_profile_secret, load_ai_profile, load_ai_settings, load_profile_secret,
    normalize_profile_id,
    save_ai_settings as save_ai_settings_in_conn, upsert_ai_profile as upsert_ai_profile_in_conn,
    AiOrchestrator, AiSecretStore,
    SystemSecretStore,
};
use crate::state::AppState;
use rusqlite::Connection;
use std::path::Path;
use tauri::State;

fn get_ai_settings_from_conn(conn: &Connection) -> Result<AiSettings, AppError> {
    load_ai_settings(conn)
}

fn normalize_api_key(api_key: &str) -> Result<String, AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        Err(AppError::InvalidInput("AI API key cannot be blank".into()))
    } else {
        Ok(trimmed.to_string())
    }
}

fn set_ai_profile_secret_in_conn(
    conn: &Connection,
    secret_store: &dyn AiSecretStore,
    secret_key: &str,
    profile_id: &str,
    api_key: &str,
) -> Result<(), AppError> {
    let normalized_profile_id = normalize_profile_id(profile_id)?;
    let normalized_api_key = normalize_api_key(api_key)?;
    load_ai_profile(conn, &normalized_profile_id)?;
    secret_store.set_profile_secret(secret_key, &normalized_api_key)?;

    match secret_store.get_profile_secret(secret_key) {
        Ok(_) => {
            cache_profile_secret(secret_key, &normalized_api_key);
            Ok(())
        }
        Err(AppError::NotFound(_)) => Err(AppError::Io(
            "Failed to verify saved AI profile secret in the system keychain".into(),
        )),
        Err(error) => Err(error),
    }
}

fn has_ai_profile_secret_in_conn(
    conn: &Connection,
    secret_store: &dyn AiSecretStore,
    kb_root: &Path,
    profile_id: &str,
) -> Result<bool, AppError> {
    let normalized_profile_id = normalize_profile_id(profile_id)?;
    load_ai_profile(conn, &normalized_profile_id)?;

    match load_profile_secret(secret_store, kb_root, &normalized_profile_id) {
        Ok(_) => Ok(true),
        Err(AppError::NotFound(_)) => Ok(false),
        Err(error) => Err(error),
    }
}

enum PreparedAiProfileTest {
    Ready { profile: AiProfile, api_key: String },
    Immediate(AiProfileTestResult),
}

fn prepare_ai_profile_test_in_conn(
    conn: &Connection,
    secret_store: &dyn AiSecretStore,
    kb_root: &Path,
    profile_id: &str,
) -> Result<PreparedAiProfileTest, AppError> {
    let normalized_profile_id = normalize_profile_id(profile_id)?;
    let profile = load_ai_profile(conn, &normalized_profile_id)?;

    match load_profile_secret(secret_store, kb_root, &normalized_profile_id) {
        Ok(api_key) => Ok(PreparedAiProfileTest::Ready { profile, api_key }),
        Err(AppError::NotFound(_)) => Ok(PreparedAiProfileTest::Immediate(AiProfileTestResult {
            success: false,
            status: AiProfileTestStatus::MissingSecret,
            message: format!(
                "AI profile {} is missing an API key in the system keychain.",
                normalized_profile_id
            ),
            error_kind: None,
            retryable: None,
            text: None,
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            latency_ms: None,
        })),
        Err(AppError::Io(message)) => Ok(PreparedAiProfileTest::Immediate(AiProfileTestResult {
            success: false,
            status: AiProfileTestStatus::KeychainUnavailable,
            message,
            error_kind: Some(AiProfileTestErrorKind::ProviderUnavailable),
            retryable: Some(true),
            text: None,
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            latency_ms: None,
        })),
        Err(error) => Err(error),
    }
}

fn classify_failed_profile_test(error: &AppError) -> (AiProfileTestErrorKind, bool) {
    match error {
        AppError::Io(_) => (AiProfileTestErrorKind::ProviderUnavailable, true),
        AppError::InvalidInput(_) => (AiProfileTestErrorKind::InvalidConfiguration, false),
        AppError::Parse(_) => (AiProfileTestErrorKind::InvalidResponse, false),
        _ => (AiProfileTestErrorKind::Unknown, false),
    }
}

fn normalize_required_field(field: &str, value: String) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(AppError::InvalidInput(format!("AI profile {field} cannot be blank")))
    } else {
        Ok(trimmed.to_string())
    }
}

fn normalize_optional_field(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_optional_api_key(api_key: Option<String>) -> Result<Option<String>, AppError> {
    match api_key {
        Some(value) => normalize_api_key(&value).map(Some),
        None => Ok(None),
    }
}

fn build_test_profile_from_input(input: AiProfileInput) -> Result<(AiProfile, Option<String>), AppError> {
    let normalized_input_profile_id = input
        .id
        .as_deref()
        .map(normalize_profile_id)
        .transpose()?;

    let profile = AiProfile {
        id: normalized_input_profile_id
            .clone()
            .unwrap_or_else(|| "draft-profile".to_string()),
        name: normalize_required_field("name", input.name)?,
        provider: input.provider,
        model: normalize_required_field("model", input.model)?,
        base_url: normalize_optional_field(input.base_url),
        max_tokens: input.max_tokens,
        temperature: input.temperature,
        enabled: input.enabled,
    };

    Ok((profile, normalized_input_profile_id))
}

fn prepare_ai_profile_input_test_in_conn(
    conn: &Connection,
    secret_store: &dyn AiSecretStore,
    kb_root: &Path,
    input: AiProfileInput,
    api_key: Option<String>,
) -> Result<(String, PreparedAiProfileTest), AppError> {
    let normalized_api_key = normalize_optional_api_key(api_key)?;
    let (profile, existing_profile_id) = build_test_profile_from_input(input)?;
    let profile_id_for_message = profile.id.clone();

    if let Some(api_key) = normalized_api_key {
        return Ok((
            profile_id_for_message,
            PreparedAiProfileTest::Ready { profile, api_key },
        ));
    }

    let Some(existing_profile_id) = existing_profile_id else {
        return Ok((
            profile_id_for_message,
            PreparedAiProfileTest::Immediate(AiProfileTestResult {
                success: false,
                status: AiProfileTestStatus::MissingSecret,
                message: "请先填写 API Key，再测试连接。".into(),
                error_kind: None,
                retryable: None,
                text: None,
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                latency_ms: None,
            }),
        ));
    };

    load_ai_profile(conn, &existing_profile_id)?;
    match load_profile_secret(secret_store, kb_root, &existing_profile_id) {
        Ok(api_key) => Ok((
            profile_id_for_message,
            PreparedAiProfileTest::Ready { profile, api_key },
        )),
        Err(AppError::NotFound(_)) => Ok((
            profile_id_for_message,
            PreparedAiProfileTest::Immediate(AiProfileTestResult {
                success: false,
                status: AiProfileTestStatus::MissingSecret,
                message: format!(
                    "AI profile {} is missing an API key in the system keychain.",
                    existing_profile_id
                ),
                error_kind: None,
                retryable: None,
                text: None,
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                latency_ms: None,
            }),
        )),
        Err(AppError::Io(message)) => Ok((
            profile_id_for_message,
            PreparedAiProfileTest::Immediate(AiProfileTestResult {
                success: false,
                status: AiProfileTestStatus::KeychainUnavailable,
                message,
                error_kind: Some(AiProfileTestErrorKind::ProviderUnavailable),
                retryable: Some(true),
                text: None,
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                latency_ms: None,
            }),
        )),
        Err(error) => Err(error),
    }
}

async fn complete_ai_profile_test(
    orchestrator: &AiOrchestrator,
    profile_id: &str,
    prepared: PreparedAiProfileTest,
) -> Result<AiProfileTestResult, AppError> {
    match prepared {
        PreparedAiProfileTest::Immediate(result) => Ok(result),
        PreparedAiProfileTest::Ready { profile, api_key } => match orchestrator
            .test_profile(&profile, &api_key)
            .await
        {
            Ok(response) => Ok(AiProfileTestResult {
                success: true,
                status: AiProfileTestStatus::Ok,
                message: format!("AI profile {} healthcheck succeeded.", profile_id),
                error_kind: None,
                retryable: None,
                text: Some(response.text),
                input_tokens: response.input_tokens,
                output_tokens: response.output_tokens,
                total_tokens: response.total_tokens,
                latency_ms: response.latency_ms,
            }),
            Err(error) => {
                let (error_kind, retryable) = classify_failed_profile_test(&error);
                Ok(AiProfileTestResult {
                    success: false,
                    status: AiProfileTestStatus::Failed,
                    message: error.to_string(),
                    error_kind: Some(error_kind),
                    retryable: Some(retryable),
                    text: None,
                    input_tokens: None,
                    output_tokens: None,
                    total_tokens: None,
                    latency_ms: None,
                })
            }
        },
    }
}

#[tauri::command]
pub async fn get_ai_settings(state: State<'_, AppState>) -> Result<AiSettings, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    get_ai_settings_from_conn(conn)
}

#[tauri::command]
pub async fn upsert_ai_profile(
    state: State<'_, AppState>,
    input: AiProfileInput,
) -> Result<AiProfile, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    upsert_ai_profile_in_conn(conn, input)
}

#[tauri::command]
pub async fn save_ai_settings(
    state: State<'_, AppState>,
    enabled: bool,
    default_profile_id: Option<String>,
) -> Result<AiSettings, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    save_ai_settings_in_conn(conn, enabled, default_profile_id)
}

#[tauri::command]
pub async fn set_ai_profile_secret(
    state: State<'_, AppState>,
    profile_id: String,
    api_key: String,
) -> Result<(), AppError> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let secret_store = SystemSecretStore;
    let secret_key = build_secret_store_key(root, &normalize_profile_id(&profile_id)?);
    set_ai_profile_secret_in_conn(conn, &secret_store, &secret_key, &profile_id, &api_key)
}

#[tauri::command]
pub async fn has_ai_profile_secret(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<bool, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    let secret_store = SystemSecretStore;

    has_ai_profile_secret_in_conn(conn, &secret_store, &root, &profile_id)
}

#[tauri::command]
pub async fn test_ai_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<AiProfileTestResult, AppError> {
    let normalized_profile_id = normalize_profile_id(&profile_id)?;
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };
    let secret_store = SystemSecretStore;
    let prepared = {
        let db_guard = state.db_guard();
        let conn = db_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
        prepare_ai_profile_test_in_conn(conn, &secret_store, &root, &normalized_profile_id)?
    };
    let orchestrator = AiOrchestrator::default();
    complete_ai_profile_test(&orchestrator, &normalized_profile_id, prepared).await
}

#[tauri::command]
pub async fn test_ai_profile_input(
    state: State<'_, AppState>,
    input: AiProfileInput,
    api_key: Option<String>,
) -> Result<AiProfileTestResult, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let prepared = {
        let db_guard = state.db_guard();
        let conn = db_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
        let secret_store = SystemSecretStore;
        prepare_ai_profile_input_test_in_conn(conn, &secret_store, &root, input, api_key)?
    };

    let orchestrator = AiOrchestrator::default();
    complete_ai_profile_test(&orchestrator, &prepared.0, prepared.1).await
}

#[cfg(test)]
mod tests {
    use super::{
        build_secret_store_key, complete_ai_profile_test, get_ai_settings_from_conn,
        has_ai_profile_secret_in_conn,
        prepare_ai_profile_input_test_in_conn, prepare_ai_profile_test_in_conn,
        PreparedAiProfileTest,
        set_ai_profile_secret_in_conn,
    };
    use crate::error::AppError;
    use crate::domain::ai::{
        AiProfile, AiProfileInput, AiProfileTestErrorKind, AiProfileTestStatus, AiProviderKind,
    };
    use crate::infrastructure::db::open_and_migrate;
    use crate::services::ai::{
        load_profile_secret,
        reset_profile_secret_cache_for_tests,
        save_ai_settings as save_ai_settings_in_conn,
        upsert_ai_profile as upsert_ai_profile_in_conn,
        AiOrchestrator,
        AiSecretStore,
    };
    use mockito::{Matcher, Server};
    use rusqlite::params;
    use sha2::{Digest, Sha256};
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::Mutex;
    use tempfile::tempdir;

    fn legacy_secret_key(kb_root: &Path, profile_id: &str) -> String {
        let canonical_root = kb_root
            .canonicalize()
            .unwrap_or_else(|_| kb_root.to_path_buf());
        let mut hasher = Sha256::new();
        hasher.update(canonical_root.to_string_lossy().as_bytes());
        let namespace = hex::encode(hasher.finalize());
        format!("{}:{}", &namespace[..16], profile_id)
    }

    #[derive(Default)]
    struct MemorySecretStore {
        values: Mutex<HashMap<String, String>>,
    }

    #[derive(Default)]
    struct WriteOnlySecretStore;

    impl AiSecretStore for MemorySecretStore {
        fn set_profile_secret(&self, profile_id: &str, api_key: &str) -> Result<(), AppError> {
            self.values
                .lock()
                .unwrap()
                .insert(profile_id.to_string(), api_key.to_string());
            Ok(())
        }

        fn get_profile_secret(&self, profile_id: &str) -> Result<String, AppError> {
            self.values
                .lock()
                .unwrap()
                .get(profile_id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("AI profile secret not found: {profile_id}")))
        }

        fn delete_profile_secret(&self, profile_id: &str) -> Result<(), AppError> {
            self.values.lock().unwrap().remove(profile_id);
            Ok(())
        }
    }

    impl AiSecretStore for WriteOnlySecretStore {
        fn set_profile_secret(&self, _profile_id: &str, _api_key: &str) -> Result<(), AppError> {
            Ok(())
        }

        fn get_profile_secret(&self, _profile_id: &str) -> Result<String, AppError> {
            Err(AppError::NotFound("AI profile secret not found".into()))
        }

        fn delete_profile_secret(&self, _profile_id: &str) -> Result<(), AppError> {
            Ok(())
        }
    }

    struct FailingSecretStore;

    impl AiSecretStore for FailingSecretStore {
        fn set_profile_secret(&self, _profile_id: &str, _api_key: &str) -> Result<(), AppError> {
            Err(AppError::Io("System keychain operation failed: locked".into()))
        }

        fn get_profile_secret(&self, _profile_id: &str) -> Result<String, AppError> {
            Err(AppError::Io("System keychain operation failed: locked".into()))
        }

        fn delete_profile_secret(&self, _profile_id: &str) -> Result<(), AppError> {
            Err(AppError::Io("System keychain operation failed: locked".into()))
        }
    }

    fn insert_profile(conn: &rusqlite::Connection, profile_id: &str, provider: AiProviderKind) {
	    reset_profile_secret_cache_for_tests();
        upsert_ai_profile_in_conn(
            conn,
            AiProfileInput {
                id: Some(profile_id.into()),
                name: format!("{profile_id} name"),
                provider,
                model: "demo-model".into(),
                base_url: None,
                max_tokens: None,
                temperature: None,
                enabled: true,
            },
        )
        .unwrap();
    }

    #[test]
    fn get_ai_settings_reads_profiles_from_database() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai", "enabled", "true"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai_profile:test-profile", "name", "OpenAI Prod"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai_profile:test-profile", "provider", "open_ai_compatible"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai_profile:test-profile", "model", "gpt-4.1-mini"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (scope, key, value, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
            params!["ai_profile:test-profile", "enabled", "true"],
        )
        .unwrap();

        let settings = get_ai_settings_from_conn(&conn).unwrap();

        assert!(settings.enabled);
        assert_eq!(settings.profiles.len(), 1);
        assert_eq!(settings.profiles[0].id, "test-profile");
        assert_eq!(settings.profiles[0].model, "gpt-4.1-mini");
    }

    #[test]
    fn save_ai_settings_updates_global_flags_in_database() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        insert_profile(&conn, "profile-1", AiProviderKind::Anthropic);

        let settings = save_ai_settings_in_conn(&conn, true, Some("profile-1".into())).unwrap();

        assert!(settings.enabled);
        assert_eq!(settings.default_profile_id.as_deref(), Some("profile-1"));
    }

    #[test]
    fn setting_profile_secret_does_not_persist_plaintext_in_settings_table() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        insert_profile(&conn, "profile-1", AiProviderKind::OpenAiCompatible);
        let secret_key = build_secret_store_key(Path::new("/tmp/kb-a"), "profile-1");

        set_ai_profile_secret_in_conn(
            &conn,
            &secret_store,
            &secret_key,
            "profile-1",
            "sk-test-plaintext",
        )
        .unwrap();

        let stored_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE value = ?1 OR key = 'api_key'",
                ["sk-test-plaintext"],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(stored_count, 0);
    }

    #[test]
    fn set_ai_profile_secret_rejects_blank_profile_id() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let secret_key = build_secret_store_key(Path::new("/tmp/kb-a"), "profile-1");

        let error = set_ai_profile_secret_in_conn(&conn, &secret_store, &secret_key, "   ", "sk-demo")
            .unwrap_err();

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn set_ai_profile_secret_fails_when_secret_cannot_be_read_back() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = WriteOnlySecretStore;
        insert_profile(&conn, "profile-1", AiProviderKind::OpenAiCompatible);
        let secret_key = build_secret_store_key(Path::new("/tmp/kb-a"), "profile-1");

        let error = set_ai_profile_secret_in_conn(
            &conn,
            &secret_store,
            &secret_key,
            "profile-1",
            "sk-demo",
        )
        .unwrap_err();

        assert!(matches!(error, AppError::Io(_)));
        assert!(error.to_string().contains("Failed to verify saved AI profile secret"));
    }

    #[test]
    fn set_ai_profile_secret_primes_session_cache_for_later_reads() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let kb_root = Path::new("/tmp/kb-cache-prime");
        let secret_key = build_secret_store_key(kb_root, "profile-cache-prime");

        insert_profile(&conn, "profile-cache-prime", AiProviderKind::OpenAiCompatible);
        set_ai_profile_secret_in_conn(
            &conn,
            &secret_store,
            &secret_key,
            "profile-cache-prime",
            "sk-cached-after-save",
        )
        .unwrap();

        let cached_secret = load_profile_secret(&FailingSecretStore, kb_root, "profile-cache-prime").unwrap();

        assert_eq!(cached_secret, "sk-cached-after-save");
    }

    #[test]
    fn has_ai_profile_secret_reports_false_when_secret_is_missing() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let profile_id = "profile-missing-secret";
        let kb_root = Path::new("/tmp/kb-missing-secret");
        insert_profile(&conn, profile_id, AiProviderKind::Anthropic);

        let has_secret = has_ai_profile_secret_in_conn(
            &conn,
            &secret_store,
            kb_root,
            profile_id,
        )
        .unwrap();

        assert!(!has_secret);
    }

    #[tokio::test]
    async fn test_ai_profile_returns_readable_result_when_secret_missing() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let orchestrator = AiOrchestrator::default();
        let profile_id = "profile-readable-missing-secret";
        let kb_root = Path::new("/tmp/kb-readable-missing-secret");
        insert_profile(&conn, profile_id, AiProviderKind::OpenAiCompatible);
        let prepared = prepare_ai_profile_test_in_conn(
            &conn,
            &secret_store,
            kb_root,
            profile_id,
        )
        .unwrap();
        let result = complete_ai_profile_test(&orchestrator, profile_id, prepared)
            .await
            .unwrap();

        assert!(!result.success);
        assert_eq!(result.status, AiProfileTestStatus::MissingSecret);
        assert_eq!(result.error_kind, None);
        assert!(result.message.contains("API key"));
    }

    #[tokio::test]
    async fn test_ai_profile_returns_keychain_unavailable_when_secret_store_fails() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = FailingSecretStore;
        let orchestrator = AiOrchestrator::default();
        let profile_id = "profile-keychain-unavailable";
        let kb_root = Path::new("/tmp/kb-keychain-unavailable");
        insert_profile(&conn, profile_id, AiProviderKind::Anthropic);
        let prepared = prepare_ai_profile_test_in_conn(
            &conn,
            &secret_store,
            kb_root,
            profile_id,
        )
        .unwrap();
        let result = complete_ai_profile_test(&orchestrator, profile_id, prepared)
            .await
            .unwrap();

        assert!(!result.success);
        assert_eq!(result.status, AiProfileTestStatus::KeychainUnavailable);
        assert_eq!(result.error_kind, Some(AiProfileTestErrorKind::ProviderUnavailable));
        assert_eq!(result.retryable, Some(true));
        assert!(result.message.contains("keychain"));
    }

    #[test]
    fn input_profile_test_requires_api_key_for_new_profile() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();

        let (_, prepared) = prepare_ai_profile_input_test_in_conn(
            &conn,
            &secret_store,
            Path::new("/tmp/kb-a"),
            AiProfileInput {
                id: None,
                name: "Draft Profile".into(),
                provider: AiProviderKind::Anthropic,
                model: "claude-3-5-haiku-latest".into(),
                base_url: None,
                max_tokens: Some(32),
                temperature: Some(0.0),
                enabled: true,
            },
            None,
        )
        .unwrap();

        match prepared {
            PreparedAiProfileTest::Immediate(result) => {
                assert_eq!(result.status, AiProfileTestStatus::MissingSecret);
                assert!(result.message.contains("API Key"));
            }
            PreparedAiProfileTest::Ready { .. } => panic!("expected immediate missing secret"),
        }
    }

    #[test]
    fn input_profile_test_uses_keychain_when_existing_profile_has_no_inline_key() {
        reset_profile_secret_cache_for_tests();
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let profile_id = "profile-input-keychain";
        let kb_root = Path::new("/tmp/kb-input-keychain");
        insert_profile(&conn, profile_id, AiProviderKind::Anthropic);
        let secret_key = build_secret_store_key(kb_root, profile_id);
        secret_store
            .set_profile_secret(&secret_key, "sk-from-keychain")
            .unwrap();

        let (_, prepared) = prepare_ai_profile_input_test_in_conn(
            &conn,
            &secret_store,
            kb_root,
            AiProfileInput {
                id: Some(profile_id.into()),
                name: "Edited Profile".into(),
                provider: AiProviderKind::Anthropic,
                model: "claude-3-5-haiku-latest".into(),
                base_url: Some("https://api.anthropic.com".into()),
                max_tokens: Some(64),
                temperature: Some(0.1),
                enabled: true,
            },
            None,
        )
        .unwrap();

        match prepared {
            PreparedAiProfileTest::Ready { profile, api_key } => {
                assert_eq!(profile.id, profile_id);
                assert_eq!(profile.name, "Edited Profile");
                assert_eq!(api_key, "sk-from-keychain");
            }
            PreparedAiProfileTest::Immediate(_) => panic!("expected ready profile test"),
        }
    }

    #[test]
    fn input_profile_test_reads_legacy_keychain_entry_when_stable_key_is_missing() {
        reset_profile_secret_cache_for_tests();
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let kb_root = Path::new("/tmp/kb-a");
        insert_profile(&conn, "profile-1", AiProviderKind::Anthropic);
        let legacy_key = legacy_secret_key(kb_root, "profile-1");
        secret_store
            .set_profile_secret(&legacy_key, "sk-from-legacy-keychain")
            .unwrap();

        let (_, prepared) = prepare_ai_profile_input_test_in_conn(
            &conn,
            &secret_store,
            kb_root,
            AiProfileInput {
                id: Some("profile-1".into()),
                name: "Edited Profile".into(),
                provider: AiProviderKind::Anthropic,
                model: "claude-3-5-haiku-latest".into(),
                base_url: Some("https://api.anthropic.com".into()),
                max_tokens: Some(64),
                temperature: Some(0.1),
                enabled: true,
            },
            None,
        )
        .unwrap();

        match prepared {
            PreparedAiProfileTest::Ready { api_key, .. } => {
                assert_eq!(api_key, "sk-from-legacy-keychain");
            }
            PreparedAiProfileTest::Immediate(_) => panic!("expected ready profile test"),
        }
    }

    #[test]
    fn secret_key_is_stable_for_same_profile_across_knowledge_base_roots() {
        let key_a = build_secret_store_key(Path::new("/tmp/kb-a"), "profile-1");
        let key_b = build_secret_store_key(Path::new("/tmp/kb-b"), "profile-1");

        assert_eq!(key_a, key_b);
    }

    #[test]
    fn secret_key_uses_canonical_knowledge_base_root() {
        let temp = tempdir().unwrap();
        let canonical = temp.path().canonicalize().unwrap();
        let alias = temp.path().join(".");

        let canonical_key = build_secret_store_key(&canonical, "profile-1");
        let alias_key = build_secret_store_key(&alias, "profile-1");

        assert_eq!(canonical_key, alias_key);
    }

    #[tokio::test]
    async fn orchestrator_returns_text_from_openai_compatible_response() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/chat/completions")
            .match_header("authorization", "Bearer sk-openai-test")
            .match_body(Matcher::PartialJson(serde_json::json!({
                "model": "gpt-4.1-mini"
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "choices": [
                        {
                            "message": {
                                "content": "MYNOTE_HEALTHCHECK_OK"
                            }
                        }
                    ],
                    "usage": {
                        "prompt_tokens": 7,
                        "completion_tokens": 5,
                        "total_tokens": 12
                    }
                })
                .to_string(),
            )
            .create_async()
            .await;

        let profile = AiProfile {
            id: "profile-1".into(),
            name: "OpenAI Test".into(),
            provider: AiProviderKind::OpenAiCompatible,
            model: "gpt-4.1-mini".into(),
            base_url: Some(server.url()),
            max_tokens: Some(16),
            temperature: Some(0.0),
            enabled: true,
        };

        let orchestrator = AiOrchestrator::default();
        let response = orchestrator
            .test_profile(&profile, "sk-openai-test")
            .await
            .unwrap();

        mock.assert();
        assert_eq!(response.text, "MYNOTE_HEALTHCHECK_OK");
        assert_eq!(response.input_tokens, Some(7));
        assert_eq!(response.output_tokens, Some(5));
        assert_eq!(response.total_tokens, Some(12));
        assert!(response.latency_ms.is_some_and(|latency| latency < 30_000));
    }

    #[tokio::test]
    async fn test_ai_profile_returns_success_when_provider_healthcheck_passes() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let orchestrator = AiOrchestrator::default();
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/chat/completions")
            .match_header("authorization", "Bearer sk-demo")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "choices": [
                        {
                            "message": {
                                "content": "MYNOTE_HEALTHCHECK_OK"
                            }
                        }
                    ],
                    "usage": {
                        "prompt_tokens": 3,
                        "completion_tokens": 4,
                        "total_tokens": 7
                    }
                })
                .to_string(),
            )
            .create_async()
            .await;
        upsert_ai_profile_in_conn(
            &conn,
            AiProfileInput {
                id: Some("profile-1".into()),
                name: "OpenAI Healthcheck".into(),
                provider: AiProviderKind::OpenAiCompatible,
                model: "gpt-4.1-mini".into(),
                base_url: Some(server.url()),
                max_tokens: Some(16),
                temperature: Some(0.0),
                enabled: true,
            },
        )
        .unwrap();
        let secret_key = build_secret_store_key(Path::new("/tmp/kb-a"), "profile-1");
        set_ai_profile_secret_in_conn(&conn, &secret_store, &secret_key, "profile-1", "sk-demo")
            .unwrap();

        let prepared = prepare_ai_profile_test_in_conn(
            &conn,
            &secret_store,
            Path::new("/tmp/kb-a"),
            "profile-1",
        )
        .unwrap();
        let result = complete_ai_profile_test(&orchestrator, "profile-1", prepared)
            .await
            .unwrap();

        mock.assert();
        assert!(result.success);
        assert_eq!(result.status, AiProfileTestStatus::Ok);
        assert_eq!(result.error_kind, None);
        assert_eq!(result.retryable, None);
        assert_eq!(result.text.as_deref(), Some("MYNOTE_HEALTHCHECK_OK"));
        assert_eq!(result.total_tokens, Some(7));
    }

    #[tokio::test]
    async fn test_ai_profile_marks_retryable_provider_failures() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let orchestrator = AiOrchestrator::default();
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/chat/completions")
            .with_status(429)
            .with_header("content-type", "application/json")
            .with_body("rate limited")
            .create_async()
            .await;

        upsert_ai_profile_in_conn(
            &conn,
            AiProfileInput {
                id: Some("profile-1".into()),
                name: "OpenAI Rate Limited".into(),
                provider: AiProviderKind::OpenAiCompatible,
                model: "gpt-4.1-mini".into(),
                base_url: Some(server.url()),
                max_tokens: Some(16),
                temperature: Some(0.0),
                enabled: true,
            },
        )
        .unwrap();
        let secret_key = build_secret_store_key(Path::new("/tmp/kb-a"), "profile-1");
        set_ai_profile_secret_in_conn(&conn, &secret_store, &secret_key, "profile-1", "sk-demo")
            .unwrap();

        let prepared = prepare_ai_profile_test_in_conn(
            &conn,
            &secret_store,
            Path::new("/tmp/kb-a"),
            "profile-1",
        )
        .unwrap();
        let result = complete_ai_profile_test(&orchestrator, "profile-1", prepared)
            .await
            .unwrap();

        mock.assert();
        assert!(!result.success);
        assert_eq!(result.status, AiProfileTestStatus::Failed);
        assert_eq!(result.error_kind, Some(AiProfileTestErrorKind::ProviderUnavailable));
        assert_eq!(result.retryable, Some(true));
    }

    #[tokio::test]
    async fn test_ai_profile_marks_invalid_configuration_failures_as_non_retryable() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        let secret_store = MemorySecretStore::default();
        let orchestrator = AiOrchestrator::default();
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/chat/completions")
            .with_status(401)
            .with_header("content-type", "application/json")
            .with_body("bad api key")
            .create_async()
            .await;

        upsert_ai_profile_in_conn(
            &conn,
            AiProfileInput {
                id: Some("profile-1".into()),
                name: "OpenAI Unauthorized".into(),
                provider: AiProviderKind::OpenAiCompatible,
                model: "gpt-4.1-mini".into(),
                base_url: Some(server.url()),
                max_tokens: Some(16),
                temperature: Some(0.0),
                enabled: true,
            },
        )
        .unwrap();
        let secret_key = build_secret_store_key(Path::new("/tmp/kb-a"), "profile-1");
        set_ai_profile_secret_in_conn(&conn, &secret_store, &secret_key, "profile-1", "sk-demo")
            .unwrap();

        let prepared = prepare_ai_profile_test_in_conn(
            &conn,
            &secret_store,
            Path::new("/tmp/kb-a"),
            "profile-1",
        )
        .unwrap();
        let result = complete_ai_profile_test(&orchestrator, "profile-1", prepared)
            .await
            .unwrap();

        mock.assert();
        assert!(!result.success);
        assert_eq!(result.status, AiProfileTestStatus::Failed);
        assert_eq!(result.error_kind, Some(AiProfileTestErrorKind::InvalidConfiguration));
        assert_eq!(result.retryable, Some(false));
    }

    #[tokio::test]
    async fn orchestrator_returns_text_from_anthropic_response() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/messages")
            .match_header("x-api-key", "sk-anthropic-test")
            .match_header("anthropic-version", "2023-06-01")
            .match_body(Matcher::PartialJson(serde_json::json!({
                "model": "claude-3-5-haiku-latest"
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "content": [
                        {
                            "type": "text",
                            "text": "MYNOTE_HEALTHCHECK_OK"
                        }
                    ],
                    "usage": {
                        "input_tokens": 9,
                        "output_tokens": 4
                    }
                })
                .to_string(),
            )
            .create_async()
            .await;

        let profile = AiProfile {
            id: "profile-2".into(),
            name: "Anthropic Test".into(),
            provider: AiProviderKind::Anthropic,
            model: "claude-3-5-haiku-latest".into(),
            base_url: Some(server.url()),
            max_tokens: Some(16),
            temperature: Some(0.0),
            enabled: true,
        };

        let orchestrator = AiOrchestrator::default();
        let response = orchestrator
            .test_profile(&profile, "sk-anthropic-test")
            .await
            .unwrap();

        mock.assert();
        assert_eq!(response.text, "MYNOTE_HEALTHCHECK_OK");
        assert_eq!(response.input_tokens, Some(9));
        assert_eq!(response.output_tokens, Some(4));
        assert_eq!(response.total_tokens, Some(13));
        assert!(response.latency_ms.is_some_and(|latency| latency < 30_000));
    }
}

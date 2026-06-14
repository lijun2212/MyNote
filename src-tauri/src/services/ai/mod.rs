pub mod orchestrator;
pub mod provider;
pub mod providers;
pub mod secret_store;
pub mod settings;

use crate::domain::ai::{AiProfile, AiSettings};
use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

pub use orchestrator::AiOrchestrator;
pub use secret_store::{AiSecretStore, SystemSecretStore};
pub use settings::{load_ai_profile, load_ai_settings, save_ai_settings, upsert_ai_profile};

static PROFILE_SECRET_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn profile_secret_cache() -> &'static Mutex<HashMap<String, String>> {
	PROFILE_SECRET_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_cached_profile_secret(profile_id: &str) -> Option<String> {
	profile_secret_cache()
		.lock()
		.unwrap()
		.get(profile_id)
		.cloned()
}

pub fn cache_profile_secret(profile_id: &str, api_key: &str) {
	profile_secret_cache()
		.lock()
		.unwrap()
		.insert(profile_id.to_string(), api_key.to_string());
}

pub fn invalidate_profile_secret_cache(profile_id: &str) {
	profile_secret_cache().lock().unwrap().remove(profile_id);
}

#[cfg(test)]
pub fn reset_profile_secret_cache_for_tests() {
	profile_secret_cache().lock().unwrap().clear();
}

pub fn normalize_profile_id(profile_id: &str) -> AppResult<String> {
	let trimmed = profile_id.trim();
	if trimmed.is_empty() {
		Err(AppError::InvalidInput("AI 配置 ID 不能为空".into()))
	} else {
		Ok(trimmed.to_string())
	}
}

pub fn build_secret_store_key(kb_root: &Path, profile_id: &str) -> String {
	let _ = kb_root;
	profile_id.to_string()
}

fn build_legacy_secret_store_key(kb_root: &Path, profile_id: &str) -> String {
	let canonical_root = kb_root
		.canonicalize()
		.unwrap_or_else(|_| kb_root.to_path_buf());
	let mut hasher = Sha256::new();
	hasher.update(canonical_root.to_string_lossy().as_bytes());
	let namespace = hex::encode(hasher.finalize());
	format!("{}:{}", &namespace[..16], profile_id)
}

pub fn load_profile_secret(
	secret_store: &dyn AiSecretStore,
	kb_root: &Path,
	profile_id: &str,
) -> AppResult<String> {
	let current_key = build_secret_store_key(kb_root, profile_id);
	if let Some(api_key) = get_cached_profile_secret(&current_key) {
		return Ok(api_key);
	}

	match secret_store.get_profile_secret(&current_key) {
		Ok(api_key) => {
			cache_profile_secret(&current_key, &api_key);
			Ok(api_key)
		}
		Err(AppError::NotFound(_)) => {
			let legacy_key = build_legacy_secret_store_key(kb_root, profile_id);
			if legacy_key == current_key {
				return Err(AppError::NotFound("系统密钥链中未找到 AI 配置密钥".into()));
			}

			let api_key = secret_store.get_profile_secret(&legacy_key)?;
			cache_profile_secret(&current_key, &api_key);
			if secret_store.set_profile_secret(&current_key, &api_key).is_ok() {
				let _ = secret_store.delete_profile_secret(&legacy_key);
			}
			Ok(api_key)
		}
		Err(error) => Err(error),
	}
}

pub fn resolve_ai_profile_selection(
	conn: &Connection,
	explicit_profile_id: Option<&str>,
) -> AppResult<Option<String>> {
	if let Some(profile_id) = explicit_profile_id {
		return normalize_profile_id(profile_id).map(Some);
	}

	let settings: AiSettings = load_ai_settings(conn)?;
	if !settings.enabled {
		return Ok(None);
	}

	Ok(settings.default_profile_id)
}

pub fn load_ai_profile_with_secret(
	conn: &Connection,
	secret_store: &dyn AiSecretStore,
	kb_root: &Path,
	profile_id: &str,
) -> AppResult<(AiProfile, String)> {
	let normalized_profile_id = normalize_profile_id(profile_id)?;
	let profile = load_ai_profile(conn, &normalized_profile_id)?;
	let api_key = load_profile_secret(secret_store, kb_root, &normalized_profile_id)?;
	Ok((profile, api_key))
}

#[cfg(test)]
mod tests {
	use super::{build_legacy_secret_store_key, load_profile_secret};
	use crate::error::AppError;
	use crate::services::ai::AiSecretStore;
	use std::collections::HashMap;
	use std::path::Path;
	use std::sync::Mutex;

	#[derive(Default)]
	struct CountingSecretStore {
		values: Mutex<HashMap<String, String>>,
		get_calls: Mutex<Vec<String>>,
		fail_set: bool,
	}

	impl CountingSecretStore {
		fn with_secret(key: String, value: &str) -> Self {
			let mut values = HashMap::new();
			values.insert(key, value.to_string());
			Self {
				values: Mutex::new(values),
				get_calls: Mutex::new(Vec::new()),
				fail_set: false,
			}
		}

		fn with_secret_and_failed_set(key: String, value: &str) -> Self {
			let mut store = Self::with_secret(key, value);
			store.fail_set = true;
			store
		}

		fn get_call_count(&self) -> usize {
			self.get_calls.lock().unwrap().len()
		}
	}

	impl AiSecretStore for CountingSecretStore {
		fn set_profile_secret(&self, profile_id: &str, api_key: &str) -> Result<(), AppError> {
			if self.fail_set {
				return Err(AppError::Io("simulated keychain write failure".into()));
			}

			self.values
				.lock()
				.unwrap()
				.insert(profile_id.to_string(), api_key.to_string());
			Ok(())
		}

		fn get_profile_secret(&self, profile_id: &str) -> Result<String, AppError> {
			self.get_calls.lock().unwrap().push(profile_id.to_string());
			self.values
				.lock()
				.unwrap()
				.get(profile_id)
				.cloned()
				.ok_or_else(|| AppError::NotFound(format!("missing secret: {profile_id}")))
		}

		fn delete_profile_secret(&self, profile_id: &str) -> Result<(), AppError> {
			self.values.lock().unwrap().remove(profile_id);
			Ok(())
		}
	}

	#[test]
	fn load_profile_secret_reuses_secret_without_reaccessing_store() {
		let kb_root = Path::new("/tmp/mynote-secret-cache-current");
		let profile_id = "profile-current";
		let store = CountingSecretStore::with_secret(profile_id.to_string(), "sk-current");

		assert_eq!(load_profile_secret(&store, kb_root, profile_id).unwrap(), "sk-current");
		assert_eq!(load_profile_secret(&store, kb_root, profile_id).unwrap(), "sk-current");
		assert_eq!(store.get_call_count(), 1);
	}

	#[test]
	fn load_profile_secret_reuses_legacy_secret_when_migration_write_fails() {
		let kb_root = Path::new("/tmp/mynote-secret-cache-legacy");
		let profile_id = "profile-legacy";
		let legacy_key = build_legacy_secret_store_key(kb_root, profile_id);
		let store = CountingSecretStore::with_secret_and_failed_set(legacy_key, "sk-legacy");

		assert_eq!(load_profile_secret(&store, kb_root, profile_id).unwrap(), "sk-legacy");
		assert_eq!(load_profile_secret(&store, kb_root, profile_id).unwrap(), "sk-legacy");
		assert_eq!(store.get_call_count(), 2);
	}
}

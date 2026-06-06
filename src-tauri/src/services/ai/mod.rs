pub mod orchestrator;
pub mod provider;
pub mod providers;
pub mod secret_store;
pub mod settings;

use crate::domain::ai::{AiProfile, AiSettings};
use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::path::Path;

pub use orchestrator::AiOrchestrator;
pub use secret_store::{AiSecretStore, SystemSecretStore};
pub use settings::{load_ai_profile, load_ai_settings, save_ai_settings, upsert_ai_profile};

pub fn normalize_profile_id(profile_id: &str) -> AppResult<String> {
	let trimmed = profile_id.trim();
	if trimmed.is_empty() {
		Err(AppError::InvalidInput("AI profile id cannot be blank".into()))
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
	match secret_store.get_profile_secret(&current_key) {
		Ok(api_key) => Ok(api_key),
		Err(AppError::NotFound(_)) => {
			let legacy_key = build_legacy_secret_store_key(kb_root, profile_id);
			if legacy_key == current_key {
				return Err(AppError::NotFound("AI profile secret not found".into()));
			}

			let api_key = secret_store.get_profile_secret(&legacy_key)?;
			let _ = secret_store.set_profile_secret(&current_key, &api_key);
			let _ = secret_store.delete_profile_secret(&legacy_key);
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

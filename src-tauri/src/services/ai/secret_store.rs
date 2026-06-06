use crate::error::{AppError, AppResult};
use keyring::Entry;

const AI_SECRET_SERVICE: &str = "mynote.ai.profile";

pub trait AiSecretStore: Send + Sync {
    fn set_profile_secret(&self, profile_id: &str, api_key: &str) -> AppResult<()>;
    fn get_profile_secret(&self, profile_id: &str) -> AppResult<String>;
    fn delete_profile_secret(&self, profile_id: &str) -> AppResult<()>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemSecretStore;

impl SystemSecretStore {
    fn entry_for(profile_id: &str) -> AppResult<Entry> {
        Entry::new(AI_SECRET_SERVICE, profile_id)
            .map_err(|error| AppError::Io(format!("Failed to access system keychain: {error}")))
    }
}

impl AiSecretStore for SystemSecretStore {
    fn set_profile_secret(&self, profile_id: &str, api_key: &str) -> AppResult<()> {
        Self::entry_for(profile_id)?
            .set_password(api_key)
            .map_err(map_keyring_error)
    }

    fn get_profile_secret(&self, profile_id: &str) -> AppResult<String> {
        Self::entry_for(profile_id)?
            .get_password()
            .map_err(map_keyring_error)
    }

    fn delete_profile_secret(&self, profile_id: &str) -> AppResult<()> {
        Self::entry_for(profile_id)?
            .delete_credential()
            .map_err(map_keyring_error)
    }
}

fn map_keyring_error(error: keyring::Error) -> AppError {
    match error {
        keyring::Error::NoEntry => AppError::NotFound("AI profile secret not found".into()),
        other => AppError::Io(format!("System keychain operation failed: {other}")),
    }
}

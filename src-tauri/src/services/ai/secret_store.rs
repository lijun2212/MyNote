use crate::error::{AppError, AppResult};
#[cfg(not(windows))]
use keyring::Entry;

#[cfg(windows)]
use std::iter::once;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND, FILETIME};

#[cfg(windows)]
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
    CRED_TYPE_GENERIC,
};

const AI_SECRET_SERVICE: &str = "mynote.ai.profile";

pub trait AiSecretStore: Send + Sync {
    fn set_profile_secret(&self, profile_id: &str, api_key: &str) -> AppResult<()>;
    fn get_profile_secret(&self, profile_id: &str) -> AppResult<String>;
    fn delete_profile_secret(&self, profile_id: &str) -> AppResult<()>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemSecretStore;

impl SystemSecretStore {
    #[cfg(not(windows))]
    fn entry_for(profile_id: &str) -> AppResult<Entry> {
        Entry::new(AI_SECRET_SERVICE, profile_id)
            .map_err(|error| AppError::Io(format!("访问系统密钥链失败：{error}")))
    }
}

impl AiSecretStore for SystemSecretStore {
    fn set_profile_secret(&self, profile_id: &str, api_key: &str) -> AppResult<()> {
        #[cfg(windows)]
        {
            return set_windows_profile_secret(profile_id, api_key);
        }

        #[cfg(not(windows))]
        Self::entry_for(profile_id)?
            .set_password(api_key)
            .map_err(map_keyring_error)
    }

    fn get_profile_secret(&self, profile_id: &str) -> AppResult<String> {
        #[cfg(windows)]
        {
            return get_windows_profile_secret(profile_id);
        }

        #[cfg(not(windows))]
        Self::entry_for(profile_id)?
            .get_password()
            .map_err(map_keyring_error)
    }

    fn delete_profile_secret(&self, profile_id: &str) -> AppResult<()> {
        #[cfg(windows)]
        {
            return delete_windows_profile_secret(profile_id);
        }

        #[cfg(not(windows))]
        Self::entry_for(profile_id)?
            .delete_credential()
            .map_err(map_keyring_error)
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn build_windows_secret_target_name(profile_id: &str) -> String {
    format!("{AI_SECRET_SERVICE}:{profile_id}")
}

#[cfg_attr(not(windows), allow(dead_code))]
fn build_windows_legacy_target_name(profile_id: &str) -> String {
    format!("{profile_id}.{AI_SECRET_SERVICE}")
}

#[cfg(windows)]
fn set_windows_profile_secret(profile_id: &str, api_key: &str) -> AppResult<()> {
    write_windows_generic_credential(
        &build_windows_secret_target_name(profile_id),
        profile_id,
        api_key.as_bytes(),
    )
}

#[cfg(windows)]
fn get_windows_profile_secret(profile_id: &str) -> AppResult<String> {
    let current_target = build_windows_secret_target_name(profile_id);
    match read_windows_generic_credential_utf8(&current_target) {
        Ok(api_key) => Ok(api_key),
        Err(AppError::NotFound(_)) => {
            let legacy_target = build_windows_legacy_target_name(profile_id);
            let api_key = read_windows_generic_credential_utf16(&legacy_target)?;
            let _ = write_windows_generic_credential(&current_target, profile_id, api_key.as_bytes());
            let _ = delete_windows_generic_credential(&legacy_target);
            Ok(api_key)
        }
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn delete_windows_profile_secret(profile_id: &str) -> AppResult<()> {
    let current_result = delete_windows_generic_credential(&build_windows_secret_target_name(profile_id));
    let legacy_result = delete_windows_generic_credential(&build_windows_legacy_target_name(profile_id));

    match (current_result, legacy_result) {
        (Ok(()), Ok(()))
        | (Ok(()), Err(AppError::NotFound(_)))
        | (Err(AppError::NotFound(_)), Ok(())) => Ok(()),
        (Err(AppError::NotFound(_)), Err(AppError::NotFound(_))) => {
            Err(AppError::NotFound("系统密钥链中未找到 AI 配置密钥".into()))
        }
        (Err(error), _) => Err(error),
        (_, Err(error)) => Err(error),
    }
}

#[cfg(windows)]
fn write_windows_generic_credential(
    target_name: &str,
    user_name: &str,
    secret: &[u8],
) -> AppResult<()> {
    let mut target_name_wide = to_wide_string(target_name);
    let mut comment_wide = to_wide_string(AI_SECRET_SERVICE);
    let mut user_name_wide = to_wide_string(user_name);
    let mut blob = secret.to_vec();
    let credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target_name_wide.as_mut_ptr(),
        Comment: comment_wide.as_mut_ptr(),
        LastWritten: FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        },
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: if blob.is_empty() {
            std::ptr::null_mut()
        } else {
            blob.as_mut_ptr()
        },
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: std::ptr::null_mut(),
        UserName: user_name_wide.as_mut_ptr(),
    };

    let result = unsafe { CredWriteW(&credential, 0) };
    if result == 0 {
        return Err(map_windows_credential_error());
    }

    Ok(())
}

#[cfg(windows)]
fn read_windows_generic_credential_utf8(target_name: &str) -> AppResult<String> {
    let secret = read_windows_generic_credential_blob(target_name)?;
    String::from_utf8(secret)
        .map_err(|_| AppError::Io("系统密钥链操作失败：已保存的 AI 配置密钥格式无效".into()))
}

#[cfg(windows)]
fn read_windows_generic_credential_utf16(target_name: &str) -> AppResult<String> {
    let secret = read_windows_generic_credential_blob(target_name)?;
    if secret.len() % 2 != 0 {
        return Err(AppError::Io("系统密钥链操作失败：已保存的 AI 配置密钥格式无效".into()));
    }

    let utf16_units = secret
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&utf16_units)
        .map_err(|_| AppError::Io("系统密钥链操作失败：已保存的 AI 配置密钥格式无效".into()))
}

#[cfg(windows)]
fn read_windows_generic_credential_blob(target_name: &str) -> AppResult<Vec<u8>> {
    let target_name_wide = to_wide_string(target_name);
    let mut credential_ptr: *mut CREDENTIALW = std::ptr::null_mut();
    let result = unsafe { CredReadW(target_name_wide.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential_ptr) };
    if result == 0 {
        return Err(map_windows_credential_error());
    }

    if credential_ptr.is_null() {
        return Err(AppError::Io("系统密钥链操作失败：读取凭据返回空结果".into()));
    }

    let secret = unsafe {
        let credential = &*credential_ptr;
        std::slice::from_raw_parts(
            credential.CredentialBlob as *const u8,
            credential.CredentialBlobSize as usize,
        )
        .to_vec()
    };

    unsafe {
        CredFree(credential_ptr.cast());
    }

    Ok(secret)
}

#[cfg(windows)]
fn delete_windows_generic_credential(target_name: &str) -> AppResult<()> {
    let target_name_wide = to_wide_string(target_name);
    let result = unsafe { CredDeleteW(target_name_wide.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if result == 0 {
        return Err(map_windows_credential_error());
    }

    Ok(())
}

#[cfg(windows)]
fn to_wide_string(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(once(0)).collect()
}

#[cfg(windows)]
fn map_windows_credential_error() -> AppError {
    match unsafe { GetLastError() } {
        ERROR_NOT_FOUND => AppError::NotFound("系统密钥链中未找到 AI 配置密钥".into()),
        code => AppError::Io(format!("系统密钥链操作失败：Windows Credential Manager 错误码 {code}")),
    }
}

#[cfg(not(windows))]
fn map_keyring_error(error: keyring::Error) -> AppError {
    match error {
        keyring::Error::NoEntry => AppError::NotFound("系统密钥链中未找到 AI 配置密钥".into()),
        other => AppError::Io(format!("系统密钥链操作失败：{other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_windows_legacy_target_name, build_windows_secret_target_name};

    #[test]
    fn windows_secret_target_name_is_stable_and_explicit() {
        assert_eq!(
            build_windows_secret_target_name("profile-1"),
            "mynote.ai.profile:profile-1",
        );
    }

    #[test]
    fn windows_legacy_target_name_matches_keyring_default_mapping() {
        assert_eq!(
            build_windows_legacy_target_name("profile-1"),
            "profile-1.mynote.ai.profile",
        );
    }
}

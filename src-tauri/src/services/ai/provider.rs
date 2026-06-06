use crate::domain::ai::{AiProfile, AiTextRequest, AiTextResponse};
use crate::error::{AppError, AppResult};
use async_trait::async_trait;
use reqwest::{Client, StatusCode};

#[async_trait]
pub trait AiProviderAdapter: Send + Sync {
    async fn invoke(
        &self,
        client: &Client,
        profile: &AiProfile,
        api_key: &str,
        request: &AiTextRequest,
    ) -> AppResult<AiTextResponse>;
}

pub fn resolve_endpoint(
    base_url: Option<&str>,
    default_base_url: &str,
    endpoint_suffix: &str,
) -> AppResult<String> {
    let base = base_url.unwrap_or(default_base_url).trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(AppError::InvalidInput("AI provider base URL cannot be blank".into()));
    }

    if base.ends_with(endpoint_suffix) {
        Ok(base.to_string())
    } else {
        Ok(format!("{base}/{endpoint_suffix}"))
    }
}

pub fn resolve_request_max_tokens(profile: &AiProfile, request: &AiTextRequest) -> u32 {
    request.max_tokens.or(profile.max_tokens).unwrap_or(16).max(1)
}

pub fn resolve_request_temperature(profile: &AiProfile, request: &AiTextRequest) -> f32 {
    request.temperature.or(profile.temperature).unwrap_or(0.0)
}

pub fn summarize_http_error(status: StatusCode, body: &str) -> AppError {
    let compact_body = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let snippet = compact_body.chars().take(240).collect::<String>();
    let message = format!("AI provider request failed with status {}: {}", status, snippet);

    if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        AppError::Io(message)
    } else {
        AppError::InvalidInput(message)
    }
}

#[cfg(test)]
mod tests {
    use super::summarize_http_error;
    use crate::error::AppError;
    use reqwest::StatusCode;

    #[test]
    fn summarize_http_error_marks_retryable_status_as_io() {
        let error = summarize_http_error(StatusCode::TOO_MANY_REQUESTS, "rate limited");

        assert!(matches!(error, AppError::Io(_)));
    }

    #[test]
    fn summarize_http_error_marks_configuration_status_as_invalid_input() {
        let error = summarize_http_error(StatusCode::UNAUTHORIZED, "bad api key");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }
}
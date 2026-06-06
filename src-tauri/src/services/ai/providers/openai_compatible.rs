use crate::domain::ai::{AiProfile, AiTextRequest, AiTextResponse};
use crate::error::{AppError, AppResult};
use crate::services::ai::provider::{
    resolve_endpoint, resolve_request_max_tokens, resolve_request_temperature,
    summarize_http_error, AiProviderAdapter,
};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiCompatibleProvider;

#[derive(Debug, Serialize)]
struct OpenAiChatRequest<'a> {
    model: &'a str,
    messages: [OpenAiChatMessage<'a>; 1],
    max_tokens: u32,
    temperature: f32,
}

#[derive(Debug, Serialize)]
struct OpenAiChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponseMessage {
    content: OpenAiMessageContent,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum OpenAiMessageContent {
    Text(String),
    Parts(Vec<OpenAiContentPart>),
}

#[derive(Debug, Deserialize)]
struct OpenAiContentPart {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
    total_tokens: Option<u32>,
}

#[async_trait]
impl AiProviderAdapter for OpenAiCompatibleProvider {
    async fn invoke(
        &self,
        client: &Client,
        profile: &AiProfile,
        api_key: &str,
        request: &AiTextRequest,
    ) -> AppResult<AiTextResponse> {
        let endpoint = resolve_endpoint(
            profile.base_url.as_deref(),
            DEFAULT_OPENAI_BASE_URL,
            "chat/completions",
        )?;
        let response = client
            .post(endpoint)
            .bearer_auth(api_key)
            .json(&OpenAiChatRequest {
                model: &profile.model,
                messages: [OpenAiChatMessage {
                    role: "user",
                    content: &request.prompt,
                }],
                max_tokens: resolve_request_max_tokens(profile, request),
                temperature: resolve_request_temperature(profile, request),
            })
            .send()
            .await
            .map_err(|error| AppError::Io(format!("AI provider request failed: {error}")))?;

        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "<unreadable response body>".into());
            return Err(summarize_http_error(status, &body));
        }

        let payload: OpenAiChatResponse = response
            .json()
            .await
            .map_err(|error| AppError::Parse(format!("Invalid OpenAI-compatible response: {error}")))?;
        let text = extract_openai_text(payload.choices)?;
        let input_tokens = payload.usage.as_ref().and_then(|usage| usage.prompt_tokens);
        let output_tokens = payload.usage.as_ref().and_then(|usage| usage.completion_tokens);
        let total_tokens = payload.usage.and_then(|usage| usage.total_tokens);

        Ok(AiTextResponse {
            text,
            input_tokens,
            output_tokens,
            total_tokens,
            latency_ms: None,
        })
    }
}

fn extract_openai_text(choices: Vec<OpenAiChoice>) -> AppResult<String> {
    let first_choice = choices
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Parse("OpenAI-compatible response did not include any choices".into()))?;

    match first_choice.message.content {
        OpenAiMessageContent::Text(text) => Ok(text.trim().to_string()),
        OpenAiMessageContent::Parts(parts) => parts
            .into_iter()
            .find_map(|part| part.text.map(|text| text.trim().to_string()))
            .filter(|text| !text.is_empty())
            .ok_or_else(|| AppError::Parse("OpenAI-compatible response did not include text content".into())),
    }
}
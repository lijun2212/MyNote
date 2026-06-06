use crate::domain::ai::{AiProfile, AiTextRequest, AiTextResponse};
use crate::error::{AppError, AppResult};
use crate::services::ai::provider::{
    resolve_endpoint, resolve_request_max_tokens, resolve_request_temperature,
    summarize_http_error, AiProviderAdapter,
};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";

#[derive(Debug, Default, Clone, Copy)]
pub struct AnthropicProvider;

#[derive(Debug, Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    temperature: f32,
    messages: [AnthropicMessage<'a>; 1],
    thinking: AnthropicThinkingConfig<'a>,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: [AnthropicTextContentBlock<'a>; 1],
}

#[derive(Debug, Serialize)]
struct AnthropicTextContentBlock<'a> {
    #[serde(rename = "type")]
    block_type: &'a str,
    text: &'a str,
}

#[derive(Debug, Serialize)]
struct AnthropicThinkingConfig<'a> {
    #[serde(rename = "type")]
    mode: &'a str,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
    usage: Option<AnthropicUsage>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicUsage {
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
}

fn excerpt_for_error(body: &str) -> String {
    let trimmed = body.trim();
    let excerpt: String = trimmed.chars().take(240).collect();
    if trimmed.chars().count() > 240 {
        format!("{excerpt}...")
    } else {
        excerpt
    }
}

#[async_trait]
impl AiProviderAdapter for AnthropicProvider {
    async fn invoke(
        &self,
        client: &Client,
        profile: &AiProfile,
        api_key: &str,
        request: &AiTextRequest,
    ) -> AppResult<AiTextResponse> {
        let endpoint = resolve_endpoint(
            profile.base_url.as_deref(),
            DEFAULT_ANTHROPIC_BASE_URL,
            "messages",
        )?;
        let response = client
            .post(endpoint)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&AnthropicRequest {
                model: &profile.model,
                max_tokens: resolve_request_max_tokens(profile, request),
                temperature: resolve_request_temperature(profile, request),
                messages: [AnthropicMessage {
                    role: "user",
                    content: [AnthropicTextContentBlock {
                        block_type: "text",
                        text: &request.prompt,
                    }],
                }],
                thinking: AnthropicThinkingConfig { mode: "disabled" },
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

        let raw_body = response
            .text()
            .await
            .map_err(|error| AppError::Io(format!("Failed to read Anthropic response body: {error}")))?;
        let payload: AnthropicResponse = serde_json::from_str(&raw_body).map_err(|error| {
            AppError::Parse(format!(
                "Invalid Anthropic response: {error}. Response excerpt: {}",
                excerpt_for_error(&raw_body)
            ))
        })?;
        let text = payload
            .content
            .into_iter()
            .find(|block| block.block_type == "text")
            .and_then(|block| block.text)
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
            .ok_or_else(|| {
                AppError::Parse(format!(
                    "Anthropic response did not include text content. Response excerpt: {}",
                    excerpt_for_error(&raw_body)
                ))
            })?;
        let input_tokens = payload.usage.as_ref().and_then(|usage| usage.input_tokens);
        let output_tokens = payload.usage.as_ref().and_then(|usage| usage.output_tokens);
        let total_tokens = match (input_tokens, output_tokens) {
            (Some(input), Some(output)) => Some(input + output),
            _ => None,
        };

        Ok(AiTextResponse {
            text,
            input_tokens,
            output_tokens,
            total_tokens,
            latency_ms: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::AnthropicProvider;
    use crate::domain::ai::{AiProfile, AiProviderKind, AiTextRequest};
    use crate::services::ai::provider::AiProviderAdapter;
    use mockito::{Matcher, Server};

    fn make_profile(base_url: String) -> AiProfile {
        AiProfile {
            id: "profile-1".into(),
            name: "Anthropic Test".into(),
            provider: AiProviderKind::Anthropic,
            model: "claude-3-5-haiku-latest".into(),
            base_url: Some(base_url),
            max_tokens: Some(16),
            temperature: Some(0.0),
            enabled: true,
        }
    }

    #[tokio::test]
    async fn anthropic_parse_error_includes_response_excerpt_when_text_block_is_missing() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/messages")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "content": [
                        {
                            "type": "thinking",
                            "thinking": "hidden reasoning"
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

        let provider = AnthropicProvider;
        let client = reqwest::Client::new();
        let error = provider
            .invoke(
                &client,
                &make_profile(server.url()),
                "sk-anthropic-test",
                &AiTextRequest {
                    prompt: "hello".into(),
                    max_tokens: Some(8),
                    temperature: Some(0.0),
                    expected_text: None,
                },
            )
            .await
            .unwrap_err();

        mock.assert();
        let message = error.to_string();
        assert!(message.contains("Anthropic response did not include text content"));
        assert!(message.contains("thinking"));
        assert!(message.contains("hidden reasoning"));
    }

    #[tokio::test]
    async fn anthropic_request_uses_text_blocks_and_disables_thinking() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/messages")
            .match_header("x-api-key", "sk-anthropic-test")
            .match_body(Matcher::PartialJson(serde_json::json!({
                "messages": [{
                    "role": "user",
                    "content": [{
                        "type": "text",
                        "text": "hello"
                    }]
                }],
                "thinking": {
                    "type": "disabled"
                }
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

        let provider = AnthropicProvider;
        let client = reqwest::Client::new();
        let response = provider
            .invoke(
                &client,
                &make_profile(server.url()),
                "sk-anthropic-test",
                &AiTextRequest {
                    prompt: "hello".into(),
                    max_tokens: Some(8),
                    temperature: Some(0.0),
                    expected_text: None,
                },
            )
            .await
            .unwrap();

        mock.assert();
        assert_eq!(response.text, "MYNOTE_HEALTHCHECK_OK");
    }
}
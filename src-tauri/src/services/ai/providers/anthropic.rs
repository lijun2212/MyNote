use crate::domain::ai::{AiProfile, AiTextRequest, AiTextResponse};
use crate::error::{AppError, AppResult};
use crate::services::ai::provider::{
    resolve_endpoint, resolve_request_max_tokens, resolve_request_temperature,
    summarize_http_error, summarize_reqwest_error, AiProviderAdapter,
};
use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_MAX_TOKENS: u32 = 1024;

#[derive(Debug, Default, Clone, Copy)]
pub struct AnthropicProvider;

#[derive(Debug, Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    temperature: f32,
    messages: [AnthropicMessage<'a>; 1],
    thinking: AnthropicThinkingConfig<'a>,
    stream: bool,
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

#[derive(Debug, Deserialize)]
struct AnthropicStreamPayload {
    #[serde(rename = "type")]
    payload_type: Option<String>,
    delta: Option<AnthropicStreamDelta>,
    usage: Option<AnthropicUsage>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamDelta {
    text: Option<String>,
}

fn resolve_anthropic_max_tokens(profile: &AiProfile, request: &AiTextRequest) -> u32 {
    resolve_request_max_tokens(profile, request).unwrap_or(DEFAULT_ANTHROPIC_MAX_TOKENS)
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
            .header("accept-encoding", "identity")
            .json(&AnthropicRequest {
                model: &profile.model,
                max_tokens: resolve_anthropic_max_tokens(profile, request),
                temperature: resolve_request_temperature(profile, request),
                messages: [AnthropicMessage {
                    role: "user",
                    content: [AnthropicTextContentBlock {
                        block_type: "text",
                        text: &request.prompt,
                    }],
                }],
                thinking: AnthropicThinkingConfig { mode: "disabled" },
                stream: false,
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

    async fn invoke_stream(
        &self,
        client: &Client,
        profile: &AiProfile,
        api_key: &str,
        request: &AiTextRequest,
        on_delta: &mut (dyn FnMut(String) -> AppResult<()> + Send),
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
            .header("accept", "text/event-stream")
            .header("accept-encoding", "identity")
            .json(&AnthropicRequest {
                model: &profile.model,
                max_tokens: resolve_anthropic_max_tokens(profile, request),
                temperature: resolve_request_temperature(profile, request),
                messages: [AnthropicMessage {
                    role: "user",
                    content: [AnthropicTextContentBlock {
                        block_type: "text",
                        text: &request.prompt,
                    }],
                }],
                thinking: AnthropicThinkingConfig { mode: "disabled" },
                stream: true,
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

        let mut full_text = String::new();
        let mut usage: Option<AnthropicUsage> = None;
        let mut buffer = Vec::new();
        let mut lines = Vec::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk
                .map_err(|error| summarize_reqwest_error("Failed to read Anthropic stream chunk", &error))?;
            buffer.extend_from_slice(&bytes);

            while let Some(line) = take_next_sse_line(&mut buffer)? {
                if line.is_empty() {
                    process_anthropic_stream_frame(&lines, &mut full_text, &mut usage, on_delta)?;
                    lines.clear();
                    continue;
                }

                lines.push(line);
            }
        }

        process_anthropic_stream_frame(&lines, &mut full_text, &mut usage, on_delta)?;

        let input_tokens = usage.as_ref().and_then(|value| value.input_tokens);
        let output_tokens = usage.as_ref().and_then(|value| value.output_tokens);
        let total_tokens = match (input_tokens, output_tokens) {
            (Some(input), Some(output)) => Some(input + output),
            _ => None,
        };

        Ok(AiTextResponse {
            text: full_text,
            input_tokens,
            output_tokens,
            total_tokens,
            latency_ms: None,
        })
    }
}

fn process_anthropic_stream_frame(
    lines: &[String],
    full_text: &mut String,
    usage: &mut Option<AnthropicUsage>,
    on_delta: &mut (dyn FnMut(String) -> AppResult<()> + Send),
) -> AppResult<()> {
    let mut event_name: Option<&str> = None;
    let mut data_lines = Vec::new();

    for line in lines {
        if let Some(value) = line.strip_prefix("event:") {
            event_name = Some(value.trim());
        } else if let Some(value) = line.strip_prefix("data:") {
            data_lines.push(value.trim().to_string());
        }
    }

    if data_lines.is_empty() {
        return Ok(());
    }

    let payload_raw = data_lines.join("\n");
    let payload: AnthropicStreamPayload = serde_json::from_str(&payload_raw).map_err(|error| {
        AppError::Parse(format!("Invalid Anthropic stream event: {error}. Response excerpt: {}", excerpt_for_error(&payload_raw)))
    })?;

    let event_kind = event_name.or(payload.payload_type.as_deref()).unwrap_or("");
    match event_kind {
        "content_block_delta" => {
            if let Some(delta) = payload.delta.and_then(|value| value.text).filter(|value| !value.is_empty()) {
                full_text.push_str(&delta);
                on_delta(delta)?;
            }
        }
        "message_delta" | "message_start" => {
            if payload.usage.is_some() {
                *usage = payload.usage;
            }
        }
        _ => {}
    }

    Ok(())
}

fn take_next_sse_line(buffer: &mut Vec<u8>) -> AppResult<Option<String>> {
    let Some(newline_index) = buffer.iter().position(|byte| *byte == b'\n') else {
        return Ok(None);
    };

    let mut line = buffer.drain(..=newline_index).collect::<Vec<_>>();
    if line.last() == Some(&b'\n') {
        line.pop();
    }
    if line.last() == Some(&b'\r') {
        line.pop();
    }

    String::from_utf8(line)
        .map(Some)
        .map_err(|error| AppError::Parse(format!("Anthropic stream contained invalid UTF-8: {error}")))
}

#[cfg(test)]
mod tests {
    use super::{resolve_anthropic_max_tokens, AnthropicProvider, DEFAULT_ANTHROPIC_MAX_TOKENS};
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
            .match_header("accept-encoding", "identity")
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

    #[tokio::test]
    async fn anthropic_streams_text_deltas() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/messages")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(concat!(
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"MYNOTE_\"}}\n\n",
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"HEALTHCHECK_OK\"}}\n\n",
                "event: message_delta\n",
                "data: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}\n\n",
                "event: message_stop\n",
                "data: {\"type\":\"message_stop\"}\n\n"
            ))
            .create_async()
            .await;

        let provider = AnthropicProvider;
        let client = reqwest::Client::new();
        let mut chunks = Vec::new();
        let response = provider
            .invoke_stream(
                &client,
                &make_profile(server.url()),
                "sk-anthropic-test",
                &AiTextRequest {
                    prompt: "hello".into(),
                    max_tokens: Some(8),
                    temperature: Some(0.0),
                    expected_text: None,
                },
                &mut |chunk| {
                    chunks.push(chunk);
                    Ok(())
                },
            )
            .await
            .unwrap();

        mock.assert();
        assert_eq!(chunks, vec!["MYNOTE_", "HEALTHCHECK_OK"]);
        assert_eq!(response.text, "MYNOTE_HEALTHCHECK_OK");
        assert_eq!(response.total_tokens, Some(13));
    }

    #[tokio::test]
    async fn anthropic_non_stream_request_tolerates_incorrect_content_encoding_header() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/messages")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_header("content-encoding", "gzip")
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

    #[tokio::test]
    async fn anthropic_stream_tolerates_incorrect_content_encoding_header() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/messages")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_header("content-encoding", "gzip")
            .with_body(concat!(
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"MYNOTE_\"}}\n\n",
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"HEALTHCHECK_OK\"}}\n\n",
                "event: message_delta\n",
                "data: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}\n\n",
                "event: message_stop\n",
                "data: {\"type\":\"message_stop\"}\n\n"
            ))
            .create_async()
            .await;

        let provider = AnthropicProvider;
        let client = reqwest::Client::new();
        let mut chunks = Vec::new();
        let response = provider
            .invoke_stream(
                &client,
                &make_profile(server.url()),
                "sk-anthropic-test",
                &AiTextRequest {
                    prompt: "hello".into(),
                    max_tokens: Some(8),
                    temperature: Some(0.0),
                    expected_text: None,
                },
                &mut |chunk| {
                    chunks.push(chunk);
                    Ok(())
                },
            )
            .await
            .unwrap();

        mock.assert();
        assert_eq!(chunks, vec!["MYNOTE_", "HEALTHCHECK_OK"]);
        assert_eq!(response.text, "MYNOTE_HEALTHCHECK_OK");
    }

    #[test]
    fn anthropic_defaults_to_large_max_tokens_when_unconfigured() {
        let profile = AiProfile {
            id: "profile-1".into(),
            name: "Anthropic Test".into(),
            provider: AiProviderKind::Anthropic,
            model: "claude-3-5-haiku-latest".into(),
            base_url: None,
            max_tokens: None,
            temperature: None,
            enabled: true,
        };
        let request = AiTextRequest {
            prompt: "hello".into(),
            max_tokens: None,
            temperature: None,
            expected_text: None,
        };

        assert_eq!(resolve_anthropic_max_tokens(&profile, &request), DEFAULT_ANTHROPIC_MAX_TOKENS);
    }
}
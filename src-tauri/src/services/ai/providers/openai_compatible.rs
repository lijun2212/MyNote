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

const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiCompatibleProvider;

#[derive(Debug, Serialize)]
struct OpenAiChatRequest<'a> {
    model: &'a str,
    messages: [OpenAiChatMessage<'a>; 1],
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    temperature: f32,
    stream: bool,
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
struct OpenAiStreamResponse {
    choices: Vec<OpenAiStreamChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamChoice {
    delta: OpenAiStreamDelta,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamDelta {
    content: Option<OpenAiMessageContent>,
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
            .header("accept-encoding", "identity")
            .json(&OpenAiChatRequest {
                model: &profile.model,
                messages: [OpenAiChatMessage {
                    role: "user",
                    content: &request.prompt,
                }],
                max_tokens: resolve_request_max_tokens(profile, request),
                temperature: resolve_request_temperature(profile, request),
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
            DEFAULT_OPENAI_BASE_URL,
            "chat/completions",
        )?;
        let response = client
            .post(endpoint)
            .bearer_auth(api_key)
            .header("accept", "text/event-stream")
            .header("accept-encoding", "identity")
            .json(&OpenAiChatRequest {
                model: &profile.model,
                messages: [OpenAiChatMessage {
                    role: "user",
                    content: &request.prompt,
                }],
                max_tokens: resolve_request_max_tokens(profile, request),
                temperature: resolve_request_temperature(profile, request),
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
        let mut usage: Option<OpenAiUsage> = None;
        let mut buffer = Vec::new();
        let mut lines = Vec::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk
                .map_err(|error| summarize_reqwest_error("Failed to read OpenAI-compatible stream chunk", &error))?;
            buffer.extend_from_slice(&bytes);

            while let Some(line) = take_next_sse_line(&mut buffer)? {
                if line.is_empty() {
                    process_openai_stream_frame(&lines, &mut full_text, &mut usage, on_delta)?;
                    lines.clear();
                    continue;
                }

                lines.push(line);
            }
        }

        process_openai_stream_frame(&lines, &mut full_text, &mut usage, on_delta)?;

        Ok(AiTextResponse {
            text: full_text,
            input_tokens: usage.as_ref().and_then(|value| value.prompt_tokens),
            output_tokens: usage.as_ref().and_then(|value| value.completion_tokens),
            total_tokens: usage.and_then(|value| value.total_tokens),
            latency_ms: None,
        })
    }
}

fn process_openai_stream_frame(
    lines: &[String],
    full_text: &mut String,
    usage: &mut Option<OpenAiUsage>,
    on_delta: &mut (dyn FnMut(String) -> AppResult<()> + Send),
) -> AppResult<()> {
    for line in lines {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = data.trim();
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }

        let parsed: OpenAiStreamResponse = serde_json::from_str(payload)
            .map_err(|error| AppError::Parse(format!("Invalid OpenAI-compatible stream event: {error}")))?;
        if let Some(delta) = extract_openai_stream_text(&parsed.choices)? {
            full_text.push_str(&delta);
            on_delta(delta)?;
        }

        if parsed.usage.is_some() {
            *usage = parsed.usage;
        }
    }

    Ok(())
}

fn extract_openai_stream_text(choices: &[OpenAiStreamChoice]) -> AppResult<Option<String>> {
    let Some(first_choice) = choices.first() else {
        return Err(AppError::Parse(
            "OpenAI-compatible stream event did not include any choices".into(),
        ));
    };

    let Some(content) = first_choice.delta.content.as_ref() else {
        return Ok(None);
    };

    match content {
        OpenAiMessageContent::Text(text) => Ok((!text.is_empty()).then(|| text.clone())),
        OpenAiMessageContent::Parts(parts) => Ok(parts
            .iter()
            .find_map(|part| part.text.as_ref())
            .filter(|text| !text.is_empty())
            .cloned()),
    }
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
        .map_err(|error| AppError::Parse(format!("OpenAI-compatible stream contained invalid UTF-8: {error}")))
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

#[cfg(test)]
mod tests {
    use super::OpenAiCompatibleProvider;
    use crate::domain::ai::{AiProfile, AiProviderKind, AiTextRequest};
    use crate::services::ai::provider::AiProviderAdapter;
    use super::{OpenAiChatMessage, OpenAiChatRequest};
    use mockito::{Matcher, Server};
    use reqwest::Client;

    fn openai_profile(base_url: String) -> AiProfile {
        AiProfile {
            id: "profile-openai".into(),
            name: "OpenAI".into(),
            provider: AiProviderKind::OpenAiCompatible,
            model: "demo-model".into(),
            base_url: Some(base_url),
            max_tokens: Some(32),
            temperature: Some(0.0),
            enabled: true,
        }
    }

    #[test]
    fn openai_request_omits_max_tokens_when_not_configured() {
        let payload = serde_json::to_value(OpenAiChatRequest {
            model: "gpt-5-mini",
            messages: [OpenAiChatMessage {
                role: "user",
                content: "hello",
            }],
            max_tokens: None,
            temperature: 0.4,
            stream: true,
        })
        .unwrap();

        assert!(payload.get("max_tokens").is_none());
    }

    #[tokio::test]
    async fn openai_non_stream_request_tolerates_incorrect_content_encoding_header() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/chat/completions")
            .match_header("accept-encoding", "identity")
            .match_body(Matcher::PartialJson(serde_json::json!({
                "stream": false,
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_header("content-encoding", "gzip")
            .with_body(
                serde_json::json!({
                    "choices": [
                        {
                            "message": {
                                "content": "hello"
                            }
                        }
                    ],
                    "usage": {
                        "prompt_tokens": 5,
                        "completion_tokens": 2,
                        "total_tokens": 7
                    }
                })
                .to_string(),
            )
            .create_async()
            .await;

        let provider = OpenAiCompatibleProvider;
        let client = Client::new();
        let response = provider
            .invoke(
                &client,
                &openai_profile(server.url()),
                "sk-test",
                &AiTextRequest {
                    prompt: "hello".into(),
                    max_tokens: Some(16),
                    temperature: Some(0.0),
                    expected_text: None,
                },
            )
            .await
            .unwrap();

        assert_eq!(response.text, "hello");
        assert_eq!(response.total_tokens, Some(7));
    }

    #[tokio::test]
    async fn openai_stream_tolerates_incorrect_content_encoding_header() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/chat/completions")
            .match_header("accept", "text/event-stream")
            .match_header("accept-encoding", "identity")
            .match_body(Matcher::PartialJson(serde_json::json!({
                "stream": true,
            })))
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_header("content-encoding", "gzip")
            .with_body(concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{}}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n",
                "data: [DONE]\n\n"
            ))
            .create_async()
            .await;

        let provider = OpenAiCompatibleProvider;
        let client = Client::new();
        let mut deltas = Vec::new();
        let response = provider
            .invoke_stream(
                &client,
                &openai_profile(server.url()),
                "sk-test",
                &AiTextRequest {
                    prompt: "hello".into(),
                    max_tokens: Some(16),
                    temperature: Some(0.0),
                    expected_text: None,
                },
                &mut |delta| {
                    deltas.push(delta);
                    Ok(())
                },
            )
            .await
            .unwrap();

        assert_eq!(deltas, vec!["hello"]);
        assert_eq!(response.text, "hello");
        assert_eq!(response.total_tokens, Some(7));
    }
}
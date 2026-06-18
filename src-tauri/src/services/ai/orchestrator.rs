use crate::domain::ai::{AiProfile, AiProviderKind, AiTextRequest, AiTextResponse};
use crate::error::{AppError, AppResult};
use crate::services::ai::provider::AiProviderAdapter;
use crate::services::ai::providers::{AnthropicProvider, OpenAiCompatibleProvider};
use reqwest::Client;
use std::time::{Duration, Instant};

const HEALTHCHECK_PROMPT: &str = "Reply with exactly MYNOTE_HEALTHCHECK_OK and no extra words.";
const HEALTHCHECK_EXPECTED_TEXT: &str = "MYNOTE_HEALTHCHECK_OK";
const AI_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const AI_READ_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub struct AiOrchestrator {
    client: Client,
}

impl Default for AiOrchestrator {
    fn default() -> Self {
        let client = Client::builder()
            .connect_timeout(AI_CONNECT_TIMEOUT)
            .read_timeout(AI_READ_TIMEOUT)
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .build()
            .expect("failed to construct AI HTTP client");
        Self { client }
    }
}

impl AiOrchestrator {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn invoke_text(
        &self,
        profile: &AiProfile,
        api_key: &str,
        request: &AiTextRequest,
    ) -> AppResult<AiTextResponse> {
        let adapter: &dyn AiProviderAdapter = match profile.provider {
            AiProviderKind::OpenAiCompatible => &OpenAiCompatibleProvider,
            AiProviderKind::Anthropic => &AnthropicProvider,
        };
        let started_at = Instant::now();
        let mut response = adapter.invoke(&self.client, profile, api_key, request).await?;
        response.latency_ms = Some(started_at.elapsed().as_millis() as u64);

        if let Some(expected_text) = request.expected_text.as_deref() {
            let actual = response.text.trim();
            if actual != expected_text {
                return Err(AppError::Parse(format!(
                    "AI provider healthcheck returned unexpected text: {actual}"
                )));
            }
        }

        Ok(response)
    }

    pub async fn invoke_text_stream(
        &self,
        profile: &AiProfile,
        api_key: &str,
        request: &AiTextRequest,
        on_delta: &mut (dyn FnMut(String) -> AppResult<()> + Send),
    ) -> AppResult<AiTextResponse> {
        let adapter: &dyn AiProviderAdapter = match profile.provider {
            AiProviderKind::OpenAiCompatible => &OpenAiCompatibleProvider,
            AiProviderKind::Anthropic => &AnthropicProvider,
        };
        let started_at = Instant::now();
        let mut response = adapter
            .invoke_stream(&self.client, profile, api_key, request, on_delta)
            .await?;
        response.latency_ms = Some(started_at.elapsed().as_millis() as u64);

        if let Some(expected_text) = request.expected_text.as_deref() {
            let actual = response.text.trim();
            if actual != expected_text {
                return Err(AppError::Parse(format!(
                    "AI provider healthcheck returned unexpected text: {actual}"
                )));
            }
        }

        Ok(response)
    }

    pub async fn test_profile(
        &self,
        profile: &AiProfile,
        api_key: &str,
    ) -> AppResult<AiTextResponse> {
        self.invoke_text(
            profile,
            api_key,
            &AiTextRequest {
                prompt: HEALTHCHECK_PROMPT.into(),
                max_tokens: Some(16),
                temperature: Some(0.0),
                expected_text: Some(HEALTHCHECK_EXPECTED_TEXT.into()),
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::AiOrchestrator;
    use crate::domain::ai::{AiProfile, AiProviderKind};
    use crate::error::AppError;
    use crate::services::ai::orchestrator::{HEALTHCHECK_EXPECTED_TEXT, HEALTHCHECK_PROMPT};
    use mockito::{Matcher, Server};
    use reqwest::Client;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::time::{sleep, Duration};

    fn openai_profile(base_url: String) -> AiProfile {
        AiProfile {
            id: "profile-1".into(),
            name: "OpenAI".into(),
            provider: AiProviderKind::OpenAiCompatible,
            model: "gpt-4.1-mini".into(),
            base_url: Some(base_url),
            max_tokens: Some(16),
            temperature: Some(0.0),
            enabled: true,
        }
    }

    fn anthropic_profile(base_url: String) -> AiProfile {
        AiProfile {
            id: "profile-1".into(),
            name: "Anthropic".into(),
            provider: AiProviderKind::Anthropic,
            model: "claude-3-5-sonnet-latest".into(),
            base_url: Some(base_url),
            max_tokens: Some(16),
            temperature: Some(0.0),
            enabled: true,
        }
    }

    #[tokio::test]
    async fn orchestrator_returns_text_from_openai_compatible_response() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/v1/chat/completions")
            .match_header("authorization", Matcher::Regex("Bearer .+".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"choices":[{"message":{"content":"MYNOTE_HEALTHCHECK_OK"}}],"usage":{"prompt_tokens":12,"completion_tokens":9,"total_tokens":21}}"#)
            .create_async()
            .await;

        let orchestrator = AiOrchestrator::new(Client::new());
        let response = orchestrator
            .test_profile(&openai_profile(format!("{}/v1", server.url())), "sk-demo")
            .await
            .unwrap();

        assert_eq!(response.text, "MYNOTE_HEALTHCHECK_OK");
        assert_eq!(response.input_tokens, Some(12));
        assert_eq!(response.output_tokens, Some(9));
        assert_eq!(response.total_tokens, Some(21));
        assert!(response.latency_ms.is_some());
    }

    #[tokio::test]
    async fn orchestrator_returns_text_from_anthropic_response() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/v1/messages")
            .match_header("x-api-key", "sk-demo")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"content":[{"type":"text","text":"MYNOTE_HEALTHCHECK_OK"}],"usage":{"input_tokens":10,"output_tokens":7}}"#)
            .create_async()
            .await;

        let orchestrator = AiOrchestrator::new(Client::new());
        let response = orchestrator
            .test_profile(&anthropic_profile(format!("{}/v1", server.url())), "sk-demo")
            .await
            .unwrap();

        assert_eq!(response.text, "MYNOTE_HEALTHCHECK_OK");
        assert_eq!(response.input_tokens, Some(10));
        assert_eq!(response.output_tokens, Some(7));
        assert_eq!(response.total_tokens, Some(17));
        assert!(response.latency_ms.is_some());
    }

    #[tokio::test]
    async fn test_profile_rejects_unexpected_healthcheck_text() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"choices":[{"message":{"content":"Hello"}}]}"#)
            .create_async()
            .await;

        let orchestrator = AiOrchestrator::new(Client::new());
        let error = orchestrator
            .test_profile(&openai_profile(format!("{}/v1", server.url())), "sk-demo")
            .await
            .unwrap_err();

        assert!(matches!(error, AppError::Parse(_)));
    }

    #[tokio::test]
    async fn orchestrator_streams_text_from_openai_compatible_response() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"MYNOTE_\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"HEALTHCHECK_OK\"}}]}\n\n",
                "data: [DONE]\n\n"
            ))
            .create_async()
            .await;

        let orchestrator = AiOrchestrator::new(Client::new());
        let mut chunks = Vec::new();
        let response = orchestrator
            .invoke_text_stream(
                &openai_profile(format!("{}/v1", server.url())),
                "sk-demo",
                &crate::domain::ai::AiTextRequest {
                    prompt: HEALTHCHECK_PROMPT.into(),
                    max_tokens: Some(16),
                    temperature: Some(0.0),
                    expected_text: Some(HEALTHCHECK_EXPECTED_TEXT.into()),
                },
                &mut |chunk| {
                    chunks.push(chunk);
                    Ok(())
                },
            )
            .await
            .unwrap();

        assert_eq!(chunks, vec!["MYNOTE_", "HEALTHCHECK_OK"]);
        assert_eq!(response.text, "MYNOTE_HEALTHCHECK_OK");
    }

    #[tokio::test]
    async fn orchestrator_allows_long_openai_streams_when_chunks_keep_arriving() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request_buffer = [0_u8; 4096];
            let _ = socket.read(&mut request_buffer).await.unwrap();

            async fn write_chunk(socket: &mut tokio::net::TcpStream, body: &str) {
                socket
                    .write_all(format!("{:x}\r\n", body.as_bytes().len()).as_bytes())
                    .await
                    .unwrap();
                socket.write_all(body.as_bytes()).await.unwrap();
                socket.write_all(b"\r\n").await.unwrap();
            }

            socket
                .write_all(
                    concat!(
                        "HTTP/1.1 200 OK\r\n",
                        "Content-Type: text/event-stream\r\n",
                        "Transfer-Encoding: chunked\r\n",
                        "\r\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            write_chunk(
                &mut socket,
                "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n",
            )
            .await;
            socket.flush().await.unwrap();

            sleep(Duration::from_secs(21)).await;

            write_chunk(
                &mut socket,
                "data: {\"choices\":[{\"delta\":{\"content\":\" second\"}}]}\n\n",
            )
            .await;
            write_chunk(&mut socket, "data: [DONE]\n\n").await;
            socket.write_all(b"0\r\n\r\n").await.unwrap();
            socket.flush().await.unwrap();
        });

        let orchestrator = AiOrchestrator::default();
        let mut chunks = Vec::new();
        let response = orchestrator
            .invoke_text_stream(
                &openai_profile(format!("http://{addr}/v1")),
                "sk-demo",
                &crate::domain::ai::AiTextRequest {
                    prompt: "hello".into(),
                    max_tokens: Some(16),
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

        server.await.unwrap();
        assert_eq!(chunks, vec!["first", " second"]);
        assert_eq!(response.text, "first second");
    }
}
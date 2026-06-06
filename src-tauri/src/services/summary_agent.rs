use crate::domain::ai::{
    AiProfile, AiProviderTrace, AiTextRequest, AiTextResponse, SummaryGenerationResult,
};
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::resolve_kb_path;
use crate::infrastructure::markdown::{parse_note, remove_lookback_summary_block};
use crate::services::ai::{
    load_ai_profile_with_secret, resolve_ai_profile_selection, AiOrchestrator, AiSecretStore,
    SystemSecretStore,
};
use crate::services::summary::build_summary_candidate;
use rusqlite::Connection;
use std::path::Path;

const MAX_SUMMARY_CHARS: usize = 180;
const MAX_CONTEXT_CHARS: usize = 2400;

pub enum PreparedSummaryAgent {
    Disabled,
    Fallback { trace: AiProviderTrace },
    Ready { profile: AiProfile, api_key: String },
}

pub fn prepare_summary_agent(
    conn: &Connection,
    kb_root: &Path,
    profile_id: Option<&str>,
    secret_store: &dyn AiSecretStore,
) -> PreparedSummaryAgent {
    let selected_profile_id = match resolve_ai_profile_selection(conn, profile_id) {
        Ok(profile_id) => profile_id,
        Err(error) => {
            return PreparedSummaryAgent::Fallback {
                trace: AiProviderTrace {
                    profile_id: profile_id.map(str::to_string),
                    provider: None,
                    model: None,
                    latency_ms: None,
                    input_tokens: None,
                    output_tokens: None,
                    total_tokens: None,
                    error: Some(error.to_string()),
                },
            };
        }
    };

    let Some(selected_profile_id) = selected_profile_id else {
        return PreparedSummaryAgent::Disabled;
    };

    match load_ai_profile_with_secret(conn, secret_store, kb_root, &selected_profile_id) {
        Ok((profile, api_key)) => {
            if !profile.enabled {
                PreparedSummaryAgent::Fallback {
                    trace: trace_for_profile(
                        &profile,
                        None,
                        Some(format!("AI profile {} is disabled", profile.id)),
                    ),
                }
            } else {
                PreparedSummaryAgent::Ready { profile, api_key }
            }
        }
        Err(error) => PreparedSummaryAgent::Fallback {
            trace: AiProviderTrace {
                profile_id: Some(selected_profile_id),
                provider: None,
                model: None,
                latency_ms: None,
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                error: Some(error.to_string()),
            },
        },
    }
}

pub fn prepare_default_summary_agent(
    conn: &Connection,
    kb_root: &Path,
    profile_id: Option<&str>,
) -> PreparedSummaryAgent {
    prepare_summary_agent(conn, kb_root, profile_id, &SystemSecretStore)
}

pub async fn generate_summary_candidate_with_ai_for_root(
    root: &Path,
    path: &str,
    prepared: PreparedSummaryAgent,
) -> AppResult<SummaryGenerationResult> {
    let abs = resolve_kb_path(root, path)?;
    let content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", path)))?;
    let fallback_title = path
        .rsplit('/')
        .next()
        .unwrap_or("Untitled")
        .trim_end_matches(".md");

    match prepared {
        PreparedSummaryAgent::Disabled => Ok(SummaryGenerationResult {
            summary: build_summary_candidate(&content, fallback_title)?,
            used_fallback: true,
            provider_trace: None,
        }),
        PreparedSummaryAgent::Fallback { trace } => Ok(SummaryGenerationResult {
            summary: build_summary_candidate(&content, fallback_title)?,
            used_fallback: true,
            provider_trace: Some(trace),
        }),
        PreparedSummaryAgent::Ready { profile, api_key } => {
            let request = build_summary_prompt(&profile, &content, fallback_title)?;
            let orchestrator = AiOrchestrator::default();
            let mut result = generate_summary_candidate_with_ai_inner(
                &content,
                fallback_title,
                orchestrator.invoke_text(&profile, &api_key, &request).await,
            )?;

            if let Some(trace) = result.provider_trace.as_mut() {
                trace.profile_id = Some(profile.id.clone());
                trace.provider = Some(profile.provider.clone());
                trace.model = Some(profile.model.clone());
            }

            Ok(result)
        }
    }
}

pub fn build_summary_prompt(
    profile: &AiProfile,
    content: &str,
    fallback_title: &str,
) -> AppResult<AiTextRequest> {
    let parsed = parse_note(content, fallback_title)?;
    let trimmed_context = trim_summary_context(content, fallback_title, MAX_CONTEXT_CHARS)?;

    Ok(AiTextRequest {
        prompt: format!(
            concat!(
                "你是 MyNote 的中文知识库摘要助手。",
                "请根据标题和正文生成一段自然、可回看的中文摘要。",
                "不要使用模板化开头，不要列点，不要超过 180 个中文字符。\n\n",
                "模型：{}\n",
                "标题：{}\n\n",
                "正文（已裁剪）：\n{}"
            ),
            profile.model,
            parsed.title,
            trimmed_context,
        ),
        max_tokens: Some(MAX_SUMMARY_CHARS as u32),
        temperature: Some(0.4),
        expected_text: None,
    })
}

pub fn trim_summary_context(
    content: &str,
    fallback_title: &str,
    max_chars: usize,
) -> AppResult<String> {
    let parsed = parse_note(content, fallback_title)?;
    let body = remove_lookback_summary_block(&parsed.body);

    let mut trimmed = String::new();
    for block in body.split("\n\n") {
        let normalized = block.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            continue;
        }

        let next = if trimmed.is_empty() {
            normalized.clone()
        } else {
            format!("{}\n\n{}", trimmed, normalized)
        };

        if next.chars().count() > max_chars {
            break;
        }

        trimmed = next;
    }

    if trimmed.is_empty() {
        Ok(body.chars().take(max_chars).collect::<String>())
    } else {
        Ok(trimmed)
    }
}

pub fn finalize_summary(text: &str) -> String {
    let normalized = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = normalized
        .trim()
        .trim_start_matches("摘要：")
        .trim_start_matches("摘要:")
        .trim()
        .trim_matches('"')
        .trim_matches('“')
        .trim_matches('”')
        .trim()
        .to_string();

    trimmed.chars().take(MAX_SUMMARY_CHARS).collect()
}

pub fn generate_summary_candidate_with_ai_inner(
    content: &str,
    fallback_title: &str,
    ai_result: Result<AiTextResponse, AppError>,
) -> AppResult<SummaryGenerationResult> {
    let fallback_summary = build_summary_candidate(content, fallback_title)?;

    match ai_result {
        Ok(response) => {
            let summary = finalize_summary(&response.text);
            if summary.is_empty() {
                Ok(SummaryGenerationResult {
                    summary: fallback_summary,
                    used_fallback: true,
                    provider_trace: Some(AiProviderTrace {
                        profile_id: None,
                        provider: None,
                        model: None,
                        latency_ms: response.latency_ms,
                        input_tokens: response.input_tokens,
                        output_tokens: response.output_tokens,
                        total_tokens: response.total_tokens,
                        error: Some("AI summary response was empty after normalization".into()),
                    }),
                })
            } else {
                Ok(SummaryGenerationResult {
                    summary,
                    used_fallback: false,
                    provider_trace: Some(AiProviderTrace {
                        profile_id: None,
                        provider: None,
                        model: None,
                        latency_ms: response.latency_ms,
                        input_tokens: response.input_tokens,
                        output_tokens: response.output_tokens,
                        total_tokens: response.total_tokens,
                        error: None,
                    }),
                })
            }
        }
        Err(error) => Ok(SummaryGenerationResult {
            summary: fallback_summary,
            used_fallback: true,
            provider_trace: Some(AiProviderTrace {
                profile_id: None,
                provider: None,
                model: None,
                latency_ms: None,
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                error: Some(error.to_string()),
            }),
        }),
    }
}

fn trace_for_profile(
    profile: &AiProfile,
    response: Option<&AiTextResponse>,
    error: Option<String>,
) -> AiProviderTrace {
    AiProviderTrace {
        profile_id: Some(profile.id.clone()),
        provider: Some(profile.provider.clone()),
        model: Some(profile.model.clone()),
        latency_ms: response.and_then(|value| value.latency_ms),
        input_tokens: response.and_then(|value| value.input_tokens),
        output_tokens: response.and_then(|value| value.output_tokens),
        total_tokens: response.and_then(|value| value.total_tokens),
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        finalize_summary, generate_summary_candidate_with_ai_inner, prepare_summary_agent,
        PreparedSummaryAgent,
    };
    use crate::domain::ai::{AiProfileInput, AiProviderKind, AiTextResponse};
    use crate::error::AppError;
    use crate::infrastructure::db::open_and_migrate;
    use crate::services::ai::{upsert_ai_profile, AiSecretStore};
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::Mutex;
    use tempfile::tempdir;

    #[derive(Default)]
    struct MemorySecretStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl AiSecretStore for MemorySecretStore {
        fn set_profile_secret(&self, profile_id: &str, api_key: &str) -> Result<(), AppError> {
            self.values
                .lock()
                .unwrap()
                .insert(profile_id.to_string(), api_key.to_string());
            Ok(())
        }

        fn get_profile_secret(&self, profile_id: &str) -> Result<String, AppError> {
            self.values
                .lock()
                .unwrap()
                .get(profile_id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("AI profile secret not found: {profile_id}")))
        }

        fn delete_profile_secret(&self, profile_id: &str) -> Result<(), AppError> {
            self.values.lock().unwrap().remove(profile_id);
            Ok(())
        }
    }

    #[test]
    fn generate_summary_candidate_with_ai_falls_back_to_rule_summary_when_provider_fails() {
        let content = "# 标题\n\n这是第一段内容，用于提供回退摘要。";

        let result = generate_summary_candidate_with_ai_inner(
            content,
            "标题",
            Err(AppError::InvalidInput("quota exceeded".into())),
        )
        .unwrap();

        assert!(result.used_fallback);
        assert_eq!(result.summary, "这是第一段内容，用于提供回退摘要。");
        assert!(result
            .provider_trace
            .as_ref()
            .and_then(|trace| trace.error.as_deref())
            .is_some());
    }

    #[test]
    fn generate_summary_candidate_with_ai_uses_ai_summary_when_response_is_present() {
        let content = "# 标题\n\n这是第一段内容，用于提供回退摘要。";

        let result = generate_summary_candidate_with_ai_inner(
            content,
            "标题",
            Ok(AiTextResponse {
                text: "  摘要：AI 生成的摘要。  ".into(),
                input_tokens: Some(12),
                output_tokens: Some(8),
                total_tokens: Some(20),
                latency_ms: Some(42),
            }),
        )
        .unwrap();

        assert!(!result.used_fallback);
        assert_eq!(result.summary, "AI 生成的摘要。");
    }

    #[test]
    fn prepare_summary_agent_falls_back_when_secret_missing() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
        upsert_ai_profile(
            &conn,
            AiProfileInput {
                id: Some("profile-1".into()),
                name: "Profile 1".into(),
                provider: AiProviderKind::OpenAiCompatible,
                model: "gpt-4.1-mini".into(),
                base_url: None,
                max_tokens: None,
                temperature: None,
                enabled: true,
            },
        )
        .unwrap();

        let secret_store = MemorySecretStore::default();
        let prepared = prepare_summary_agent(
            &conn,
            Path::new("/tmp/mynote-summary-agent"),
            Some("profile-1"),
            &secret_store,
        );

        assert!(matches!(prepared, PreparedSummaryAgent::Fallback { .. }));
    }

    #[test]
    fn finalize_summary_removes_prefix_and_extra_whitespace() {
        assert_eq!(finalize_summary("\n摘要：  测试摘要。  \n"), "测试摘要。");
    }
}
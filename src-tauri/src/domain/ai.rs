use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderKind {
    OpenAiCompatible,
    Anthropic,
}

impl AiProviderKind {
    pub fn as_setting_value(&self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "open_ai_compatible",
            Self::Anthropic => "anthropic",
        }
    }

    pub fn from_setting_value(value: &str) -> Option<Self> {
        match value {
            "open_ai_compatible" => Some(Self::OpenAiCompatible),
            "anthropic" => Some(Self::Anthropic),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub base_url: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub base_url: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTextRequest {
    pub prompt: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub expected_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiTextResponse {
    pub text: String,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiProviderTrace {
    pub profile_id: Option<String>,
    pub provider: Option<AiProviderKind>,
    pub model: Option<String>,
    pub latency_ms: Option<u64>,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SummaryGenerationResult {
    pub summary: String,
    pub used_fallback: bool,
    pub provider_trace: Option<AiProviderTrace>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiSettings {
    pub enabled: bool,
    pub default_profile_id: Option<String>,
    pub profiles: Vec<AiProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiProfileTestStatus {
    Ok,
    Failed,
    MissingSecret,
    KeychainUnavailable,
    NotImplemented,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiProfileTestErrorKind {
    ProviderUnavailable,
    InvalidConfiguration,
    InvalidResponse,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiProfileTestResult {
    pub success: bool,
    pub status: AiProfileTestStatus,
    pub message: String,
    pub error_kind: Option<AiProfileTestErrorKind>,
    pub retryable: Option<bool>,
    pub text: Option<String>,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub latency_ms: Option<u64>,
}

# LLM Summary Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MyNote 增加基于后端代理的大模型配置、供应商适配与自动摘要 Agent，并与现有菜单、摘要链路、搜索索引稳定集成。

**Architecture:** 方案采用 Tauri/Rust 统一代理各家模型供应商，前端只处理配置与交互，不直接持有 API Key。非敏感配置复用 SQLite settings 表，敏感凭据进入系统密钥链；摘要生成通过统一 AI orchestrator 调度，并在失败时回退到现有规则摘要链路。

**Tech Stack:** React 19 + TypeScript + Zustand + Tauri 2 + Rust + rusqlite + reqwest + keyring + Vitest + cargo test

---

## 修订记录

| 日期 | 版本 | 作者 | 说明 |
| --- | --- | --- | --- |
| 2026-06-06 | v1.0 | Copilot | 基于已确认架构决策输出首版可执行计划。 |

## 目录

1. 范围约束
2. 文件结构
3. Task 1: AI 设置数据底座
4. Task 2: 密钥链与连通性测试
5. Task 3: Provider 适配层与统一调用网关
6. Task 4: 自动摘要 Agent 后端接线
7. Task 5: 前端菜单、状态与设置入口
8. Task 6: AI 设置页与摘要交互落地
9. Task 7: 端到端验证与收口
10. 自检

## 1. 范围约束

本计划覆盖同一条产品主线的四个子面：
- 后端 AI 配置与安全存储。
- 多供应商统一调用能力。
- 自动摘要 Agent 与规则回退。
- 前端菜单、设置页、摘要生成交互。

虽然涉及前后端两个子系统，但这四部分共享同一条摘要调用链与同一套配置模型，拆成独立计划会引入重复定义与交叉依赖，因此保持为一个计划；执行时按任务边界分段提交。

## 2. 文件结构

### 后端新增文件

- Create: `src-tauri/src/domain/ai.rs`
  - AI profile、AI settings、测试结果、摘要请求/响应 DTO。
- Create: `src-tauri/src/commands/ai.rs`
  - 配置查询/保存、secret 写入、连通性测试、AI 摘要命令。
- Create: `src-tauri/src/services/ai/mod.rs`
  - AI 服务模块导出。
- Create: `src-tauri/src/services/ai/settings.rs`
  - settings 表读写、profile 组装。
- Create: `src-tauri/src/services/ai/secret_store.rs`
  - 系统密钥链读写、删除。
- Create: `src-tauri/src/services/ai/provider.rs`
  - ProviderAdapter trait 与公共请求/响应模型。
- Create: `src-tauri/src/services/ai/orchestrator.rs`
  - 统一超时、重试、错误映射。
- Create: `src-tauri/src/services/ai/providers/openai_compatible.rs`
  - OpenAI/OpenRouter/自定义 OpenAI-compatible 供应商。
- Create: `src-tauri/src/services/ai/providers/anthropic.rs`
  - Anthropic 供应商。
- Create: `src-tauri/src/services/summary_agent.rs`
  - 摘要上下文裁剪、AI 调用、规则回退。

### 后端修改文件

- Modify: `src-tauri/Cargo.toml`
  - 增加 `reqwest`、`keyring`，必要时增加 HTTP mock dev 依赖。
- Modify: `src-tauri/src/lib.rs`
  - 注册 AI 命令。
- Modify: `src-tauri/src/domain/mod.rs`
  - 导出 `ai` 模块。
- Modify: `src-tauri/src/commands/mod.rs`
  - 注册 `ai` 模块。
- Modify: `src-tauri/src/services/mod.rs`
  - 注册 `ai` 和 `summary_agent` 模块。
- Modify: `src-tauri/src/commands/summary.rs`
  - 复用恢复型 state guard，并桥接新的 AI 摘要命令或降级逻辑。
- Modify: `src-tauri/src/state.rs`
  - 如需共享 HTTP client，可在此挂载或提供初始化入口。

### 前端新增文件

- Create: `src/components/Settings/AiSettingsDialog.tsx`
  - AI 设置弹层主界面。
- Create: `src/components/Settings/AiSettingsDialog.test.tsx`
  - 设置交互单测。
- Create: `src/store/useAiSettingsStore.ts`
  - AI 设置加载、保存、连通性测试状态。
- Create: `src/store/useAiSettingsStore.test.ts`
  - store 行为单测。

### 前端修改文件

- Modify: `src/types/index.ts`
  - AI DTO 类型。
- Modify: `src/api/commands.ts`
  - AI 相关 invoke 封装。
- Modify: `src/menu/menuIds.ts`
  - 新增 AI 菜单 action id。
- Modify: `src/menu/menuSchema.ts`
  - 应用菜单新增“AI 设置”“测试模型连通性”“自动摘要 Agent”。
- Modify: `src/menu/menuActionRunner.ts`
  - 菜单动作处理器扩展。
- Modify: `src/components/AppShell.tsx`
  - 菜单事件派发与弹层挂载。
- Modify: `src/store/useAppStore.ts`
  - AI 设置弹层开关与错误状态（如果不使用独立 UI store 处理 UI 开关）。
- Modify: `src/hooks/useLookbackSummary.ts`
  - 根据 AI 配置优先调用 AI 摘要命令，失败时呈现降级提示。

### 测试与文档

- Modify: `src/menu/menuSchema.test.ts`
- Modify: `src/menu/menuActionRunner.test.ts`
- Modify: `src/menu/useAppMenu.test.tsx`
- Modify: `src/hooks/useLookbackSummary.test.tsx`
- Modify: `src/components/SearchOverlay.test.tsx`（只在需要确认摘要片段文案时变更）
- Create: `tests/e2e/ai-summary-agent.spec.ts` 或扩展 `tests/e2e/welcome.spec.ts`
- Modify: `README.md`（增加 AI 设置与安全说明）

## 3. Task 1: AI 设置数据底座

**Files:**
- Create: `src-tauri/src/domain/ai.rs`
- Create: `src-tauri/src/services/ai/settings.rs`
- Create: `src-tauri/src/commands/ai.rs`
- Modify: `src-tauri/src/domain/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api/commands.ts`
- Modify: `src/types/index.ts`
- Test: `src-tauri/src/services/ai/settings.rs`
- Test: `src-tauri/src/commands/ai.rs`

- [ ] **Step 1: 写失败测试，锁定 settings 表到 AI DTO 的映射**

```rust
#[cfg(test)]
mod tests {
    use super::{load_ai_settings, upsert_ai_profile};
    use crate::domain::ai::{AiProfileInput, AiProviderKind};
    use crate::infrastructure::db::open_and_migrate;
    use tempfile::tempdir;

    #[test]
    fn upsert_ai_profile_persists_non_secret_fields_into_settings() {
        let temp = tempdir().unwrap();
        let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

        let profile = AiProfileInput {
            id: None,
            name: "OpenAI Prod".into(),
            provider: AiProviderKind::OpenAiCompatible,
            model: "gpt-4.1-mini".into(),
            base_url: Some("https://api.openai.com/v1".into()),
            max_tokens: Some(240),
            temperature: Some(0.3),
            enabled: true,
        };

        let saved = upsert_ai_profile(&conn, profile).unwrap();
        let settings = load_ai_settings(&conn).unwrap();

        assert_eq!(settings.default_profile_id, None);
        assert_eq!(settings.profiles.len(), 1);
        assert_eq!(settings.profiles[0].id, saved.id);
        assert_eq!(settings.profiles[0].model, "gpt-4.1-mini");
        assert_eq!(settings.profiles[0].base_url.as_deref(), Some("https://api.openai.com/v1"));
    }
}
```

- [ ] **Step 2: 运行测试，确认当前缺少 AI settings 能力**

Run: `cd src-tauri && cargo test upsert_ai_profile_persists_non_secret_fields_into_settings -- --nocapture`
Expected: FAIL，报 `unresolved import crate::domain::ai` 或 `cannot find function upsert_ai_profile`。

- [ ] **Step 3: 写最小实现，建立 AI DTO、settings 读写和 Tauri 命令骨架**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderKind {
    OpenAiCompatible,
    Anthropic,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiSettings {
    pub enabled: bool,
    pub default_profile_id: Option<String>,
    pub profiles: Vec<AiProfile>,
}

#[tauri::command]
pub async fn get_ai_settings(state: State<'_, AppState>) -> Result<AiSettings, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    load_ai_settings(conn)
}
```

- [ ] **Step 4: 扩展前端类型和 invoke 桥，让前端能读取 AI settings**

```ts
export interface AiProfile {
  id: string;
  name: string;
  provider: "open_ai_compatible" | "anthropic";
  model: string;
  base_url: string | null;
  max_tokens: number | null;
  temperature: number | null;
  enabled: boolean;
}

export interface AiSettings {
  enabled: boolean;
  default_profile_id: string | null;
  profiles: AiProfile[];
}

getAiSettings: () => invoke<AiSettings>("get_ai_settings"),
upsertAiProfile: (input: AiProfileInput) => invoke<AiProfile>("upsert_ai_profile", { input }),
```

- [ ] **Step 5: 运行后端与前端窄验证**

Run: `cd src-tauri && cargo test upsert_ai_profile_persists_non_secret_fields_into_settings get_ai_settings -- --nocapture`
Expected: PASS

Run: `corepack pnpm vitest run src/api/commands.ts src/menu/menuSchema.test.ts`
Expected: PASS 或 0 tests for `src/api/commands.ts` 且无类型错误。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/domain/ai.rs src-tauri/src/services/ai/settings.rs src-tauri/src/commands/ai.rs src-tauri/src/domain/mod.rs src-tauri/src/commands/mod.rs src-tauri/src/services/mod.rs src-tauri/src/lib.rs src/types/index.ts src/api/commands.ts
git commit -m "feat: add ai settings contracts and commands"
```

## 4. Task 2: 密钥链与连通性测试

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/services/ai/secret_store.rs`
- Modify: `src-tauri/src/commands/ai.rs`
- Test: `src-tauri/src/services/ai/secret_store.rs`
- Test: `src-tauri/src/commands/ai.rs`

- [ ] **Step 1: 写失败测试，约束 secret 不进入 SQLite settings 表**

```rust
#[test]
fn setting_profile_secret_does_not_persist_plaintext_in_settings_table() {
    let temp = tempdir().unwrap();
    let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();

    save_setting(&conn, "ai_profile:test", "model", "gpt-4.1-mini").unwrap();
    persist_profile_secret("test", "sk-secret-value").unwrap();

    let stored: Vec<String> = conn
        .prepare("SELECT value FROM settings")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert!(!stored.iter().any(|value| value.contains("sk-secret-value")));
}
```

- [ ] **Step 2: 运行测试，确认 secret store 尚未实现**

Run: `cd src-tauri && cargo test setting_profile_secret_does_not_persist_plaintext_in_settings_table -- --nocapture`
Expected: FAIL，报 `cannot find function persist_profile_secret`。

- [ ] **Step 3: 加依赖并实现系统密钥链封装**

```toml
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
keyring = "3"
```

```rust
const SERVICE_NAME: &str = "mynote";

pub fn persist_profile_secret(profile_id: &str, secret: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("ai/{profile_id}/api_key"))
        .map_err(|error| AppError::InvalidInput(format!("Invalid keychain entry: {error}")))?;
    entry
        .set_password(secret)
        .map_err(|error| AppError::Internal(format!("Failed to write secret: {error}")))
}

pub fn load_profile_secret(profile_id: &str) -> Result<String, AppError> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("ai/{profile_id}/api_key"))
        .map_err(|error| AppError::InvalidInput(format!("Invalid keychain entry: {error}")))?;
    entry
        .get_password()
        .map_err(|_| AppError::InvalidInput("AI profile secret not configured".into()))
}
```

- [ ] **Step 4: 增加命令层 secret 保存和连通性测试骨架**

```rust
#[tauri::command]
pub async fn set_ai_profile_secret(
    input: AiProfileSecretInput,
) -> Result<(), AppError> {
    persist_profile_secret(&input.profile_id, &input.api_key)
}

#[tauri::command]
pub async fn test_ai_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<AiProfileTestResult, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    let profile = load_ai_profile(conn, &profile_id)?;

    Ok(AiProfileTestResult {
        ok: false,
        latency_ms: None,
        message: format!("Provider adapter for {} not wired yet", profile.model),
    })
}
```

- [ ] **Step 5: 运行窄测试，确认 secret 行为与命令签名稳定**

Run: `cd src-tauri && cargo test setting_profile_secret_does_not_persist_plaintext_in_settings_table set_ai_profile_secret -- --nocapture`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/services/ai/secret_store.rs src-tauri/src/commands/ai.rs
git commit -m "feat: add ai secret storage and connectivity command skeleton"
```

## 5. Task 3: Provider 适配层与统一调用网关

**Files:**
- Create: `src-tauri/src/services/ai/provider.rs`
- Create: `src-tauri/src/services/ai/orchestrator.rs`
- Create: `src-tauri/src/services/ai/providers/openai_compatible.rs`
- Create: `src-tauri/src/services/ai/providers/anthropic.rs`
- Modify: `src-tauri/src/services/ai/mod.rs`
- Modify: `src-tauri/src/commands/ai.rs`
- Test: `src-tauri/src/services/ai/orchestrator.rs`
- Test: `src-tauri/src/services/ai/providers/openai_compatible.rs`
- Test: `src-tauri/src/services/ai/providers/anthropic.rs`

- [ ] **Step 1: 写失败测试，锁定统一网关对 OpenAI-compatible 返回文本的抽象**

```rust
#[tokio::test]
async fn orchestrator_returns_text_from_openai_compatible_response() {
    let server = httpmock::MockServer::start();
    let mock = server.mock(|when, then| {
        when.method("POST").path("/v1/chat/completions");
        then.status(200)
            .header("content-type", "application/json")
            .body(r#"{
                "id":"chatcmpl_1",
                "choices":[{"message":{"content":"这是一条自然的摘要"}}],
                "usage":{"prompt_tokens":12,"completion_tokens":9}
            }"#);
    });

    let response = invoke_provider(
        test_openai_profile(server.url("/v1")),
        AiTextRequest::summary("请总结", "正文内容")
    ).await.unwrap();

    mock.assert();
    assert_eq!(response.text, "这是一条自然的摘要");
    assert_eq!(response.usage.output_tokens, Some(9));
}
```

- [ ] **Step 2: 运行测试，确认 provider/orchestrator 仍未存在**

Run: `cd src-tauri && cargo test orchestrator_returns_text_from_openai_compatible_response -- --nocapture`
Expected: FAIL，报 `cannot find function invoke_provider`。

- [ ] **Step 3: 定义统一 ProviderAdapter trait 和公共请求/响应**

```rust
#[async_trait::async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn supports(&self, provider: &AiProviderKind) -> bool;
    async fn invoke(
        &self,
        profile: &AiProfile,
        secret: &str,
        request: &AiTextRequest,
    ) -> Result<AiTextResponse, AppError>;
}

#[derive(Debug, Clone)]
pub struct AiTextRequest {
    pub system_prompt: String,
    pub user_prompt: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct AiTextResponse {
    pub text: String,
    pub usage: AiUsage,
    pub latency_ms: u128,
}
```

- [ ] **Step 4: 先实现 OpenAI-compatible，再补 Anthropic，并在 orchestrator 中统一超时/错误映射**

```rust
pub async fn invoke_provider(
    profile: AiProfile,
    secret: String,
    request: AiTextRequest,
) -> Result<AiTextResponse, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| AppError::Internal(format!("Failed to build HTTP client: {error}")))?;

    match profile.provider {
        AiProviderKind::OpenAiCompatible => openai_compatible::invoke(&client, &profile, &secret, &request).await,
        AiProviderKind::Anthropic => anthropic::invoke(&client, &profile, &secret, &request).await,
    }
}
```

- [ ] **Step 5: 把 test_ai_profile 接到真实调用，返回耗时与可读错误**

```rust
#[tauri::command]
pub async fn test_ai_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<AiProfileTestResult, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    let profile = load_ai_profile(conn, &profile_id)?;
    let secret = load_profile_secret(&profile.id)?;
    let response = invoke_provider(
        profile,
        secret,
        AiTextRequest::healthcheck(),
    ).await?;

    Ok(AiProfileTestResult {
        ok: true,
        latency_ms: Some(response.latency_ms as u64),
        message: "连接成功".into(),
    })
}
```

- [ ] **Step 6: 运行 provider 窄测试**

Run: `cd src-tauri && cargo test orchestrator_returns_text_from_openai_compatible_response test_ai_profile -- --nocapture`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/services/ai/provider.rs src-tauri/src/services/ai/orchestrator.rs src-tauri/src/services/ai/providers/openai_compatible.rs src-tauri/src/services/ai/providers/anthropic.rs src-tauri/src/services/ai/mod.rs src-tauri/src/commands/ai.rs
git commit -m "feat: add ai provider adapters and orchestrator"
```

## 6. Task 4: 自动摘要 Agent 后端接线

**Files:**
- Create: `src-tauri/src/services/summary_agent.rs`
- Modify: `src-tauri/src/commands/summary.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/commands/ai.rs`
- Test: `src-tauri/src/services/summary_agent.rs`
- Test: `src-tauri/src/commands/summary.rs`

- [ ] **Step 1: 写失败测试，锁定 AI 摘要失败时回退规则摘要且不阻断保存链路**

```rust
#[test]
fn generate_summary_candidate_with_ai_falls_back_to_rule_summary_when_provider_fails() {
    let content = "# 标题\n\n这是第一段内容，用于提供回退摘要。";
    let profile = test_ai_profile_disabled();

    let result = generate_summary_candidate_with_ai_inner(
        content,
        "标题",
        Some(profile),
        Err(AppError::InvalidInput("quota exceeded".into())),
    ).unwrap();

    assert!(result.used_fallback);
    assert_eq!(result.summary, "这是第一段内容，用于提供回退摘要。");
}
```

- [ ] **Step 2: 运行测试，确认 summary agent 尚不存在**

Run: `cd src-tauri && cargo test generate_summary_candidate_with_ai_falls_back_to_rule_summary_when_provider_fails -- --nocapture`
Expected: FAIL，报 `cannot find function generate_summary_candidate_with_ai_inner`。

- [ ] **Step 3: 实现摘要上下文裁剪、统一 prompt 与回退逻辑**

```rust
pub struct SummaryGenerationResult {
    pub summary: String,
    pub used_fallback: bool,
    pub provider_trace: Option<AiProviderTrace>,
}

pub fn build_summary_prompt(title: &str, content: &str) -> AiTextRequest {
    AiTextRequest {
        system_prompt: "你是一个中文知识库摘要助手。输出 1 段自然、可回看的摘要，不要模板化开头。".into(),
        user_prompt: format!(
            "标题：{title}\n\n正文（已裁剪）：\n{}",
            trim_summary_context(content, 2400)
        ),
        temperature: Some(0.4),
        max_tokens: Some(180),
    }
}

pub fn finalize_summary(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").trim().chars().take(180).collect()
}
```

- [ ] **Step 4: 增加新命令 generate_summary_candidate_with_ai，并复用恢复型 state guard**

```rust
#[tauri::command]
pub async fn generate_summary_candidate_with_ai(
    state: State<'_, AppState>,
    path: String,
    profile_id: Option<String>,
) -> Result<SummaryGenerationResult, AppError> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    generate_summary_candidate_with_ai_for_root(conn, root, &path, profile_id.as_deref()).await
}
```

- [ ] **Step 5: 运行摘要后端窄测试**

Run: `cd src-tauri && cargo test generate_summary_candidate_with_ai_falls_back_to_rule_summary_when_provider_fails save_note_summary -- --nocapture`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/summary_agent.rs src-tauri/src/commands/summary.rs src-tauri/src/services/mod.rs src-tauri/src/commands/ai.rs
git commit -m "feat: add ai summary agent with fallback"
```

## 7. Task 5: 前端菜单、状态与设置入口

**Files:**
- Create: `src/store/useAiSettingsStore.ts`
- Create: `src/store/useAiSettingsStore.test.ts`
- Modify: `src/menu/menuIds.ts`
- Modify: `src/menu/menuSchema.ts`
- Modify: `src/menu/menuActionRunner.ts`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/store/useAppStore.ts`
- Modify: `src/api/commands.ts`
- Modify: `src/types/index.ts`
- Test: `src/menu/menuSchema.test.ts`
- Test: `src/menu/menuActionRunner.test.ts`
- Test: `src/menu/useAppMenu.test.tsx`

- [ ] **Step 1: 写失败测试，锁定 AI 菜单项出现在应用菜单中**

```ts
it("includes AI settings and connectivity actions in the help-adjacent menu", () => {
  const schema = buildAppMenuSchema({
    hasKnowledgeBase: true,
    hasCurrentNote: true,
    leftSidebarVisible: true,
    rightSidebarVisible: false,
    editorMode: "split",
  });

  expect(schema).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "工具",
        children: expect.arrayContaining([
          expect.objectContaining({ id: "tools.aiSettings", label: "AI 设置" }),
          expect.objectContaining({ id: "tools.testAiProfile", label: "测试模型连通性" }),
        ]),
      }),
    ]),
  );
});
```

- [ ] **Step 2: 运行测试，确认新菜单 action 尚不存在**

Run: `corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts`
Expected: FAIL，报 `tools.aiSettings` 未定义或 schema 不匹配。

- [ ] **Step 3: 扩展菜单 ID、schema、action runner 和 UI store**

```ts
export const APP_MENU_IDS = ["file", "edit", "view", "note", "tools", "help"] as const;

export const MENU_ACTION_IDS = [
  "tools.aiSettings",
  "tools.testAiProfile",
  "tools.toggleSummaryAgent",
] as const;
```

```ts
interface AppState {
  aiSettingsOpen: boolean;
  setAiSettingsOpen: (open: boolean) => void;
}

setAiSettingsOpen: (open) => set({ aiSettingsOpen: open }),
```

- [ ] **Step 4: 新建 AI settings store，收敛加载、保存、测试连通性状态**

```ts
export const useAiSettingsStore = create<AiSettingsState>((set) => ({
  settings: null,
  loading: false,
  saving: false,
  testingProfileId: null,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await api.getAiSettings();
      set({ settings, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },
}));
```

- [ ] **Step 5: 运行前端窄测试**

Run: `corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts src/menu/useAppMenu.test.tsx src/store/useAiSettingsStore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/menu/menuIds.ts src/menu/menuSchema.ts src/menu/menuActionRunner.ts src/components/AppShell.tsx src/store/useAppStore.ts src/store/useAiSettingsStore.ts src/store/useAiSettingsStore.test.ts src/types/index.ts src/api/commands.ts
git commit -m "feat: add ai menu actions and frontend settings store"
```

## 8. Task 6: AI 设置页与摘要交互落地

**Files:**
- Create: `src/components/Settings/AiSettingsDialog.tsx`
- Create: `src/components/Settings/AiSettingsDialog.test.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/hooks/useLookbackSummary.ts`
- Modify: `src/hooks/useLookbackSummary.test.tsx`
- Modify: `src/test/setup.ts`
- Test: `src/components/Settings/AiSettingsDialog.test.tsx`
- Test: `src/hooks/useLookbackSummary.test.tsx`

- [ ] **Step 1: 写失败测试，锁定设置弹层和 AI 摘要优先级**

```ts
it("opens AI settings dialog from menu action", async () => {
  useAppStore.setState({ aiSettingsOpen: true });
  render(<AppShell />);
  expect(screen.getByRole("dialog", { name: "AI 设置" })).toBeInTheDocument();
});

it("prefers AI summary generation when AI is enabled and profile exists", async () => {
  vi.mocked(api.generateSummaryCandidateWithAi).mockResolvedValue({
    summary: "更自然的摘要",
    used_fallback: false,
    provider_trace: null,
  });

  const hook = renderHook(() => useLookbackSummary());
  await act(async () => {
    await hook.result.current.generateCandidate();
  });

  expect(api.generateSummaryCandidateWithAi).toHaveBeenCalledWith("notes/demo.md", undefined);
  expect(api.generateSummaryCandidate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试，确认对话框和 AI 摘要桥接尚未完成**

Run: `corepack pnpm vitest run src/components/Settings/AiSettingsDialog.test.tsx src/hooks/useLookbackSummary.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 AI 设置弹层，先覆盖最小可用配置流**

```tsx
export function AiSettingsDialog() {
  const open = useAppStore((state) => state.aiSettingsOpen);
  const setOpen = useAppStore((state) => state.setAiSettingsOpen);
  const { settings, load, saveProfile, testProfile, saving, testingProfileId } = useAiSettingsStore();

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [load, open]);

  if (!open) {
    return null;
  }

  return (
    <div role="dialog" aria-label="AI 设置">
      <h2>AI 设置</h2>
      <button onClick={() => setOpen(false)}>关闭</button>
      <button disabled={saving} onClick={() => void saveProfile(draft)}>保存配置</button>
      <button disabled={testingProfileId === draft.id} onClick={() => void testProfile(draft.id)}>测试模型连通性</button>
    </div>
  );
}
```

- [ ] **Step 4: 调整 useLookbackSummary，在启用 AI 时优先走新命令并展示降级状态**

```ts
const aiSettings = useAiSettingsStore((state) => state.settings);

const aiEnabled = Boolean(aiSettings?.enabled && aiSettings.default_profile_id);

const generation = aiEnabled
  ? await api.generateSummaryCandidateWithAi(notePath, aiSettings?.default_profile_id ?? undefined)
  : { summary: await api.generateSummaryCandidate(notePath), used_fallback: false, provider_trace: null };

setCandidate(generation.summary);
if (generation.used_fallback) {
  setError("AI 摘要生成失败，已自动回退到规则摘要");
}
```

- [ ] **Step 5: 运行前端交互窄测试**

Run: `corepack pnpm vitest run src/components/Settings/AiSettingsDialog.test.tsx src/hooks/useLookbackSummary.test.tsx src/menu/*.test.ts src/menu/*.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/AiSettingsDialog.tsx src/components/Settings/AiSettingsDialog.test.tsx src/components/AppShell.tsx src/hooks/useLookbackSummary.ts src/hooks/useLookbackSummary.test.tsx src/test/setup.ts
git commit -m "feat: add ai settings dialog and ai summary flow"
```

## 9. Task 7: 端到端验证与收口

**Files:**
- Create: `tests/e2e/ai-summary-agent.spec.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-06-llm-summary-agent-design.md`（仅在实现后回填偏差）

- [ ] **Step 1: 写 e2e 失败用例，覆盖配置到摘要生成主链路**

```ts
import { test, expect } from "@playwright/test";

test("configure ai profile and generate summary with fallback-safe flow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("menuitem", { name: "AI 设置" }).click();
  await page.getByRole("textbox", { name: "配置名称" }).fill("OpenAI Test");
  await page.getByRole("textbox", { name: "模型" }).fill("gpt-4.1-mini");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByText("保存成功")).toBeVisible();
});
```

- [ ] **Step 2: 运行 e2e，确认失败点与测试环境需求清晰**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm test:e2e --grep "configure ai profile"`
Expected: FAIL，若当前 Playwright 菜单驱动困难，则至少能进入配置弹层并暴露缺失选择器。

- [ ] **Step 3: 补 README 的 AI 配置、安全和供应商说明**

```md
## AI 设置

MyNote 通过 Tauri 后端代理调用大模型供应商。

- API Key 不写入 SQLite，仅存放于系统密钥链。
- 当前内置 OpenAI-compatible 与 Anthropic。
- 当 AI 摘要失败时，应用会自动回退到本地规则摘要，不阻塞正常写作。
```

- [ ] **Step 4: 运行完整验证命令**

Run: `corepack pnpm vitest run src/menu/*.test.ts src/menu/*.test.tsx src/components/Settings/*.test.tsx src/hooks/useLookbackSummary.test.tsx`
Expected: PASS

Run: `corepack pnpm build`
Expected: PASS

Run: `cd src-tauri && cargo test`
Expected: PASS

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm test:e2e`
Expected: PASS 或明确记录因 Tauri 原生菜单限制导致的剩余自动化空白。

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ai-summary-agent.spec.ts README.md docs/superpowers/specs/2026-06-06-llm-summary-agent-design.md
git commit -m "test: verify ai summary agent end to end"
```

## 10. 自检

### Spec coverage

- 菜单与配置 UX：Task 5、Task 6 覆盖。
- 供应商适配与统一调用：Task 3 覆盖。
- 系统密钥链与非敏感 settings：Task 1、Task 2 覆盖。
- 自动摘要 Agent、上下文裁剪、失败回退：Task 4、Task 6 覆盖。
- 安全与可观测性：Task 2、Task 3、Task 4 覆盖。
- 文档与验收：Task 7 覆盖。

### Placeholder scan

已检查并去除 `TODO`、`TBD`、`类似 Task N`、`自行补测试` 之类占位语句。

### Type consistency

- `AiProviderKind` 在后端与前端通过 snake_case 字符串对齐。
- `AiSettings` / `AiProfile` / `AiProfileTestResult` 命名在前后端保持一致。
- AI 摘要命令统一采用 `generate_summary_candidate_with_ai`。

Plan complete and saved to `docs/superpowers/plans/2026-06-06-llm-summary-agent.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

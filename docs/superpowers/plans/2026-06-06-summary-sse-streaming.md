# 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-06 | v1.0 | 初版：移除摘要硬截断并将假流式改为真实 SSE token 流 |

# 目录

- [摘要 SSE Streaming Implementation Plan](#摘要-sse-streaming-implementation-plan)
- [Task 1: 锁定摘要不再被硬截断](#task-1-锁定摘要不再被硬截断)
- [Task 2: 锁定真实流式事件协议](#task-2-锁定真实流式事件协议)
- [Task 3: 后端摘要命令改为 SSE 事件流](#task-3-后端摘要命令改为-sse-事件流)
- [Task 4: 前端接入真实 token 流](#task-4-前端接入真实-token-流)
- [Task 5: 聚焦验证](#task-5-聚焦验证)

# 摘要 SSE Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除摘要生成链路中的硬编码字数截断，并把当前前端假流式过渡为后端真实 SSE token 流。

**Architecture:** 后端在 provider/orchestrator 层增加统一的流式文本事件接口，摘要命令通过 Tauri 事件把 token 增量推送到前端；前端 hook 从一次性 await 返回切换为订阅事件并实时拼接 candidate。规则摘要与 AI 摘要都不再做固定字符裁剪，字数控制仅保留在提示词层。

**Tech Stack:** Rust, Tauri events, reqwest streaming, React hooks, Vitest, cargo test

---

### Task 1: 锁定摘要不再被硬截断

**Files:**
- Modify: `src-tauri/src/services/summary_agent.rs`
- Modify: `src-tauri/src/services/summary.rs`
- Test: `src-tauri/src/services/summary_agent.rs`
- Test: `src-tauri/src/services/summary.rs`

- [ ] **Step 1: 写失败测试，证明提示词写成 500 但后端仍然会在代码层截断**

```rust
#[test]
fn finalize_summary_preserves_longer_ai_output_without_hard_cap() {
    let long_summary = "摘".repeat(240);

    assert_eq!(finalize_summary(&long_summary).chars().count(), 240);
}

#[test]
fn build_summary_prompt_does_not_force_request_max_tokens() {
    let profile = crate::domain::ai::AiProfile {
        id: "profile-1".into(),
        name: "Default".into(),
        provider: AiProviderKind::Anthropic,
        model: "claude-sonnet".into(),
        base_url: None,
        max_tokens: Some(1024),
        temperature: Some(0.4),
        enabled: true,
    };

    let request = build_summary_prompt(&profile, "# 标题\n\n正文第一段。", "标题").unwrap();

    assert_eq!(request.max_tokens, None);
}

#[test]
fn build_summary_candidate_does_not_hard_truncate_rule_summary() {
    let content = format!("# Demo\n\n{}", "这是一段很长的正文。".repeat(80));
    let candidate = build_summary_candidate(&content, "Demo").unwrap();

    assert!(candidate.chars().count() > 200);
}
```

- [ ] **Step 2: 运行失败测试确认当前实现仍有硬截断**

Run: `cd /Users/lijun/mynote && cargo test --manifest-path src-tauri/Cargo.toml finalize_summary_preserves_longer_ai_output_without_hard_cap build_summary_prompt_does_not_force_request_max_tokens build_summary_candidate_does_not_hard_truncate_rule_summary`
Expected: FAIL，分别卡在 `take(MAX_SUMMARY_CHARS)` 和 `request.max_tokens = Some(...)`

- [ ] **Step 3: 写最小实现，移除摘要链路的硬截断与固定 max_tokens**

```rust
pub fn build_summary_prompt(...) -> AppResult<AiTextRequest> {
    ...
    Ok(AiTextRequest {
        prompt: format!(...),
        max_tokens: None,
        temperature: Some(0.4),
        expected_text: None,
    })
}

pub fn finalize_summary(text: &str) -> String {
    let normalized = ...;
    normalized
}

pub fn build_summary_candidate(content: &str, fallback_title: &str) -> AppResult<String> {
    ...
    if normalized.is_empty() {
        Ok(parsed.title)
    } else {
        Ok(normalized)
    }
}
```

- [ ] **Step 4: 运行同一组测试确认通过**

Run: `cd /Users/lijun/mynote && cargo test --manifest-path src-tauri/Cargo.toml finalize_summary_preserves_longer_ai_output_without_hard_cap build_summary_prompt_does_not_force_request_max_tokens build_summary_candidate_does_not_hard_truncate_rule_summary`
Expected: PASS

### Task 2: 锁定真实流式事件协议

**Files:**
- Modify: `src/hooks/useLookbackSummary.test.tsx`
- Modify: `src/api/commands.ts`
- Test: `src/hooks/useLookbackSummary.test.tsx`

- [ ] **Step 1: 写失败测试，要求前端消费 token 事件而不是等待一次性结果**

```ts
it("consumes streamed summary tokens from backend events", async () => {
  const events: Array<(payload: { requestId: string; type: string; chunk?: string; done?: boolean }) => void> = [];
  listenMock.mockImplementation(async (_event, handler) => {
    events.push((payload) => handler({ payload } as never));
    return vi.fn();
  });
  apiMocks.generateSummaryCandidateWithAiStream.mockResolvedValue({ requestId: "req-1" });

  const { result } = renderHook(() => useLookbackSummary());

  await act(async () => {
    void result.current.generateCandidate();
    await Promise.resolve();
  });

  act(() => {
    events[0]?.({ requestId: "req-1", type: "delta", chunk: "第一段" });
    events[0]?.({ requestId: "req-1", type: "delta", chunk: "第二段" });
  });

  expect(result.current.candidate).toBe("第一段第二段");
  expect(result.current.isGenerating).toBe(true);
});
```

- [ ] **Step 2: 运行单测确认当前前端仍依赖假流式**

Run: `cd /Users/lijun/mynote && corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx -t "consumes streamed summary tokens from backend events"`
Expected: FAIL，缺少新的 API 和事件监听逻辑

### Task 3: 后端摘要命令改为 SSE 事件流

**Files:**
- Modify: `src-tauri/src/domain/ai.rs`
- Modify: `src-tauri/src/services/ai/provider.rs`
- Modify: `src-tauri/src/services/ai/orchestrator.rs`
- Modify: `src-tauri/src/services/ai/providers/openai_compatible.rs`
- Modify: `src-tauri/src/services/ai/providers/anthropic.rs`
- Modify: `src-tauri/src/services/summary_agent.rs`
- Modify: `src-tauri/src/commands/summary.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/services/ai/orchestrator.rs`
- Test: `src-tauri/src/services/ai/providers/openai_compatible.rs`
- Test: `src-tauri/src/services/ai/providers/anthropic.rs`
- Test: `src-tauri/src/services/summary_agent.rs`

- [ ] **Step 1: 定义统一的流式事件类型与 provider trait**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AiTextStreamEvent {
    Delta { chunk: String },
    Completed {
        text: String,
        input_tokens: Option<u32>,
        output_tokens: Option<u32>,
        total_tokens: Option<u32>,
    },
}

#[async_trait]
pub trait AiProviderAdapter {
    async fn invoke(... ) -> AppResult<AiTextResponse>;
    async fn invoke_stream(
        &self,
        client: &Client,
        profile: &AiProfile,
        api_key: &str,
        request: &AiTextRequest,
        on_event: &mut (dyn FnMut(AiTextStreamEvent) -> AppResult<()> + Send),
    ) -> AppResult<AiTextResponse>;
}
```

- [ ] **Step 2: 在 OpenAI-compatible provider 中解析 SSE data 帧**

```rust
let mut response_stream = response.bytes_stream();
while let Some(chunk) = response_stream.next().await {
    buffer.push_str(std::str::from_utf8(&chunk?)?);
    while let Some(frame) = take_next_sse_frame(&mut buffer) {
        if let Some(delta) = parse_openai_delta(&frame)? {
            full_text.push_str(&delta);
            on_event(AiTextStreamEvent::Delta { chunk: delta })?;
        }
    }
}
on_event(AiTextStreamEvent::Completed { text: full_text.clone(), ... })?;
```

- [ ] **Step 3: 在 Anthropic provider 中解析 SSE event/data 帧**

```rust
match payload.event.as_deref() {
    Some("content_block_delta") => {
        if let Some(delta) = payload.delta.and_then(|value| value.text) {
            full_text.push_str(&delta);
            on_event(AiTextStreamEvent::Delta { chunk: delta })?;
        }
    }
    Some("message_delta") => { ...usage... }
    Some("message_stop") => break,
    _ => {}
}
```

- [ ] **Step 4: 在 orchestrator 和摘要命令层把 token 事件通过 Tauri emit 推给前端**

```rust
let event_name = format!("summary:stream:{}", request_id);
orchestrator
    .invoke_text_stream(&profile, &api_key, &request, |event| {
        app_handle.emit(&event_name, &event)
            .map_err(|error| AppError::Io(format!("Failed to emit summary stream event: {error}")))
    })
    .await?;
```

- [ ] **Step 5: 运行后端聚焦测试确认流式协议通过**

Run: `cd /Users/lijun/mynote && cargo test --manifest-path src-tauri/Cargo.toml services::ai::providers::openai_compatible::tests services::ai::providers::anthropic::tests services::ai::orchestrator::tests services::summary_agent::tests`
Expected: PASS

### Task 4: 前端接入真实 token 流

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Modify: `src/hooks/useLookbackSummary.ts`
- Modify: `src/hooks/useLookbackSummary.test.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`

- [ ] **Step 1: 扩展前端类型与 API，返回 requestId 而不是最终摘要**

```ts
export interface SummaryGenerationStreamStart {
  requestId: string;
}

export interface SummaryStreamEvent {
  requestId: string;
  type: "delta" | "completed" | "error";
  chunk?: string;
  summary?: string;
  error?: string | null;
  used_fallback?: boolean;
  provider_trace?: AiProviderTrace | null;
}

generateSummaryCandidateWithAiStream: (path: string, profileId?: string) =>
  invoke<SummaryGenerationStreamStart>("generate_summary_candidate_with_ai_stream", { path, profileId }),
```

- [ ] **Step 2: 在 hook 中订阅 `summary:stream:<requestId>`，按 token 实时累积 candidate**

```ts
const unlisten = await listen<SummaryStreamEvent>(`summary:stream:${requestId}`, (event) => {
  if (event.payload.type === "delta") {
    setCandidate((current) => current + (event.payload.chunk ?? ""));
    return;
  }
  if (event.payload.type === "completed") {
    setGenerationStatus(event.payload.used_fallback ? formatSummaryFallbackStatus(...) : null);
    setIsGenerating(false);
  }
});
```

- [ ] **Step 3: 删除当前假流式定时分帧逻辑**

```ts
// remove SUMMARY_STREAM_FRAME_COUNT
// remove SUMMARY_STREAM_INTERVAL_MS
// remove buildSummaryStreamFrames
// remove waitForSummaryFrame
// remove streamGeneratedCandidate
```

- [ ] **Step 4: 运行前端摘要 hook 测试确认通过**

Run: `cd /Users/lijun/mynote && corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx`
Expected: PASS

### Task 5: 聚焦验证

**Files:**
- Modify: `src/hooks/useLookbackSummary.test.tsx`
- Modify: `src-tauri/src/services/summary_agent.rs`
- Modify: `src-tauri/src/services/summary.rs`

- [ ] **Step 1: 跑完整摘要链路测试**

Run: `cd /Users/lijun/mynote && corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx && cargo test --manifest-path src-tauri/Cargo.toml services::summary_agent::tests && cargo test --manifest-path src-tauri/Cargo.toml services::summary::tests && cargo test --manifest-path src-tauri/Cargo.toml services::ai::providers::openai_compatible::tests && cargo test --manifest-path src-tauri/Cargo.toml services::ai::providers::anthropic::tests && cargo test --manifest-path src-tauri/Cargo.toml services::ai::orchestrator::tests`
Expected: 全部 PASS

- [ ] **Step 2: 记录最终行为确认点**

```text
1. 修改提示词中的 500 字约束不会再被代码层 200 字硬截断覆盖。
2. 前端摘要文本来自后端 token 流实时累积，不再是本地假动画。
3. AI 失败时回退状态仍可见，但不会因为固定字符裁剪把长摘要截短。
```
# 修订记录

- 2026-06-06：创建摘要真 SSE 流与去硬截断实施计划。

# 目录

- [摘要真 SSE 流与去硬截断 Implementation Plan](#摘要真-sse-流与去硬截断-implementation-plan)
- [Task 1: 锁定当前失败行为](#task-1-锁定当前失败行为)
- [Task 2: 去掉后端硬截断](#task-2-去掉后端硬截断)
- [Task 3: Provider 与 Orchestrator 增加流式接口](#task-3-provider-与-orchestrator-增加流式接口)
- [Task 4: 摘要命令与前端接入真流式](#task-4-摘要命令与前端接入真流式)
- [Task 5: 聚焦验证](#task-5-聚焦验证)

# 摘要真 SSE 流与去硬截断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉摘要链路里的硬编码长度截断，并把当前假的前端分帧展示替换成基于 provider SSE token 的真实流式摘要生成。

**Architecture:** 保留现有摘要命令入口和回退语义，但把 AI 调用从一次性 invoke_text 扩展为 stream_text。后端 provider 负责解析 OpenAI-compatible 与 Anthropic 的 SSE 事件，summary command 通过 Tauri 事件向前端逐 token 发流，前端 hook 订阅事件并实时更新 candidate。

**Tech Stack:** React 19 + Vitest, Tauri 2, Rust, reqwest SSE-by-line parsing, tauri event emit/listen.

---

### Task 1: 锁定当前失败行为

**Files:**
- Modify: `src/hooks/useLookbackSummary.test.tsx`
- Modify: `src-tauri/src/services/summary_agent.rs`
- Modify: `src-tauri/src/services/summary.rs`

- [ ] **Step 1: 写前端失败测试，要求真流式逐 token 更新而不是等待最终结果**

```ts
it("updates the candidate from streamed AI tokens before the stream completes", async () => {
  // mock stream start, token events, and finish event
  // expect candidate to equal partial content before completion
});
```

- [ ] **Step 2: 跑前端单测确认当前实现失败**

Run: `corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx -t "updates the candidate from streamed AI tokens before the stream completes"`
Expected: FAIL，因为当前实现只在拿到完整 summary 后才更新。

- [ ] **Step 3: 写 Rust 失败测试，要求摘要 prompt 不再覆盖 max_tokens，AI 输出不再被本地 take 截断**

```rust
#[test]
fn build_summary_prompt_does_not_force_summary_max_tokens() {
    assert_eq!(request.max_tokens, None);
}

#[test]
fn finalize_summary_keeps_long_ai_output_without_hard_truncation() {
    assert_eq!(finalize_summary(&"摘".repeat(240)).chars().count(), 240);
}
```

- [ ] **Step 4: 跑 Rust 单测确认当前实现失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml build_summary_prompt_does_not_force_summary_max_tokens finalize_summary_keeps_long_ai_output_without_hard_truncation`
Expected: FAIL，因为当前 summary_agent 仍写死 200。

### Task 2: 去掉后端硬截断

**Files:**
- Modify: `src-tauri/src/services/summary_agent.rs`
- Modify: `src-tauri/src/services/summary.rs`

- [ ] **Step 1: 删除 AI 摘要链路中的固定 MAX_SUMMARY_CHARS 依赖**

```rust
pub fn build_summary_prompt(...) -> AppResult<AiTextRequest> {
    Ok(AiTextRequest {
        prompt: format!(/* 仅在提示词里写长度约束 */),
        max_tokens: None,
        temperature: Some(0.4),
        expected_text: None,
    })
}

pub fn finalize_summary(text: &str) -> String {
    normalize_summary_text(text)
}
```

- [ ] **Step 2: 删除规则回退摘要的本地 200 字截断**

```rust
let normalized = candidate.split_whitespace().collect::<Vec<_>>().join(" ");
if normalized.is_empty() { Ok(parsed.title) } else { Ok(normalized) }
```

- [ ] **Step 3: 跑 Task 1 的 Rust 用例确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml build_summary_prompt_does_not_force_summary_max_tokens finalize_summary_keeps_long_ai_output_without_hard_truncation`
Expected: PASS

### Task 3: Provider 与 Orchestrator 增加流式接口

**Files:**
- Modify: `src-tauri/src/domain/ai.rs`
- Modify: `src-tauri/src/services/ai/provider.rs`
- Modify: `src-tauri/src/services/ai/orchestrator.rs`
- Modify: `src-tauri/src/services/ai/providers/openai_compatible.rs`
- Modify: `src-tauri/src/services/ai/providers/anthropic.rs`

- [ ] **Step 1: 定义流式事件与 provider 流接口**

```rust
pub struct AiTextStreamChunk {
    pub delta: String,
    pub done: bool,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
}
```

- [ ] **Step 2: 在 provider trait 中增加 stream 调用**

```rust
#[async_trait]
pub trait AiProviderAdapter {
    async fn invoke(... ) -> AppResult<AiTextResponse>;
    async fn stream(
        &self,
        client: &Client,
        profile: &AiProfile,
        api_key: &str,
        request: &AiTextRequest,
        on_chunk: &mut (dyn FnMut(AiTextStreamChunk) -> AppResult<()> + Send),
    ) -> AppResult<AiTextResponse>;
}
```

- [ ] **Step 3: 在 OpenAI-compatible provider 解析 chat completions SSE**

```rust
// POST body includes "stream": true
// parse lines prefixed with `data:`
// accumulate delta from choices[0].delta.content
```

- [ ] **Step 4: 在 Anthropic provider 解析 messages SSE**

```rust
// header accept: text/event-stream
// handle content_block_delta, message_delta, message_stop
// append delta.text into buffer
```

- [ ] **Step 5: 在 orchestrator 暴露 stream_text**

```rust
pub async fn stream_text(&self, ..., on_chunk: &mut ...) -> AppResult<AiTextResponse>
```

- [ ] **Step 6: 跑 provider/orchestrator 新增单测**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::ai::providers::openai_compatible::tests services::ai::providers::anthropic::tests services::ai::orchestrator::tests`
Expected: PASS

### Task 4: 摘要命令与前端接入真流式

**Files:**
- Modify: `src-tauri/src/commands/summary.rs`
- Modify: `src-tauri/src/services/summary_agent.rs`
- Modify: `src/api/commands.ts`
- Modify: `src/types/index.ts`
- Modify: `src/hooks/useLookbackSummary.ts`
- Modify: `src/hooks/useLookbackSummary.test.tsx`

- [ ] **Step 1: 定义摘要流事件 payload 并在 summary command 中发事件**

```rust
#[derive(Serialize, Clone)]
struct SummaryStreamEvent {
    request_id: String,
    path: String,
    delta: String,
    done: bool,
    used_fallback: bool,
    provider_trace: Option<AiProviderTrace>,
    error: Option<String>,
}
```

- [ ] **Step 2: 新增返回 request_id 的启动命令，生成过程通过事件发 token**

```rust
#[tauri::command]
pub async fn generate_summary_candidate_with_ai_stream(...) -> Result<String, AppError>
```

- [ ] **Step 3: 前端 API 暴露新的 stream 启动命令**

```ts
generateSummaryCandidateWithAiStream: (path: string, profileId?: string) =>
  invoke<string>("generate_summary_candidate_with_ai_stream", { path, profileId })
```

- [ ] **Step 4: useLookbackSummary 订阅 tauri 事件并实时累积 candidate**

```ts
const unlisten = await listen<SummaryStreamEvent>("summary:token", (event) => {
  if (event.payload.request_id !== requestIdRef.current) return;
  setCandidate((current) => current + event.payload.delta);
});
```

- [ ] **Step 5: 删除前端假流式逻辑**

```ts
// remove SUMMARY_STREAM_FRAME_COUNT
// remove buildSummaryStreamFrames
// remove waitForSummaryFrame
// remove streamGeneratedCandidate
```

- [ ] **Step 6: 跑 Task 1 的前端用例确认通过**

Run: `corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx -t "updates the candidate from streamed AI tokens before the stream completes"`
Expected: PASS

### Task 5: 聚焦验证

**Files:**
- Modify: `src/hooks/useLookbackSummary.test.tsx`
- Modify: `src-tauri/src/services/summary_agent.rs`
- Modify: `src-tauri/src/services/summary.rs`
- Modify: `src-tauri/src/services/ai/orchestrator.rs`
- Modify: `src-tauri/src/services/ai/providers/openai_compatible.rs`
- Modify: `src-tauri/src/services/ai/providers/anthropic.rs`

- [ ] **Step 1: 跑完整前端摘要 hook 测试**

Run: `corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx`
Expected: PASS

- [ ] **Step 2: 跑摘要与 AI provider 相关 Rust 测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::summary_agent::tests services::summary::tests services::ai::providers::openai_compatible::tests services::ai::providers::anthropic::tests services::ai::orchestrator::tests`
Expected: PASS

- [ ] **Step 3: 跑构建确认类型与命令签名无回归**

Run: `corepack pnpm build`
Expected: build succeeds

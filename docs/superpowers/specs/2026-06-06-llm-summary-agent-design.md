# MyNote LLM 接入与自动摘要 Agent 设计

## 修订记录

| 日期 | 版本 | 作者 | 说明 |
| --- | --- | --- | --- |
| 2026-06-06 | v0.1 | Copilot | 基于 brainstorming 首轮澄清（后端代理 + 系统密钥链）形成初版方案。 |

## 目录

1. 背景与目标
2. 关键决策
3. 方案对比
4. 推荐方案架构
5. 菜单与配置 UX
6. 数据模型与存储策略
7. 后端命令与服务设计
8. 自动摘要 Agent 设计
9. 错误处理与可观测性
10. 安全与合规
11. 里程碑与验收

## 1. 背景与目标

当前摘要生成为规则逻辑，文本风格机械。目标是引入大模型能力，实现：
- 可配置多供应商（内置常见供应商 + 自定义供应商）。
- 统一模型调用入口（前端不感知供应商细节）。
- 自动摘要 Agent（可触发、可回退、可解释）。
- 与现有菜单系统、摘要保存链路平滑集成。

## 2. 关键决策

已确认：
- 调用路径：后端代理统一调用。
- 凭据存储：系统密钥链优先（数据库仅保存 provider/profile 元数据，不存明文 key）。

决策影响：
- 安全性提升，前端无需持有供应商密钥。
- 新增供应商时仅需后端 adapter 扩展。
- 支持统一重试、熔断、日志、速率限制。

## 3. 方案对比

### 方案 A：前端直连供应商

优点：
- 前端开发快，短期可见。

缺点：
- API Key 暴露面大。
- CORS、代理、审计、重试策略分散。
- 长期维护成本高。

### 方案 B：后端统一代理（推荐）

优点：
- 安全性最佳。
- 供应商适配统一，易扩展。
- 可集中实现日志、重试、超时、限流。

缺点：
- 首期后端改造工作量略高。

### 方案 C：混合模式

优点：
- 对高级用户保留灵活性。

缺点：
- 安全模型与测试矩阵复杂度最高。

## 4. 推荐方案架构

采用分层：
- Frontend: 设置页、菜单动作、摘要触发入口。
- Tauri Commands: 配置读写、供应商连通性测试、统一摘要调用。
- Provider Adapter: OpenAI/Anthropic/Google/OpenRouter/Custom HTTP。
- Agent Orchestrator: 触发策略、上下文压缩、提示词模板、回退策略。
- Secret Store: 系统密钥链。
- SQLite Settings: 非敏感配置（provider、model、温度、token 限制、策略开关）。

统一调用接口：
- 输入：prompt + context + providerProfileId。
- 输出：text + usage + latency + providerMeta + traceId。

## 5. 菜单与配置 UX

应用菜单新增：
- 偏好设置
- AI 设置
- 自动摘要 Agent
- 测试模型连通性

AI 设置页信息架构：
- 通用开关：启用 AI 摘要。
- 默认配置：默认供应商、默认模型、温度、最大输出 token。
- 供应商管理：
  - 内置供应商模板（OpenAI、Anthropic、Google、OpenRouter）。
  - 自定义供应商（Base URL、Headers 模板、模型映射）。
- 凭据管理：写入系统密钥链。
- 连通性测试：展示响应耗时与错误详情。

## 6. 数据模型与存储策略

复用 settings 表，建议 key 规范：
- scope='ai', key='enabled'
- scope='ai', key='default_profile_id'
- scope='ai_profile:{id}', key='provider'
- scope='ai_profile:{id}', key='model'
- scope='ai_profile:{id}', key='base_url'
- scope='ai_profile:{id}', key='max_tokens'
- scope='ai_profile:{id}', key='temperature'
- scope='agent_summary', key='auto_trigger_enabled'
- scope='agent_summary', key='min_word_count'
- scope='agent_summary', key='min_backlinks'

密钥链键命名：
- mynote/ai/{profile_id}/api_key

说明：
- SQLite 不存明文 key。
- profile 删除时清理密钥链对应条目。

## 7. 后端命令与服务设计

新增 commands（示意）：
- get_ai_settings()
- upsert_ai_profile(input)
- delete_ai_profile(profile_id)
- set_ai_profile_secret(profile_id, api_key)
- test_ai_profile(profile_id)
- generate_summary_candidate_with_ai(path, profile_id?)

服务分层：
- services/ai/provider.rs: ProviderAdapter trait。
- services/ai/providers/*.rs: 各供应商实现。
- services/ai/orchestrator.rs: 统一请求拼装、超时/重试。
- services/summary_agent.rs: 自动摘要 Agent 主流程。

兼容策略：
- 现有 generate_summary_candidate 保留。
- 新增 AI 版本命令；前端根据配置选择 AI 或规则引擎。

## 8. 自动摘要 Agent 设计

触发条件（可配置）：
- 保存后触发。
- 字数阈值满足。
- 最近打开次数或反链数达到阈值。

流程：
1. 收集上下文（标题、正文首段、标题层级、反链摘要、标签）。
2. 执行上下文压缩（长度预算 + 噪声剔除）。
3. 生成提示词（中文优先，强调可读性与非模板化表达）。
4. 调用统一 LLM 网关。
5. 结果后处理（长度限制、敏感内容过滤、空结果判定）。
6. 写回摘要并更新索引。
7. 写入 trace（触发源、耗时、token 用量、模型）。

失败回退：
- LLM 调用失败时降级到规则摘要。
- 在 UI 显示“已降级”提示，但不阻塞保存链路。

## 9. 错误处理与可观测性

错误分类：
- 配置错误（缺少密钥、模型无效）。
- 网络错误（超时、TLS、DNS）。
- 供应商错误（429、5xx、配额不足）。
- 解析错误（返回结构不兼容）。

可观测字段：
- trace_id, profile_id, provider, model, latency_ms, input_tokens, output_tokens, fallback_used。

## 10. 安全与合规

- 密钥只进入系统密钥链，不进入日志。
- 日志默认脱敏（Authorization、api_key、prompt 全文）。
- 自定义供应商请求头做白名单校验，防止危险 header 注入。
- 网络请求统一超时与重试上限，避免资源耗尽。

## 11. 里程碑与验收

M1: 配置底座
- 完成 AI 设置读取/写入。
- 完成密钥链存取与连通性测试。

M2: Provider 适配层
- 内置 2 个供应商 + 自定义供应商。
- 完成统一网关与错误映射。

M3: 摘要 Agent
- 完成自动触发与回退。
- 完成摘要写回与索引更新。

M4: 前端菜单与交互
- 菜单入口与设置页联动。
- 完成用户提示与状态反馈。

验收标准：
- 未配置密钥时可明确引导。
- 成功生成时摘要质量优于规则基线。
- 失败时不影响保存主流程且有可解释提示。
- 全链路测试（单元+集成）通过。

# Tauri Security Hardening Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义 Tauri CSP、opener 权限和前端 HTML 注入面的安全收紧设计。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 设计原则](#4-设计原则)
- [5. 现状与风险面](#5-现状与风险面)
- [6. 方案选择](#6-方案选择)
- [7. 详细设计](#7-详细设计)
- [8. 数据流与安全边界](#8-数据流与安全边界)
- [9. 错误处理与兼容性](#9-错误处理与兼容性)
- [10. 测试与验证策略](#10-测试与验证策略)
- [11. 后续扩展](#11-后续扩展)

## 1. 背景

Baseline 中将 Tauri 安全面列为 P2 风险：当前 `tauri.conf.json` 中 `csp` 为 `null`，`capabilities/default.json` 使用较宽的 `opener:default`，并且 Markdown 预览通过 `innerHTML` 写入 `markdown-it` 生成的 HTML。

进一步检查发现，搜索结果高亮 snippet 也使用 `dangerouslySetInnerHTML`。虽然当前 `safeSnippet` 会先转义 HTML 再恢复 `<mark>` 标签，但它仍属于 HTML 字符串进入 DOM 的同类风险面。

本轮 P2 聚焦在不改变用户功能的前提下降低前端注入面和 Tauri 权限面。

## 2. 目标

本次修复目标：

- 将 Tauri CSP 从 `null` 改为显式策略。
- 收窄 opener capability，移除不需要的 reveal file 权限。
- 保留 Markdown 预览中打开 `http://` 和 `https://` 外链的能力。
- 在 Markdown 预览写入 DOM 前增加明确的 HTML sanitize 步骤。
- 将搜索结果 snippet 从 `dangerouslySetInnerHTML` 改为 React token 渲染。
- 保持现有 Markdown 渲染、Wiki link 点击、外链打开、搜索弹窗交互不变。
- 不改变后端命令、数据库 schema 或索引逻辑。

## 3. 非目标

本轮不做以下内容：

- 完全移除 Markdown 预览中的 `innerHTML`。
- 重写 Markdown renderer 为 React AST。
- 引入完整前端测试框架。
- 禁止所有外链打开。
- 改造搜索后端 snippet 格式。
- 改造 dialog 权限。
- 处理 SQLite migration、搜索性能或其他 P2 项。

## 4. 设计原则

- 权限最小化：只保留当前功能实际需要的 Tauri permission。
- 多层防护：CSP、capability、URL scheme 检查、HTML sanitize 和 React token 渲染共同降低风险。
- 行为兼容优先：安全收紧不能破坏编辑、搜索、预览和外链打开主流程。
- 避免大重构：本轮降低风险面，不把 Markdown 预览重写为新架构。
- 显式白名单：允许的 HTML tag、attribute、URL scheme 和 opener URL scope 都要写清楚。

## 5. 现状与风险面

### 5.1 CSP

当前配置：

```json
"security": {
  "csp": null
}
```

风险：如果前端出现 HTML 注入或第三方内容进入 DOM，缺少 CSP 这层浏览器安全约束。

### 5.2 Opener capability

当前配置：

```json
"permissions": [
  "core:default",
  "opener:default",
  "dialog:default"
]
```

Tauri 生成 schema 显示 `opener:default` 包含：

- `allow-open-url`
- `allow-reveal-item-in-dir`
- `allow-default-urls`

当前前端只使用 `openUrl(anchor.href)` 打开 Markdown 预览中的 `http/https` 外链，不需要 reveal file in directory，也不需要 `mailto:` 或 `tel:`。

### 5.3 MarkdownPreview innerHTML

当前预览链路：

1. `markdown-it` 以 `html: false` 渲染 Markdown。
2. `processWikiLinks` 用字符串替换生成 `<span class="wiki-link" data-title="...">`。
3. 结果写入 `containerRef.current.innerHTML`。

`html: false` 已经阻止原始 HTML 直接进入渲染结果，但最终仍是 HTML 字符串写 DOM，缺少显式 sanitizer 白名单。

### 5.4 SearchOverlay dangerouslySetInnerHTML

当前搜索 snippet 链路：

1. 后端返回包含 `<mark>` 的 snippet。
2. `safeSnippet` 转义 `&`、`<`、`>`。
3. 再恢复 `&lt;mark&gt;` 和 `&lt;/mark&gt;`。
4. 通过 `dangerouslySetInnerHTML` 写入 DOM。

这比直接写入安全很多，但仍可改为 React 节点渲染，彻底移除该处 HTML 字符串注入。

## 6. 方案选择

### 方案 A：CSP + opener scope + sanitize + React token rendering（推荐）

本方案包含：

- `tauri.conf.json` 设置显式 CSP。
- `capabilities/default.json` 将 `opener:default` 改为 scoped `opener:allow-open-url`。
- Markdown 预览增加 sanitizer，保留常用 Markdown 标签、链接属性和 wiki link span。
- SearchOverlay snippet 改为 React token 渲染。

优点：覆盖 baseline 点名风险，并处理同类 snippet 注入面。改动可分为配置、预览、搜索三块，便于 review。缺点：需要新增 sanitizer 依赖，并维护允许列表。

### 方案 B：只改配置权限

只设置 CSP、收窄 opener capability，不处理 `innerHTML` 和 `dangerouslySetInnerHTML`。

优点：改动最小。缺点：baseline 点名的 MarkdownPreview HTML 风险仍未实质下降。

### 方案 C：彻底移除 Markdown innerHTML

使用 Markdown AST 或 React renderer，直接生成 React 节点，并把 wiki link 与外链逻辑接入节点树。

优点：长期边界最好。缺点：改动范围大，可能影响 Markdown 兼容性、样式和链接交互，不适合作为当前 P2 小步修复。

本轮采用方案 A。

## 7. 详细设计

### 7.1 CSP 配置

将 `src-tauri/tauri.conf.json` 中 `app.security.csp` 从 `null` 改为显式字符串。

推荐策略：

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' asset: data: blob:;
font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost http://localhost:1420 ws://localhost:1420;
object-src 'none';
base-uri 'self';
frame-ancestors 'none'
```

说明：

- `style-src 'unsafe-inline'` 用于兼容当前大量 React inline styles 和 CodeMirror 样式注入。
- `connect-src ipc: http://ipc.localhost` 用于 Tauri IPC。
- `http://localhost:1420` 与 `ws://localhost:1420` 用于 Vite dev / HMR 兼容。
- `object-src 'none'`、`frame-ancestors 'none'` 明确禁用不需要的嵌入面。
- 本轮不加入远程脚本、远程样式或任意远程图片源。

### 7.2 Opener capability 收窄

将 `src-tauri/capabilities/default.json` 中的：

```json
"opener:default"
```

替换为 scoped permission entry：

```json
{
  "identifier": "opener:allow-open-url",
  "allow": [
    { "url": "https://*" },
    { "url": "http://*" }
  ]
}
```

同时不加入 `opener:allow-open-path` 或 `opener:allow-reveal-item-in-dir`。

前端 `MarkdownPreview` 点击外链时继续只允许：

```ts
/^https?:\/\//.test(anchor.href)
```

这样形成双层限制：前端只发起 `http/https`，Tauri capability 也只允许 `http/https` URL。

### 7.3 Markdown sanitize

新增 sanitizer 依赖，推荐使用 DOMPurify：

- 运行时依赖：`dompurify`
- 类型：DOMPurify 3.x 自带类型；如当前安装版本需要，可再补 `@types/dompurify`

在 `MarkdownPreview.tsx` 中增加 sanitize 步骤：

1. `stripPreviewFrontMatter(content)`。
2. `md.render(previewContent)`。
3. `processWikiLinks(rawHtml)`。
4. `DOMPurify.sanitize(processedHtml, config)`。
5. `containerRef.current.innerHTML = sanitizedHtml`。

允许列表应覆盖当前 Markdown 预览需要的基础标签：

```ts
const ALLOWED_TAGS = [
  "a", "blockquote", "br", "code", "del", "em", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"
];
```

允许属性：

```ts
const ALLOWED_ATTR = ["href", "title", "class", "data-title"];
```

约束：

- 允许 `span.wiki-link` 和 `data-title`，否则 wiki link 点击会失效。
- 允许 `a[href]`，否则外链点击会失效。
- 不允许 `style`、事件属性、`srcdoc` 等属性。
- URL scheme 仅允许 `http`、`https`、`mailto`。虽然前端点击只打开 `http/https`，保留 `mailto` 仅用于 Markdown 链接显示；是否打开仍由点击逻辑控制。

如果 sanitizer 移除某些 Markdown 扩展标签，本轮接受基础 Markdown 优先；后续可按需要扩展白名单。

### 7.4 SearchOverlay snippet React token 渲染

移除 `dangerouslySetInnerHTML`。

新增一个小型 tokenization helper，例如：

```ts
type SnippetPart =
  | { kind: "text"; text: string }
  | { kind: "mark"; text: string };
```

解析规则：

- 后端 snippet 中只有 `<mark>` 和 `</mark>` 被视为高亮标记。
- 其他所有内容作为普通文本渲染，由 React 自动转义。
- 未闭合 `<mark>` 时，剩余内容作为普通文本或 mark 文本渲染都不能进入 HTML 字符串。本设计建议保守处理为普通文本。
- 嵌套 mark 不作为特殊场景支持；按顺序解析即可。

渲染：

```tsx
<div style={styles.resultSnippet}>
  {renderSnippet(r.snippet)}
</div>
```

`renderSnippet` 返回 text nodes 和 `<mark key={...}>...</mark>` 节点。这样搜索结果里即使出现 `<script>` 字符串，也只会作为文本显示。

## 8. 数据流与安全边界

### 8.1 Markdown 预览

```text
note content
  -> stripPreviewFrontMatter
  -> markdown-it(html: false)
  -> processWikiLinks
  -> DOMPurify.sanitize(allowlist)
  -> innerHTML
  -> click handler opens only http/https via Tauri opener
```

安全边界：

- 原始 Markdown HTML 被 markdown-it 禁用。
- Wiki link 注入 HTML 后经过 sanitizer。
- DOM 写入前有 tag/attribute allowlist。
- 点击打开外链有前端 scheme 检查。
- Tauri opener capability 有 URL scope。

### 8.2 搜索 snippet

```text
backend snippet string
  -> parseSnippetParts
  -> React text nodes / mark nodes
  -> DOM
```

安全边界：

- 不再有 HTML 字符串写入。
- React 自动转义文本内容。
- 只有代码创建的 `<mark>` 节点会进入 DOM。

## 9. 错误处理与兼容性

- CSP 若配置过严，可能导致 Tauri IPC 或 dev HMR 失败；计划中必须在 build 后至少验证 Tauri dev 能启动到主窗口。
- Opener scope 若配置错误，Markdown 外链点击可能失败；计划中必须验证 `http/https` 外链仍可打开。
- DOMPurify sanitize 不应抛出常规错误；若输入为空或 malformed HTML，返回安全字符串。
- Search snippet parser 对 malformed `<mark>` 保守降级为普通文本，不抛错。
- 如果 `dompurify` 类型导入在当前 TypeScript 配置下失败，实施计划应优先按 DOMPurify 官方 ESM 导入方式调整，而不是放宽 `tsconfig`。

## 10. 测试与验证策略

当前项涉及配置、前端渲染和 Tauri capability，验证分四层：

1. TypeScript / Vite 构建：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

2. Rust 回归测试：

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

3. Tauri 配置验证：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri build --debug
```

如果 debug bundle 耗时过长，可至少运行：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri dev
```

并确认主窗口能启动。

4. 手动安全烟测：

- Markdown 正文 `[[Wiki]]` 仍显示为可点击 wiki link。
- Markdown 正文 `[site](https://example.com)` 仍能打开外部浏览器。
- Markdown 正文 `[bad](javascript:alert(1))` 不应产生可打开危险链接。
- Markdown 中 `<script>alert(1)</script>` 应作为文本或被移除，不执行。
- 搜索结果 snippet 中包含 `<script>` 字符串时只显示文本。
- 搜索结果 `<mark>term</mark>` 仍显示高亮。

## 11. 后续扩展

后续可考虑：

- 完全移除 Markdown 预览的 `innerHTML`，改为 AST 到 React 节点。
- 将 Markdown sanitize allowlist 抽到独立安全模块并补单元测试。
- 引入前端测试框架后，为 snippet parser 和 sanitize 配置增加单元测试。
- 继续收窄 dialog 权限，只保留当前实际使用的 open 类型。
- 为 CSP 分 dev/prod 策略，如果未来开发环境需要更多 dev source。

# Tauri Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Tauri and frontend HTML injection risk while preserving Markdown preview, wiki links, external links, and search highlighting.

**Architecture:** Apply defense in depth: explicit Tauri CSP, scoped opener capability, DOMPurify sanitization before Markdown preview DOM insertion, and React token rendering for search snippets. Keep backend commands, note content, indexing, and storage unchanged.

**Tech Stack:** Tauri 2, React 19, TypeScript, markdown-it, DOMPurify, Vite, Rust.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义 Tauri 安全面收紧的实施步骤。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 实施任务](#2-实施任务)
- [3. 自检清单](#3-自检清单)
- [4. 验证命令](#4-验证命令)

## 1. 文件结构

- Modify: `package.json`
  - Add `dompurify` runtime dependency.
- Modify: `pnpm-lock.yaml`
  - Updated by `pnpm add dompurify`.
- Modify: `src-tauri/tauri.conf.json`
  - Replace `app.security.csp: null` with an explicit CSP string.
- Modify: `src-tauri/capabilities/default.json`
  - Replace `opener:default` with scoped `opener:allow-open-url` for `http://*` and `https://*`.
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - Import DOMPurify, sanitize processed Markdown HTML before assigning `innerHTML`, and keep wiki/external link behavior.
- Modify: `src/components/SearchOverlay.tsx`
  - Replace `dangerouslySetInnerHTML` with React token rendering for `<mark>` snippets.
- Verify only: `src-tauri/src/lib.rs`
  - Confirm opener plugin remains initialized.

## 2. 实施任务

### Task 1: Tauri Configuration And Opener Scope

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Set explicit CSP**

Change `src-tauri/tauri.conf.json` from:

```json
"security": {
  "csp": null
}
```

to:

```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost http://localhost:1420 ws://localhost:1420; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}
```

- [ ] **Step 2: Scope opener permission**

Change `src-tauri/capabilities/default.json` permissions from:

```json
"permissions": [
  "core:default",
  "opener:default",
  "dialog:default"
]
```

to:

```json
"permissions": [
  "core:default",
  {
    "identifier": "opener:allow-open-url",
    "allow": [
      { "url": "https://*" },
      { "url": "http://*" }
    ]
  },
  "dialog:default"
]
```

- [ ] **Step 3: Validate Tauri config compiles**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening/src-tauri && cargo test
```

Expected: cargo test compiles Tauri config and all existing Rust tests pass.

- [ ] **Step 4: Commit config hardening**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "fix: tighten tauri csp and opener scope"
```

### Task 2: Markdown Preview Sanitization

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`

- [ ] **Step 1: Add DOMPurify dependency**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm add dompurify
```

Expected: `package.json` and `pnpm-lock.yaml` update with `dompurify`.

- [ ] **Step 2: Import DOMPurify and add sanitize config**

In `src/components/EditorWorkspace/MarkdownPreview.tsx`, add:

```ts
import DOMPurify from "dompurify";
```

Below the `md` constant, add:

```ts
const ALLOWED_MARKDOWN_TAGS = [
  "a", "blockquote", "br", "code", "del", "em", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
];

const ALLOWED_MARKDOWN_ATTR = ["href", "title", "class", "data-title"];

function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ALLOWED_MARKDOWN_TAGS,
    ALLOWED_ATTR: ALLOWED_MARKDOWN_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}
```

- [ ] **Step 3: Sanitize before innerHTML**

Change the render effect from:

```ts
const previewContent = stripPreviewFrontMatter(content);
const rawHtml = md.render(previewContent);
containerRef.current.innerHTML = processWikiLinks(rawHtml);
```

to:

```ts
const previewContent = stripPreviewFrontMatter(content);
const rawHtml = md.render(previewContent);
const processedHtml = processWikiLinks(rawHtml);
containerRef.current.innerHTML = sanitizePreviewHtml(processedHtml);
```

Do not change click handling or `markdown-it` options.

- [ ] **Step 4: Run frontend build**

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: TypeScript and Vite build pass. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 5: Commit Markdown sanitization**

```bash
git add package.json pnpm-lock.yaml src/components/EditorWorkspace/MarkdownPreview.tsx
git commit -m "fix: sanitize markdown preview html"
```

### Task 3: Search Snippet Token Rendering

**Files:**
- Modify: `src/components/SearchOverlay.tsx`

- [ ] **Step 1: Replace HTML sanitizer helper with token parser**

Remove `safeSnippet` and add:

```tsx
type SnippetPart =
  | { kind: "text"; text: string }
  | { kind: "mark"; text: string };

function parseSnippet(raw: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let index = 0;

  while (index < raw.length) {
    const markStart = raw.indexOf("<mark>", index);
    if (markStart === -1) {
      parts.push({ kind: "text", text: raw.slice(index) });
      break;
    }

    if (markStart > index) {
      parts.push({ kind: "text", text: raw.slice(index, markStart) });
    }

    const contentStart = markStart + "<mark>".length;
    const markEnd = raw.indexOf("</mark>", contentStart);
    if (markEnd === -1) {
      parts.push({ kind: "text", text: raw.slice(markStart) });
      break;
    }

    parts.push({ kind: "mark", text: raw.slice(contentStart, markEnd) });
    index = markEnd + "</mark>".length;
  }

  return parts;
}

function renderSnippet(raw: string) {
  return parseSnippet(raw).map((part, index) => {
    if (part.kind === "mark") {
      return <mark key={index}>{part.text}</mark>;
    }
    return <span key={index}>{part.text}</span>;
  });
}
```

- [ ] **Step 2: Remove `dangerouslySetInnerHTML` usage**

Change:

```tsx
<div
  style={styles.resultSnippet}
  dangerouslySetInnerHTML={{ __html: safeSnippet(r.snippet) }}
/>
```

to:

```tsx
<div style={styles.resultSnippet}>{renderSnippet(r.snippet)}</div>
```

- [ ] **Step 3: Run frontend build**

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: TypeScript and Vite build pass. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Commit snippet rendering**

```bash
git add src/components/SearchOverlay.tsx
git commit -m "fix: render search snippets without inner html"
```

### Task 4: Verification And Review

**Files:**
- Verify: `src-tauri/tauri.conf.json`
- Verify: `src-tauri/capabilities/default.json`
- Verify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Verify: `src/components/SearchOverlay.tsx`
- Verify: `package.json`
- Verify: `pnpm-lock.yaml`

- [ ] **Step 1: Static security review checklist**

Confirm:

- `tauri.conf.json` no longer has `"csp": null`.
- `capabilities/default.json` no longer uses `opener:default`.
- Opener scope only allows `https://*` and `http://*`.
- `MarkdownPreview` still has `html: false` for `markdown-it`.
- `MarkdownPreview` sanitizes after `processWikiLinks` and before `innerHTML`.
- Sanitizer allows `span.wiki-link` and `data-title` so wiki links still work.
- Sanitizer does not allow `style` or event handler attributes.
- `SearchOverlay` no longer uses `dangerouslySetInnerHTML`.
- React renders search snippet text nodes, so arbitrary `<script>` text remains text.

- [ ] **Step 2: Run frontend verification**

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: success with only the known Vite chunk-size warning.

- [ ] **Step 3: Run backend regression verification**

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening/src-tauri && cargo test
```

Expected: all existing Rust tests pass.

- [ ] **Step 4: Run Tauri config/package verification**

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri build --debug
```

Expected: debug build succeeds. If this is too slow for the environment, run `pnpm tauri dev` and verify the app starts to the main window.

- [ ] **Step 5: Manual smoke test**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri dev
```

Expected manual results:

- Markdown `[[Wiki]]` still renders as a clickable wiki link.
- Markdown `[site](https://example.com)` still opens externally.
- Markdown `[bad](javascript:alert(1))` does not create a dangerous open action.
- Markdown `<script>alert(1)</script>` does not execute.
- Search result snippets still show highlighted `<mark>` terms.
- Search result snippets containing `<script>` display text, not executable HTML.

- [ ] **Step 6: Commit any review fixes**

If review finds issues, fix them and commit with a focused message such as:

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json src/components/EditorWorkspace/MarkdownPreview.tsx src/components/SearchOverlay.tsx package.json pnpm-lock.yaml
git commit -m "fix: harden security edge cases"
```

## 3. 自检清单

- Spec coverage: The plan covers CSP, opener scope, Markdown preview sanitize, search snippet rendering, and verification.
- Placeholder scan: No TBD/TODO/fill-in placeholders are present.
- Type consistency: DOMPurify and snippet helper names match later usage.
- Scope check: This plan does not include SQLite migration, search performance, or full Markdown renderer replacement.

## 4. 验证命令

Run before merging:

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening/src-tauri && cargo test
```

```bash
cd /Users/lijun/mynote/.worktrees/tauri-security-hardening && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri build --debug
```

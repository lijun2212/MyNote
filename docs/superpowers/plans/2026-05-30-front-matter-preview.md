# Front Matter Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide leading YAML Front Matter from the Markdown preview while preserving the complete source content in the editor and saved note.

**Architecture:** Add a small preview-only helper in `MarkdownPreview.tsx` that strips only a closed leading Front Matter block before `markdown-it` renders. Keep editor content, save flow, backend parsing, indexing, wiki link click handling, and external link handling unchanged.

**Tech Stack:** React 19, TypeScript, markdown-it, Vite, Tauri 2.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义 Front Matter 预览隐藏的实施步骤。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 实施任务](#2-实施任务)
- [3. 自检清单](#3-自检清单)
- [4. 验证命令](#4-验证命令)

## 1. 文件结构

- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - Add `stripPreviewFrontMatter(content: string): string`.
  - Render `md.render(stripPreviewFrontMatter(content))` instead of rendering full content.
  - Preserve existing `processWikiLinks`, `openUrl`, and guarded wiki-link opening behavior.
- Verify only: `src/components/EditorWorkspace/EditorWorkspace.tsx`
  - Confirm it still passes full editor content into `MarkdownPreview` and does not mutate source content.
- Verify only: `src-tauri/src/infrastructure/markdown.rs`
  - No backend changes expected; Rust parsing remains source of truth for indexing and note metadata.

## 2. 实施任务

### Task 1: Preview-Only Front Matter Stripping

**Files:**
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`

- [ ] **Step 1: Add a preview-only strip helper**

Add this helper below `processWikiLinks` in `src/components/EditorWorkspace/MarkdownPreview.tsx`:

```ts
function stripPreviewFrontMatter(content: string): string {
  const normalizedFirstLineEnd = content.indexOf("\n");
  const firstLine = normalizedFirstLineEnd === -1 ? content : content.slice(0, normalizedFirstLineEnd);

  if (firstLine.replace(/\r$/, "") !== "---") {
    return content;
  }

  let lineStart = normalizedFirstLineEnd + 1;
  if (normalizedFirstLineEnd === -1) {
    return content;
  }

  while (lineStart < content.length) {
    const nextLineEnd = content.indexOf("\n", lineStart);
    const lineEnd = nextLineEnd === -1 ? content.length : nextLineEnd;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, "");

    if (line === "---") {
      const bodyStart = nextLineEnd === -1 ? content.length : nextLineEnd + 1;
      return content.slice(bodyStart).replace(/^\r?\n+/, "");
    }

    if (nextLineEnd === -1) {
      break;
    }
    lineStart = nextLineEnd + 1;
  }

  return content;
}
```

Expected behavior:

- `---\ntitle: Demo\n---\n\n# Demo` returns `# Demo`.
- `---\r\ntitle: Demo\r\n---\r\n\r\n# Demo` returns `# Demo`.
- `---\ntitle: Demo\n# Demo` returns the original content.
- `# Demo\n\n---\n\nBody` returns the original content.

- [ ] **Step 2: Render stripped preview content**

Change the render effect from:

```ts
    const rawHtml = md.render(content);
    containerRef.current.innerHTML = processWikiLinks(rawHtml);
```

to:

```ts
    const previewContent = stripPreviewFrontMatter(content);
    const rawHtml = md.render(previewContent);
    containerRef.current.innerHTML = processWikiLinks(rawHtml);
```

Do not change the effect dependencies. `content` remains the only render input.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/front-matter-preview && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: `tsc && vite build` succeeds. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Commit preview stripping**

```bash
git add src/components/EditorWorkspace/MarkdownPreview.tsx
git commit -m "fix: hide front matter in markdown preview"
```

### Task 2: Verification And Review

**Files:**
- Verify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Verify: frontend build output
- Verify: Rust tests

- [ ] **Step 1: Static review checklist**

Confirm in code review:

- `MarkdownPreview` still receives full `content` from `EditorWorkspace`.
- Only the string passed to `md.render` is stripped.
- Editor source content and autosave flow are not modified.
- `processWikiLinks` still runs after markdown rendering.
- External links still use `openUrl`.
- Guarded wiki-link opening still uses `useOpenNote` request ids.
- Unclosed leading `---` content is preserved.
- Mid-document `---` content is preserved.
- CRLF-delimited Front Matter is stripped.

- [ ] **Step 2: Run frontend verification**

```bash
cd /Users/lijun/mynote/.worktrees/front-matter-preview && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: success with only the known Vite chunk-size warning.

- [ ] **Step 3: Run backend regression verification**

```bash
cd /Users/lijun/mynote/.worktrees/front-matter-preview/src-tauri && cargo test
```

Expected: all existing Rust tests pass.

- [ ] **Step 4: Manual smoke test when running the app**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/front-matter-preview && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri dev
```

Expected manual results:

- A note beginning with closed Front Matter does not show YAML metadata in preview.
- The editor still shows the complete Front Matter source.
- Saving the note preserves Front Matter in the file.
- Body wiki links remain clickable.
- Body external links still open through Tauri opener.
- Unclosed Front Matter remains visible in preview.
- A mid-document horizontal rule remains visible as Markdown output.

- [ ] **Step 5: Commit any review fixes**

If review finds issues, fix them and commit with a focused message such as:

```bash
git add src/components/EditorWorkspace/MarkdownPreview.tsx
git commit -m "fix: harden front matter preview stripping"
```

## 3. 自检清单

- Spec coverage: The plan implements preview-only hiding, preserves editor/source/save behavior, keeps backend unchanged, handles unclosed blocks conservatively, and preserves wiki/external link handling.
- Placeholder scan: No TBD/TODO/fill-in placeholders are present.
- Type consistency: The helper signature and render effect code match the existing `MarkdownPreview` component.
- Scope check: This plan only covers Front Matter preview hiding and does not include Tauri security, sanitizer work, or a metadata toggle.

## 4. 验证命令

Run before merging:

```bash
cd /Users/lijun/mynote/.worktrees/front-matter-preview && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

```bash
cd /Users/lijun/mynote/.worktrees/front-matter-preview/src-tauri && cargo test
```

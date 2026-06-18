# Markdown Beautify Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a click-to-run Markdown beautify flow that diagnoses syntax/format issues, produces a conservative beautified result, optionally uses AI for format-only assistance, and lets users review/apply the result in the existing two-pane editor layout.

**Architecture:** The backend owns a single beautify pipeline in Rust so parsing, normalization, indexing, and import semantics stay consistent. The frontend adds a one-shot beautify entry point and a temporary review mode that reuses the existing preview pane instead of introducing a third permanent pane.

**Tech Stack:** Rust, Tauri commands, React 19, Zustand, Vitest, cargo test

---

## File Structure

- Create: `src-tauri/src/services/markdown_beautify.rs`
  - Owns diagnosis, conservative formatting, optional AI-assisted formatting hooks, and result validation.
- Modify: `src-tauri/src/services/mod.rs`
  - Expose the new beautify service module.
- Modify: `src-tauri/src/commands/note.rs`
  - Add the Tauri command entry point for beautifying the current note content.
- Modify: `src-tauri/src/lib.rs`
  - Register the new command.
- Modify: `src-tauri/src/domain/note.rs`
  - Add request/response structs for beautify configuration and results if this codebase keeps note-facing DTOs in the domain layer.
- Modify: `src/api/commands.ts`
  - Bridge the new backend command into a typed frontend API.
- Modify: `src/types/index.ts`
  - Add frontend contracts for beautify request, issue list, summary, and review result.
- Modify: `src/store/useEditorStore.ts`
  - Add transient beautify review state; keep editing silent until explicit beautify action.
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
  - Add beautify trigger, config panel, review-mode header actions, and apply/discard flow.
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - Support review-mode rendering of beautified content and diff mode without changing the normal preview path.
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
  - Cover toolbar trigger, review mode, apply/discard behavior, and no-third-pane expectations.
- Create or modify: `src-tauri/src/services/markdown_beautify.rs` tests
  - Cover diagnosis and conservative formatting rules.

## Task 1: Define shared beautify contracts and backend command boundary

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Modify: `src-tauri/src/domain/note.rs`
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src/api/commands.test.ts`

- [ ] **Step 1: Write the failing frontend API test**

Add a command mapping test in `src/api/commands.test.ts`.

```ts
it("calls beautifyMarkdown and maps the backend response", async () => {
  tauriMocks.invoke.mockResolvedValue({
    original_hash: "abc123",
    beautified_content: "# Title\n\n## 目录\n",
    applied_ai: false,
    diagnostics: [
      {
        id: "toc-missing",
        severity: "warning",
        kind: "toc_missing",
        message: "缺少目录",
        line_start: 1,
        line_end: 1,
        auto_fixable: true,
        ai_eligible: false,
      },
    ],
    summary: {
      error_count: 0,
      warning_count: 1,
      auto_fixable_count: 1,
    },
  });

  const result = await api.beautifyMarkdown({
    notePath: "notes/demo.md",
    content: "# Title",
    options: {
      fixSyntax: true,
      refreshToc: true,
      normalizeHeadings: true,
      normalizeCodeBlocks: true,
      normalizeSpacing: true,
      useAiAssist: false,
    },
  });

  expect(tauriMocks.invoke).toHaveBeenCalledWith("beautify_markdown", {
    request: {
      notePath: "notes/demo.md",
      content: "# Title",
      options: {
        fixSyntax: true,
        refreshToc: true,
        normalizeHeadings: true,
        normalizeCodeBlocks: true,
        normalizeSpacing: true,
        useAiAssist: false,
      },
    },
  });
  expect(result.summary.warningCount).toBe(1);
  expect(result.diagnostics[0].kind).toBe("toc_missing");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/api/commands.test.ts -t "calls beautifyMarkdown and maps the backend response"`
Expected: FAIL because `api.beautifyMarkdown` and the new DTOs/command mapping do not exist yet.

- [ ] **Step 3: Write the minimal shared contracts**

Add typed contracts in `src/types/index.ts`.

```ts
export interface MarkdownBeautifyOptions {
  fixSyntax: boolean;
  refreshToc: boolean;
  normalizeHeadings: boolean;
  normalizeCodeBlocks: boolean;
  normalizeSpacing: boolean;
  useAiAssist: boolean;
}

export interface MarkdownBeautifyIssue {
  id: string;
  severity: "error" | "warning" | "info";
  kind: string;
  message: string;
  lineStart: number | null;
  lineEnd: number | null;
  autoFixable: boolean;
  aiEligible: boolean;
}

export interface MarkdownBeautifySummary {
  errorCount: number;
  warningCount: number;
  autoFixableCount: number;
}

export interface MarkdownBeautifyRequest {
  notePath: string;
  content: string;
  options: MarkdownBeautifyOptions;
}

export interface MarkdownBeautifyResult {
  originalHash: string;
  beautifiedContent: string;
  appliedAi: boolean;
  diagnostics: MarkdownBeautifyIssue[];
  summary: MarkdownBeautifySummary;
}
```

Add the frontend bridge in `src/api/commands.ts`.

```ts
interface RawMarkdownBeautifyIssue {
  id: string;
  severity: string;
  kind: string;
  message: string;
  line_start: number | null;
  line_end: number | null;
  auto_fixable: boolean;
  ai_eligible: boolean;
}

interface RawMarkdownBeautifyResult {
  original_hash: string;
  beautified_content: string;
  applied_ai: boolean;
  diagnostics: RawMarkdownBeautifyIssue[];
  summary: {
    error_count: number;
    warning_count: number;
    auto_fixable_count: number;
  };
}
```

Then expose:

```ts
beautifyMarkdown: (request: MarkdownBeautifyRequest) =>
  invoke<RawMarkdownBeautifyResult>("beautify_markdown", { request }).then(mapMarkdownBeautifyResult),
```

In Rust, add matching `serde` DTOs and a command stub that returns `AppError::NotImplemented` or a temporary echo payload until Task 2 replaces it.

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownBeautifyOptions {
    pub fix_syntax: bool,
    pub refresh_toc: bool,
    pub normalize_headings: bool,
    pub normalize_code_blocks: bool,
    pub normalize_spacing: bool,
    pub use_ai_assist: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownBeautifyRequest {
    pub note_path: String,
    pub content: String,
    pub options: MarkdownBeautifyOptions,
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/api/commands.test.ts -t "calls beautifyMarkdown and maps the backend response"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/api/commands.ts src/api/commands.test.ts src-tauri/src/domain/note.rs src-tauri/src/commands/note.rs src-tauri/src/lib.rs
git commit -m "feat: add markdown beautify command contracts"
```

### Task 2: Build the Rust diagnosis and conservative formatting pipeline

**Files:**
- Create: `src-tauri/src/services/markdown_beautify.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/commands/note.rs`
- Test: `src-tauri/src/services/markdown_beautify.rs`

- [ ] **Step 1: Write failing Rust tests for diagnosis and formatting**

Add tests in `src-tauri/src/services/markdown_beautify.rs`.

```rust
#[test]
fn diagnose_reports_missing_toc_and_heading_spacing() {
    let result = beautify_markdown_text(
        "notes/demo.md",
        "# Title\n### Skipped Level\nText",
        MarkdownBeautifyOptions {
            fix_syntax: true,
            refresh_toc: true,
            normalize_headings: true,
            normalize_code_blocks: true,
            normalize_spacing: true,
            use_ai_assist: false,
        },
        None,
    )
    .unwrap();

    assert!(result.diagnostics.iter().any(|item| item.kind == "toc_missing"));
    assert!(result.diagnostics.iter().any(|item| item.kind == "heading_level_jump"));
}

#[test]
fn beautify_inserts_toc_and_normalizes_blank_lines() {
    let result = beautify_markdown_text(
        "notes/demo.md",
        "# Title\n\n\n## Section\nBody",
        default_options(),
        None,
    )
    .unwrap();

    assert!(result.beautified_content.contains("## 目录"));
    assert!(!result.beautified_content.contains("\n\n\n"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test markdown_beautify`
Expected: FAIL because the new service and `beautify_markdown_text` do not exist yet.

- [ ] **Step 3: Write the minimal Rust pipeline**

Create `src-tauri/src/services/markdown_beautify.rs` with a single public entry point and conservative rule passes.

```rust
pub fn beautify_markdown_text(
    note_path: &str,
    content: &str,
    options: MarkdownBeautifyOptions,
    ai_result: Option<&str>,
) -> AppResult<MarkdownBeautifyResult> {
    let diagnostics = diagnose_markdown(content, &options);
    let mut beautified = content.to_string();

    if options.normalize_spacing {
        beautified = normalize_blank_lines(&beautified);
    }
    if options.normalize_headings {
        beautified = normalize_heading_spacing(&beautified);
    }
    if options.refresh_toc {
        beautified = refresh_or_insert_toc(&beautified);
    }
    if options.normalize_code_blocks {
        beautified = normalize_fenced_code_blocks(&beautified);
    }

    let beautified = match (options.use_ai_assist, ai_result) {
        (true, Some(candidate)) if validate_ai_candidate(candidate).is_ok() => candidate.to_string(),
        _ => beautified,
    };

    Ok(MarkdownBeautifyResult {
        original_hash: crate::infrastructure::hash::sha256_hex(content.as_bytes()),
        beautified_content: beautified,
        applied_ai: options.use_ai_assist && ai_result.is_some(),
        diagnostics,
        summary: summarize_diagnostics(&diagnostics),
    })
}
```

Wire the command in `src-tauri/src/commands/note.rs` to call the service without AI first.

```rust
#[tauri::command]
pub async fn beautify_markdown(
    request: MarkdownBeautifyRequest,
) -> Result<MarkdownBeautifyResult, AppError> {
    crate::services::markdown_beautify::beautify_markdown_text(
        &request.note_path,
        &request.content,
        request.options,
        None,
    )
}
```

- [ ] **Step 4: Run the Rust tests to verify they pass**

Run: `cd src-tauri && cargo test markdown_beautify`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/markdown_beautify.rs src-tauri/src/services/mod.rs src-tauri/src/commands/note.rs
git commit -m "feat: add markdown beautify pipeline"
```

### Task 3: Add optional AI-assisted format-only fallback in the backend

**Files:**
- Modify: `src-tauri/src/services/markdown_beautify.rs`
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/services/ai/mod.rs` or existing orchestration boundary if needed
- Test: `src-tauri/src/services/markdown_beautify.rs`

- [ ] **Step 1: Write failing backend tests for AI gating and fallback**

```rust
#[test]
fn beautify_ignores_ai_when_option_is_disabled() {
    let result = beautify_markdown_text("notes/demo.md", "# Title", default_options(), Some("# Changed by AI")).unwrap();
    assert!(!result.applied_ai);
    assert_ne!(result.beautified_content, "# Changed by AI");
}

#[test]
fn beautify_falls_back_to_rule_result_when_ai_output_is_invalid() {
    let mut options = default_options();
    options.use_ai_assist = true;

    let result = beautify_markdown_text("notes/demo.md", "# Title", options, Some("")) .unwrap();
    assert!(!result.applied_ai);
    assert!(result.beautified_content.contains("# Title"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test beautify_`
Expected: FAIL because AI gating/fallback is not implemented yet.

- [ ] **Step 3: Implement the minimum AI path**

```rust
async fn maybe_generate_ai_format_assist(
    root: &Path,
    note_path: &str,
    content: &str,
    options: &MarkdownBeautifyOptions,
) -> AppResult<Option<String>> {
    if !options.use_ai_assist {
        return Ok(None);
    }

    let prompt = build_markdown_beautify_prompt(content);
    let response = crate::services::ai::generate_text_for_default_profile(root, &prompt).await?;
    Ok(Some(response.text))
}
```

And in the command:

```rust
let ai_candidate = maybe_generate_ai_format_assist(&root, &request.note_path, &request.content, &request.options).await?;
crate::services::markdown_beautify::beautify_markdown_text(
    &request.note_path,
    &request.content,
    request.options,
    ai_candidate.as_deref(),
)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test beautify_`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/markdown_beautify.rs src-tauri/src/commands/note.rs src-tauri/src/services/ai
 git commit -m "feat: add optional ai assist for markdown beautify"
```

### Task 4: Add frontend beautify review state and command wiring

**Files:**
- Modify: `src/store/useEditorStore.ts`
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Test: `src/store/useEditorStore.test.ts` or `src/components/EditorWorkspace/EditorWorkspace.test.tsx`

- [ ] **Step 1: Write the failing state test**

```ts
it("stores beautify review mode separately from normal preview mode", () => {
  useEditorStore.getState().setBeautifyReview({
    originalContent: "# Old",
    beautifiedContent: "# New",
    diagnostics: [],
    summary: { errorCount: 0, warningCount: 0, autoFixableCount: 0 },
    diffMode: false,
    appliedAi: false,
  });

  expect(useEditorStore.getState().beautifyReview?.beautifiedContent).toBe("# New");
  expect(useEditorStore.getState().showPreview).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx -t "stores beautify review mode separately from normal preview mode"`
Expected: FAIL because `beautifyReview` state does not exist.

- [ ] **Step 3: Add the transient review state**

Add to `useEditorStore.ts`:

```ts
interface BeautifyReviewState {
  originalContent: string;
  beautifiedContent: string;
  diagnostics: MarkdownBeautifyIssue[];
  summary: MarkdownBeautifySummary;
  diffMode: boolean;
  appliedAi: boolean;
}
```

and store actions:

```ts
beautifyReview: BeautifyReviewState | null;
setBeautifyReview: (review: BeautifyReviewState | null) => void;
setBeautifyDiffMode: (enabled: boolean) => void;
applyBeautifyContent: () => void;
```

Use `applyBeautifyContent` to copy `beautifiedContent` into `content`, mark the editor dirty, and clear the review state.

- [ ] **Step 4: Run the test to verify it passes**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx -t "stores beautify review mode separately from normal preview mode"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/useEditorStore.ts src/types/index.ts src/api/commands.ts src/components/EditorWorkspace/EditorWorkspace.test.tsx
git commit -m "feat: add editor beautify review state"
```

### Task 5: Implement the beautify action and right-pane review mode

**Files:**
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Test: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`

- [ ] **Step 1: Write failing UI tests for the beautify flow**

```tsx
it("opens beautify review mode in the existing preview pane without adding a third pane", async () => {
  apiMocks.beautifyMarkdown.mockResolvedValue({
    originalHash: "hash-1",
    beautifiedContent: "# 美化后",
    appliedAi: false,
    diagnostics: [],
    summary: { errorCount: 0, warningCount: 0, autoFixableCount: 0 },
  });

  render(<EditorWorkspace />);
  await user.click(screen.getByRole("button", { name: "美化 Markdown" }));
  await user.click(screen.getByRole("button", { name: "开始美化" }));

  expect(screen.getByText("美化后预览")).toBeInTheDocument();
  expect(screen.queryAllByTestId("mock-preview")).toHaveLength(1);
});

it("applies beautified content only after the user confirms", async () => {
  apiMocks.beautifyMarkdown.mockResolvedValue({
    originalHash: "hash-1",
    beautifiedContent: "# 美化后",
    appliedAi: false,
    diagnostics: [],
    summary: { errorCount: 0, warningCount: 0, autoFixableCount: 0 },
  });

  render(<EditorWorkspace />);
  await user.click(screen.getByRole("button", { name: "美化 Markdown" }));
  await user.click(screen.getByRole("button", { name: "开始美化" }));
  await user.click(screen.getByRole("button", { name: "应用美化结果" }));

  expect(useEditorStore.getState().content).toBe("# 美化后");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx -t "beautify"`
Expected: FAIL because no beautify button or review mode exists.

- [ ] **Step 3: Implement the minimal review UI**

In `EditorWorkspace.tsx`, add a toolbar action and a small config panel state.

```tsx
const [beautifyPanelOpen, setBeautifyPanelOpen] = useState(false);
const [beautifyOptions, setBeautifyOptions] = useState<MarkdownBeautifyOptions>({
  fixSyntax: true,
  refreshToc: true,
  normalizeHeadings: true,
  normalizeCodeBlocks: true,
  normalizeSpacing: true,
  useAiAssist: false,
});
```

Add a submit handler:

```tsx
const handleRunBeautify = useCallback(async () => {
  if (!currentNote) {
    return;
  }

  const result = await api.beautifyMarkdown({
    notePath: currentNote.path,
    content,
    options: beautifyOptions,
  });

  setBeautifyReview({
    originalContent: content,
    beautifiedContent: result.beautifiedContent,
    diagnostics: result.diagnostics,
    summary: result.summary,
    diffMode: false,
    appliedAi: result.appliedAi,
  });
  setBeautifyPanelOpen(false);
}, [beautifyOptions, content, currentNote, setBeautifyReview]);
```

Render the right pane header conditionally and pass review content into `MarkdownPreview`.

```tsx
const previewContent = beautifyReview ? beautifyReview.beautifiedContent : content;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx -t "beautify"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/MarkdownPreview.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
git commit -m "feat: add markdown beautify review mode"
```

### Task 6: Add diff-mode toggle, discard flow, and end-to-end validation

**Files:**
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
- Test: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [ ] **Step 1: Write the failing tests for diff mode and discard**

```tsx
it("switches the preview pane into diff mode on demand", async () => {
  render(<EditorWorkspace />);
  seedBeautifyReview();

  await user.click(screen.getByRole("button", { name: "查看改动" }));
  expect(screen.getByText("改动预览")).toBeInTheDocument();
});

it("restores normal preview when beautify review is discarded", async () => {
  render(<EditorWorkspace />);
  seedBeautifyReview();

  await user.click(screen.getByRole("button", { name: "放弃美化结果" }));
  expect(useEditorStore.getState().beautifyReview).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx -t "diff mode|discard"`
Expected: FAIL because the toggle and discard actions are not fully wired.

- [ ] **Step 3: Implement the minimum diff-mode presentation**

Keep the no-third-pane promise by switching the same preview pane between review result and diff summary.

```tsx
{beautifyReview?.diffMode ? (
  <BeautifyDiffPreview
    originalContent={beautifyReview.originalContent}
    beautifiedContent={beautifyReview.beautifiedContent}
  />
) : (
  <MarkdownPreview content={beautifyReview?.beautifiedContent ?? content} />
)}
```

If a dedicated diff component is too large for this step, use a simple block-level split inside the preview pane only.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx -t "diff mode|discard|apply"`
Expected: PASS

- [ ] **Step 5: Run the whole editor workspace test file**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx`
Expected: PASS

- [ ] **Step 6: Run backend and frontend verification**

Run: `cd src-tauri && cargo test`
Expected: PASS

Run: `cd .. && PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm build`
Expected: PASS

- [ ] **Step 7: Review the scoped diff**

Run: `git --no-pager diff -- src/components/EditorWorkspace src/store/useEditorStore.ts src/api/commands.ts src/types/index.ts src-tauri/src/services/markdown_beautify.rs src-tauri/src/commands/note.rs src-tauri/src/domain/note.rs src-tauri/src/lib.rs`
Expected: only beautify-related files changed.

- [ ] **Step 8: Commit**

```bash
git add src/components/EditorWorkspace src/store/useEditorStore.ts src/api/commands.ts src/types/index.ts src-tauri/src/services/markdown_beautify.rs src-tauri/src/commands/note.rs src-tauri/src/domain/note.rs src-tauri/src/lib.rs
git commit -m "feat: add markdown beautify diagnostics flow"
```

## Self-Review

- Spec coverage: the plan covers silent editing, click-to-run beautify, conservative backend formatting, optional AI assist with validation, right-pane review mode, diff toggle without a third pane, and apply/discard flow.
- Placeholder scan: there are no `TBD` or “handle appropriately” placeholders; each task has exact files and commands.
- Type consistency: all later tasks reuse the same `MarkdownBeautifyOptions`, `MarkdownBeautifyResult`, and `beautifyReview` names introduced earlier in the plan.

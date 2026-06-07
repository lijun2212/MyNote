# Note Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a current-note outline in the right sidebar that lists headings through `###` and jumps both editor and preview to the selected section.

**Architecture:** Reuse the existing search-navigation line-range pipeline instead of inventing a new jump mechanism. Consolidate heading parsing in the Rust markdown infrastructure, expose a single Tauri note-outline command, then render and refresh the outline from a dedicated React panel with debounced updates.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Vitest, Cargo tests

---

## File Structure

- Modify: `src-tauri/src/infrastructure/markdown.rs`
  Responsibility: own the canonical heading parsing, normalization, and outline block extraction logic.
- Modify: `src-tauri/src/domain/note.rs`
  Responsibility: define the serializable note outline DTO returned to the frontend.
- Modify: `src-tauri/src/services/note.rs`
  Responsibility: read note content from disk, call markdown outline extraction, and map infrastructure blocks to API DTOs.
- Modify: `src-tauri/src/commands/note.rs`
  Responsibility: expose the Tauri command for current-note outline retrieval.
- Modify: `src-tauri/src/lib.rs`
  Responsibility: register the new Tauri command.
- Modify: `src/types/index.ts`
  Responsibility: define the frontend `NoteOutlineItem` contract.
- Modify: `src/api/commands.ts`
  Responsibility: add the `getNoteOutline` invoke wrapper.
- Create: `src/components/RightSidebar/OutlinePanel.tsx`
  Responsibility: fetch, render, debounce-refresh, and navigate outline items.
- Create: `src/components/RightSidebar/OutlinePanel.test.tsx`
  Responsibility: cover empty states, rendering, click navigation, and debounced refresh.
- Modify: `src/components/RightSidebar/RightSidebar.tsx`
  Responsibility: replace the placeholder outline body with the real panel.
- Modify: `src/components/RightSidebar/RightSidebar.test.tsx`
  Responsibility: verify the sidebar renders the outline panel as the default tab.

## Task 1: Consolidate heading parsing and outline extraction

**Files:**
- Modify: `src-tauri/src/infrastructure/markdown.rs`
- Modify: `src-tauri/src/domain/note.rs`
- Test: `src-tauri/src/infrastructure/markdown.rs`

- [ ] **Step 1: Write the failing Rust tests for outline extraction**

```rust
#[test]
fn extracts_outline_blocks_up_to_level_three() {
    let body = "# Alpha\ntext\n\n## Beta\nbody\n\n### Gamma\nmore\n\n#### Ignore Me\n";

    let outline = extract_note_outline_blocks(body, 3);

    assert_eq!(outline.len(), 3);
    assert_eq!(outline[0].text, "Alpha");
    assert_eq!(outline[0].level, 1);
    assert_eq!(outline[0].line_start, 1);
    assert_eq!(outline[0].line_end, 3);
    assert_eq!(outline[1].text, "Beta");
    assert_eq!(outline[1].level, 2);
    assert_eq!(outline[1].line_start, 4);
    assert_eq!(outline[1].line_end, 6);
    assert_eq!(outline[2].text, "Gamma");
    assert_eq!(outline[2].level, 3);
    assert_eq!(outline[2].line_start, 7);
    assert_eq!(outline[2].line_end, 9);
}

#[test]
fn ignores_code_fences_and_supports_setext_headings() {
    let body = "Title One\n========\n\n```md\n## fake\n```\n\nSection Two\n-----------\ncontent\n";

    let outline = extract_note_outline_blocks(body, 3);

    assert_eq!(outline.len(), 2);
    assert_eq!(outline[0].text, "Title One");
    assert_eq!(outline[0].level, 1);
    assert_eq!(outline[1].text, "Section Two");
    assert_eq!(outline[1].level, 2);
}
```

- [ ] **Step 2: Run the Rust tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml extracts_outline_blocks_up_to_level_three ignores_code_fences_and_supports_setext_headings`

Expected: FAIL with a missing `extract_note_outline_blocks` function and missing outline block type.

- [ ] **Step 3: Implement shared outline parsing primitives**

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteOutlineBlock {
    pub text: String,
    pub level: u8,
    pub line_start: i64,
    pub line_end: i64,
    pub anchor: String,
}

fn parse_heading_at(lines: &[&str], index: usize) -> Option<(u8, String, usize)> {
    if let Some(text) = parse_atx_heading_text(lines.get(index)?) {
        let level = lines[index].trim_start().chars().take_while(|ch| *ch == '#').count() as u8;
        return Some((level, text.to_string(), 1));
    }

    let current = lines.get(index)?.trim();
    let underline = lines.get(index + 1)?.trim();
    if !current.is_empty() && underline.chars().all(|ch| ch == '=') {
        return Some((1, current.to_string(), 2));
    }
    if !current.is_empty() && underline.chars().all(|ch| ch == '-') {
        return Some((2, current.to_string(), 2));
    }

    None
}

fn slugify_heading_text(text: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in text.trim().chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&ch) {
            slug.push(ch);
            last_was_dash = false;
        } else if (ch.is_whitespace() || ch == '-' || ch == '_') && !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

pub fn extract_note_outline_blocks(body: &str, max_level: u8) -> Vec<NoteOutlineBlock> {
    let lines: Vec<&str> = body.lines().collect();
    let mut blocks = Vec::new();
    let mut index = 0usize;
    let mut in_code_fence = false;

    while index < lines.len() {
        let trimmed = lines[index].trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_fence = !in_code_fence;
            index += 1;
            continue;
        }
        if in_code_fence {
            index += 1;
            continue;
        }

        if let Some((level, text, consumed_lines)) = parse_heading_at(&lines, index) {
            if level <= max_level {
                blocks.push(NoteOutlineBlock {
                    text: text.clone(),
                    level,
                    line_start: index as i64 + 1,
                    line_end: lines.len() as i64,
                    anchor: slugify_heading_text(&text),
                });
            }
            index += consumed_lines;
            continue;
        }

        index += 1;
    }

    for current in 0..blocks.len() {
        let current_level = blocks[current].level;
        let next_line_end = blocks
            .iter()
            .skip(current + 1)
            .find(|candidate| candidate.level <= current_level)
            .map(|candidate| candidate.line_start - 1)
            .unwrap_or(lines.len() as i64);
        blocks[current].line_end = next_line_end;
    }

    blocks
}
```

- [ ] **Step 4: Add the serializable note outline DTO**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteOutlineItem {
    pub id: String,
    pub text: String,
    pub level: i64,
    pub line_start: i64,
    pub line_end: i64,
    pub anchor: String,
    pub children: Vec<NoteOutlineItem>,
}
```

- [ ] **Step 5: Run the Rust tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml extracts_outline_blocks_up_to_level_three ignores_code_fences_and_supports_setext_headings`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/infrastructure/markdown.rs src-tauri/src/domain/note.rs
git commit -m "feat: add markdown outline extraction primitives"
```

## Task 2: Expose note outline through the Tauri note stack

**Files:**
- Modify: `src-tauri/src/services/note.rs`
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Test: `src-tauri/src/services/note.rs`

- [ ] **Step 1: Write the failing backend service test for single-note outline loading**

```rust
#[test]
fn get_note_outline_in_root_returns_nested_outline_items() {
    let temp_dir = tempfile::tempdir().unwrap();
    let root = temp_dir.path();
    std::fs::create_dir_all(root.join("notes")).unwrap();
    std::fs::write(
        root.join("notes/outline.md"),
        "---\ntitle: Outline Demo\n---\n\n# One\nBody\n\n## Two\nMore\n\n### Three\nTail\n",
    )
    .unwrap();

    let outline = get_note_outline_in_root(root, "notes/outline.md").unwrap();

    assert_eq!(outline.len(), 1);
    assert_eq!(outline[0].text, "One");
    assert_eq!(outline[0].children.len(), 1);
    assert_eq!(outline[0].children[0].text, "Two");
    assert_eq!(outline[0].children[0].children[0].text, "Three");
}
```

- [ ] **Step 2: Run the backend service test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml get_note_outline_in_root_returns_nested_outline_items`

Expected: FAIL with missing `get_note_outline_in_root`.

- [ ] **Step 3: Implement note-outline service mapping and tree building**

```rust
pub fn get_note_outline_in_root(root: &Path, rel_path: &str) -> AppResult<Vec<NoteOutlineItem>> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let abs = resolve_kb_path(root, &rel_path)?;
    let content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", rel_path)))?;

    let parsed = crate::infrastructure::markdown::parse_note(&content, Path::new(&rel_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("note"))?;
    let blocks = crate::infrastructure::markdown::extract_note_outline_blocks(&parsed.body, 3);

    Ok(build_outline_tree(blocks))
}

fn build_outline_tree(blocks: Vec<crate::infrastructure::markdown::NoteOutlineBlock>) -> Vec<NoteOutlineItem> {
    let mut level1 = Vec::new();
    let mut pending_h1: Option<usize> = None;
    let mut pending_h2: Option<usize> = None;

    for block in blocks {
        let item = NoteOutlineItem {
            id: format!("{}:{}", block.anchor, block.line_start),
            text: block.text,
            level: block.level as i64,
            line_start: block.line_start,
            line_end: block.line_end,
            anchor: block.anchor,
            children: Vec::new(),
        };

        match item.level {
            1 => {
                level1.push(item);
                pending_h1 = Some(level1.len() - 1);
                pending_h2 = None;
            }
            2 => {
                if let Some(h1) = pending_h1 {
                    level1[h1].children.push(item);
                    pending_h2 = Some(level1[h1].children.len() - 1);
                } else {
                    level1.push(item);
                    pending_h1 = Some(level1.len() - 1);
                    pending_h2 = None;
                }
            }
            3 => {
                if let (Some(h1), Some(h2)) = (pending_h1, pending_h2) {
                    level1[h1].children[h2].children.push(item);
                } else if let Some(h1) = pending_h1 {
                    level1[h1].children.push(item);
                } else {
                    level1.push(item);
                    pending_h1 = Some(level1.len() - 1);
                    pending_h2 = None;
                }
            }
            _ => {}
        }
    }

    level1
}
```

- [ ] **Step 4: Expose the command and frontend contract**

```rust
#[tauri::command]
pub async fn get_note_outline(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<NoteOutlineItem>, AppError> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;

    get_note_outline_in_root(root, &path)
}
```

```rust
commands::note::get_note_outline,
```

```ts
export interface NoteOutlineItem {
  id: string;
  text: string;
  level: 1 | 2 | 3;
  lineStart: number;
  lineEnd: number;
  anchor: string;
  children: NoteOutlineItem[];
}
```

```ts
getNoteOutline: (path: string) =>
  invoke<NoteOutlineItem[]>("get_note_outline", { path }),
```

- [ ] **Step 5: Run the backend test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml get_note_outline_in_root_returns_nested_outline_items`

Expected: PASS

- [ ] **Step 6: Run a narrow type/build check for the shared contract**

Run: `corepack pnpm vitest run src/components/RightSidebar/RightSidebar.test.tsx`

Expected: PASS or FAIL only because the outline panel has not been wired yet.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/services/note.rs src-tauri/src/commands/note.rs src-tauri/src/lib.rs src/types/index.ts src/api/commands.ts
git commit -m "feat: expose note outline command"
```

## Task 3: Build the outline panel and navigation behavior

**Files:**
- Create: `src/components/RightSidebar/OutlinePanel.tsx`
- Create: `src/components/RightSidebar/OutlinePanel.test.tsx`
- Test: `src/components/RightSidebar/OutlinePanel.test.tsx`

- [ ] **Step 1: Write the failing frontend tests for outline states and click navigation**

```tsx
it("shows an empty state when no current note is open", () => {
  useEditorStore.setState({ currentNote: null, content: "" });

  render(<OutlinePanel />);

  expect(screen.getByText("打开笔记后显示大纲")).toBeInTheDocument();
});

it("renders outline items and writes search navigation target on click", async () => {
  const user = userEvent.setup();
  apiMocks.getNoteOutline.mockResolvedValue([
    {
      id: "beta:4",
      text: "Beta",
      level: 2,
      lineStart: 4,
      lineEnd: 8,
      anchor: "beta",
      children: [],
    },
  ]);
  useEditorStore.setState({
    currentNote: { id: "note-1", path: "notes/demo.md", title: "Demo" } as any,
    content: "# Alpha\n\n## Beta",
  });

  render(<OutlinePanel />);

  await user.click(await screen.findByRole("button", { name: "Beta" }));

  expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
    note_path: "notes/demo.md",
    line_start: 4,
    line_end: 8,
    match_text: "Beta",
    source: "body",
  });
});
```

- [ ] **Step 2: Run the OutlinePanel test file to verify it fails**

Run: `corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx`

Expected: FAIL with missing `OutlinePanel` and missing `api.getNoteOutline` mock usage.

- [ ] **Step 3: Implement the panel fetch, render, and navigation logic**

```tsx
export function OutlinePanel() {
  const currentNote = useEditorStore((s) => s.currentNote);
  const content = useEditorStore((s) => s.content);
  const setSearchNavigationTarget = useEditorStore((s) => s.setSearchNavigationTarget);
  const [items, setItems] = useState<NoteOutlineItem[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!currentNote?.path) {
      setItems([]);
      setStatus("idle");
      return;
    }

    setStatus("loading");
    const handle = window.setTimeout(async () => {
      try {
        const next = await api.getNoteOutline(currentNote.path);
        setItems(next);
        setStatus("idle");
      } catch {
        setItems([]);
        setStatus("error");
      }
    }, 250);

    return () => window.clearTimeout(handle);
  }, [currentNote?.path, content]);

  if (!currentNote) {
    return <div style={{ padding: 12, color: "#999" }}>打开笔记后显示大纲</div>;
  }
  if (status === "error") {
    return <div style={{ padding: 12, color: "#c25" }}>大纲加载失败</div>;
  }
  if (status === "idle" && items.length === 0) {
    return <div style={{ padding: 12, color: "#999" }}>当前笔记暂无可用标题</div>;
  }

  const renderItems = (nodes: NoteOutlineItem[]) => nodes.map((item) => (
    <div key={item.id}>
      <button
        title={item.text}
        style={{ paddingLeft: 12 + (item.level - 1) * 14 }}
        onClick={() => setSearchNavigationTarget({
          note_id: currentNote.id,
          note_path: currentNote.path,
          note_title: currentNote.title,
          line_start: item.lineStart,
          line_end: item.lineEnd,
          occurrence_order: 1,
          match_text: item.text,
          context_snippet: item.text,
          source: "body",
          revision: Date.now(),
        })}
      >
        {item.text}
      </button>
      {item.children.length > 0 ? renderItems(item.children) : null}
    </div>
  ));

  return <div style={{ padding: 8 }}>{renderItems(items)}</div>;
}
```

- [ ] **Step 4: Run the OutlinePanel tests to verify they pass**

Run: `corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/RightSidebar/OutlinePanel.tsx src/components/RightSidebar/OutlinePanel.test.tsx
git commit -m "feat: add outline panel navigation"
```

## Task 4: Wire the sidebar and cover debounced refresh behavior

**Files:**
- Modify: `src/components/RightSidebar/RightSidebar.tsx`
- Modify: `src/components/RightSidebar/RightSidebar.test.tsx`
- Modify: `src/components/RightSidebar/OutlinePanel.test.tsx`
- Test: `src/components/RightSidebar/RightSidebar.test.tsx`
- Test: `src/components/RightSidebar/OutlinePanel.test.tsx`

- [ ] **Step 1: Add the failing debounce and sidebar integration tests**

```tsx
it("debounces outline refresh while content changes rapidly", async () => {
  vi.useFakeTimers();
  apiMocks.getNoteOutline.mockResolvedValue([]);
  useEditorStore.setState({
    currentNote: { id: "note-1", path: "notes/demo.md", title: "Demo" } as any,
    content: "# One",
  });

  render(<OutlinePanel />);

  useEditorStore.setState({ content: "# One\n## Two" });
  useEditorStore.setState({ content: "# One\n## Two\n### Three" });

  vi.advanceTimersByTime(249);
  expect(apiMocks.getNoteOutline).toHaveBeenCalledTimes(0);

  vi.advanceTimersByTime(1);
  await waitFor(() => expect(apiMocks.getNoteOutline).toHaveBeenCalledTimes(1));
});

it("renders the outline panel in the default tab", () => {
  render(<RightSidebar />);

  expect(screen.getByText("打开笔记后显示大纲")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the sidebar-related Vitest files to verify they fail**

Run: `corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx`

Expected: FAIL because `RightSidebar` still renders the placeholder and the panel debounce behavior is not fully asserted.

- [ ] **Step 3: Wire the real panel into the sidebar**

```tsx
import { OutlinePanel } from "./OutlinePanel";

{activeTab === "outline" && <OutlinePanel />}
```

- [ ] **Step 4: Finalize the debounce test harness and timer cleanup**

```tsx
beforeEach(() => {
  vi.useRealTimers();
  useEditorStore.setState({ currentNote: null, content: "", searchNavigationTarget: null });
});

afterEach(() => {
  vi.useRealTimers();
});
```

- [ ] **Step 5: Run the sidebar-related Vitest files to verify they pass**

Run: `corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx`

Expected: PASS

- [ ] **Step 6: Run the focused backend and frontend verification set**

Run: `cargo test --manifest-path src-tauri/Cargo.toml get_note_outline_in_root_returns_nested_outline_items extracts_outline_blocks_up_to_level_three ignores_code_fences_and_supports_setext_headings && corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/RightSidebar/RightSidebar.tsx src/components/RightSidebar/RightSidebar.test.tsx src/components/RightSidebar/OutlinePanel.test.tsx
git commit -m "feat: wire note outline into sidebar"
```

## Task 5: Run the final end-to-end verification sweep

**Files:**
- Modify: none
- Test: `src-tauri/src/infrastructure/markdown.rs`
- Test: `src-tauri/src/services/note.rs`
- Test: `src/components/RightSidebar/OutlinePanel.test.tsx`
- Test: `src/components/RightSidebar/RightSidebar.test.tsx`

- [ ] **Step 1: Run the targeted Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml extract_note_outline_blocks get_note_outline_in_root`

Expected: PASS

- [ ] **Step 2: Run the targeted frontend suite**

Run: `corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx`

Expected: PASS

- [ ] **Step 3: Run the full frontend build as a regression check**

Run: `corepack pnpm build`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: ship current-note outline"
```

## Self-Review

### Spec coverage

- Current-note-only scope is covered by Task 2 service input and Task 3 panel fetch logic.
- Heading levels through `###` are covered by Task 1 extraction tests and implementation.
- Editor and preview synchronized jump behavior is covered by Task 3 reusing `searchNavigationTarget`.
- Right-sidebar rendering and placeholder replacement are covered by Task 4.
- Debounced refresh and failure-safe UI states are covered by Task 3 and Task 4 tests.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” markers remain.
- Every task includes exact file paths, code snippets, and concrete commands.
- Each executable step has an expected result.

### Type consistency

- Backend response type is `NoteOutlineItem` in Rust and TypeScript.
- Frontend click navigation uses existing `SearchNavigationTarget` field names: `line_start`, `line_end`, `match_text`, `context_snippet`, `revision`.
- Tauri command name is consistently `get_note_outline` from Rust registration through `api.getNoteOutline`.# Note Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a current-note outline in the right sidebar that extracts headings up to `###` and synchronizes navigation between the editor and preview panes.

**Architecture:** Reuse the existing note vertical slice. Centralize heading parsing and outline range calculation in Rust markdown infrastructure, expose a `get_note_outline` Tauri command through the note service, then render the returned outline tree in the right sidebar and reuse `searchNavigationTarget` for click-to-jump behavior. Keep the first release narrow: current note only, no folding, no scroll-follow activation.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Zustand, Vitest, Testing Library

---

## File Structure

- Modify: `src-tauri/src/infrastructure/markdown.rs`
  Responsibility: shared heading parsing, normalization, outline extraction, and unit tests.
- Modify: `src-tauri/src/domain/note.rs`
  Responsibility: add serializable outline item model shared by service and command layers.
- Modify: `src-tauri/src/services/note.rs`
  Responsibility: load note content, call outline extraction, and return outline data.
- Modify: `src-tauri/src/commands/note.rs`
  Responsibility: expose `get_note_outline` as a Tauri command.
- Modify: `src-tauri/src/lib.rs`
  Responsibility: register the new command.
- Modify: `src/types/index.ts`
  Responsibility: add `NoteOutlineItem` frontend type.
- Modify: `src/api/commands.ts`
  Responsibility: add `getNoteOutline(path)` invoke wrapper.
- Create: `src/components/RightSidebar/OutlinePanel.tsx`
  Responsibility: fetch, debounce-refresh, render outline states, and dispatch navigation.
- Create: `src/components/RightSidebar/OutlinePanel.test.tsx`
  Responsibility: validate empty states, rendering, debounce, and click navigation.
- Modify: `src/components/RightSidebar/RightSidebar.tsx`
  Responsibility: replace the outline placeholder with the real panel.
- Modify: `src/components/RightSidebar/RightSidebar.test.tsx`
  Responsibility: validate sidebar tab behavior after integrating the real outline panel.

### Task 1: Centralize Heading Parsing And Outline Extraction

**Files:**
- Modify: `src-tauri/src/infrastructure/markdown.rs`
- Test: `src-tauri/src/infrastructure/markdown.rs`

- [ ] **Step 1: Write the failing Rust tests for outline extraction**

```rust
#[test]
fn extracts_outline_tree_up_to_h3() {
    let content = "# 总览\n\n## 方案\n内容\n\n### 细节\n更多内容\n\n## 验收\n结尾";

    let outline = extract_note_outline(content).unwrap();

    assert_eq!(outline.len(), 1);
    assert_eq!(outline[0].text, "总览");
    assert_eq!(outline[0].children.len(), 2);
    assert_eq!(outline[0].children[0].text, "方案");
    assert_eq!(outline[0].children[0].children[0].text, "细节");
}

#[test]
fn ignores_headings_inside_fenced_code_blocks() {
    let content = "# 标题\n\n```md\n## 不应进入大纲\n```\n\n## 正文标题\n内容";

    let outline = extract_note_outline(content).unwrap();

    assert_eq!(outline[0].children.len(), 1);
    assert_eq!(outline[0].children[0].text, "正文标题");
}

#[test]
fn computes_line_end_before_next_same_or_higher_heading() {
    let content = "# 一\n第一段\n\n## 二\n第二段\n\n## 三\n第三段";

    let outline = extract_note_outline(content).unwrap();

    assert_eq!(outline[0].line_start, 1);
    assert_eq!(outline[0].line_end, 7);
    assert_eq!(outline[0].children[0].line_start, 4);
    assert_eq!(outline[0].children[0].line_end, 5);
}
```

- [ ] **Step 2: Run the markdown unit tests to verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml infrastructure::markdown::tests
```

Expected: FAIL with missing `extract_note_outline` or missing outline fields/helpers.

- [ ] **Step 3: Implement shared heading parsing and outline extraction in markdown infrastructure**

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct NoteOutlineItem {
    pub id: String,
    pub text: String,
    pub level: u8,
    pub line_start: i64,
    pub line_end: i64,
    pub anchor: String,
    pub children: Vec<NoteOutlineItem>,
}

pub fn extract_note_outline(content: &str) -> AppResult<Vec<NoteOutlineItem>> {
    let (_, body) = split_front_matter(content);
    let headings = collect_outline_headings(body)?;
    Ok(build_outline_tree(headings))
}

fn parse_atx_heading(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim_start();
    let level = trimmed.chars().take_while(|ch| *ch == '#').count() as u8;
    if !(1..=3).contains(&level) {
        return None;
    }
    let rest = trimmed.get(level as usize..)?.trim();
    if rest.is_empty() {
        return None;
    }
    Some((level, rest.trim_end_matches('#').trim().to_string()))
}
```

- [ ] **Step 4: Re-run the markdown unit tests and the duplicate-heading edge cases**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml infrastructure::markdown::tests
```

Expected: PASS with new outline tests plus existing front matter and summary tests still green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/infrastructure/markdown.rs
git commit -m "feat: add markdown note outline extraction"
```

### Task 2: Expose Outline Through The Note Service And Tauri Command

**Files:**
- Modify: `src-tauri/src/domain/note.rs`
- Modify: `src-tauri/src/services/note.rs`
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/commands/note.rs` or `src-tauri/src/services/note.rs`

- [ ] **Step 1: Write the failing command/service tests for `get_note_outline`**

```rust
#[test]
fn get_note_outline_in_root_returns_current_note_outline() {
    let temp_dir = tempfile::tempdir().unwrap();
    let root = temp_dir.path();
    std::fs::create_dir_all(root.join("notes")).unwrap();
    std::fs::write(
        root.join("notes/demo.md"),
        "---\ntitle: Demo\n---\n\n# 总览\n\n## 方案\n\n### 细节\n",
    ).unwrap();

    let outline = get_note_outline_in_root(root, "notes/demo.md").unwrap();

    assert_eq!(outline.len(), 1);
    assert_eq!(outline[0].children[0].children[0].text, "细节");
}

#[test]
fn get_note_outline_in_root_rejects_non_normalized_paths() {
    let temp_dir = tempfile::tempdir().unwrap();

    let error = get_note_outline_in_root(temp_dir.path(), "../demo.md").unwrap_err();

    assert!(format!("{error}").contains("Invalid input"));
}
```

- [ ] **Step 2: Run the focused note command/service tests to verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::note::tests
```

Expected: FAIL with missing `get_note_outline_in_root`, missing `NoteOutlineItem`, or missing command registration.

- [ ] **Step 3: Implement the domain model, service helper, command, and registration**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteOutlineItem {
    pub id: String,
    pub text: String,
    pub level: u8,
    pub line_start: i64,
    pub line_end: i64,
    pub anchor: String,
    pub children: Vec<NoteOutlineItem>,
}

pub fn get_note_outline_in_root(root: &Path, rel_path: &str) -> AppResult<Vec<NoteOutlineItem>> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let abs = resolve_kb_path(root, &rel_path)?;
    let content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", rel_path)))?;

    crate::infrastructure::markdown::extract_note_outline(&content)
}

#[tauri::command]
pub async fn get_note_outline(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<NoteOutlineItem>, AppError> {
    get_note_outline_service(&state, &path)
}
```

- [ ] **Step 4: Run the focused Rust validation for the new command slice**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::note::tests
cargo test --manifest-path src-tauri/Cargo.toml infrastructure::markdown::tests
```

Expected: PASS with `get_note_outline` tests and shared parser tests both green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/domain/note.rs src-tauri/src/services/note.rs src-tauri/src/commands/note.rs src-tauri/src/lib.rs
git commit -m "feat: expose note outline command"
```

### Task 3: Add Frontend Outline Types And API Wrapper

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Test: `src/components/RightSidebar/OutlinePanel.test.tsx`

- [ ] **Step 1: Write the failing frontend API usage test through the new outline panel test**

```tsx
it("loads outline items for the current note", async () => {
  apiMocks.getNoteOutline.mockResolvedValue([
    {
      id: "overview:1",
      text: "总览",
      level: 1,
      lineStart: 1,
      lineEnd: 6,
      anchor: "总览",
      children: [],
    },
  ]);

  useEditorStore.setState({
    currentNote: { id: "note-1", path: "notes/demo.md", title: "Demo" } as any,
  });

  render(<OutlinePanel />);

  expect(await screen.findByText("总览")).toBeInTheDocument();
  expect(apiMocks.getNoteOutline).toHaveBeenCalledWith("notes/demo.md");
});
```

- [ ] **Step 2: Run the new outline panel test to verify failure**

Run:

```bash
corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx
```

Expected: FAIL because `OutlinePanel`, `NoteOutlineItem`, or `api.getNoteOutline` does not exist yet.

- [ ] **Step 3: Add the shared TypeScript model and Tauri API wrapper**

```ts
export interface NoteOutlineItem {
  id: string;
  text: string;
  level: 1 | 2 | 3;
  lineStart: number;
  lineEnd: number;
  anchor: string;
  children: NoteOutlineItem[];
}

getNoteOutline: (path: string) =>
  invoke<NoteOutlineItem[]>("get_note_outline", { path }),
```

- [ ] **Step 4: Re-run the outline panel test to confirm the type/API layer is now unblocked**

Run:

```bash
corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx
```

Expected: FAIL later in rendering or interaction, not at import/type lookup.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/api/commands.ts
git commit -m "feat: add note outline frontend contract"
```

### Task 4: Build The Outline Panel And Integrate Sidebar Navigation

**Files:**
- Create: `src/components/RightSidebar/OutlinePanel.tsx`
- Create: `src/components/RightSidebar/OutlinePanel.test.tsx`
- Modify: `src/components/RightSidebar/RightSidebar.tsx`
- Modify: `src/components/RightSidebar/RightSidebar.test.tsx`

- [ ] **Step 1: Write the failing UI and navigation tests**

```tsx
it("shows an empty state when no note is selected", () => {
  useEditorStore.setState({ currentNote: null });

  render(<OutlinePanel />);

  expect(screen.getByText("打开笔记后显示大纲")).toBeInTheDocument();
});

it("dispatches searchNavigationTarget when an outline item is clicked", async () => {
  const user = userEvent.setup();
  apiMocks.getNoteOutline.mockResolvedValue([
    {
      id: "plan:4",
      text: "方案",
      level: 2,
      lineStart: 4,
      lineEnd: 8,
      anchor: "方案",
      children: [],
    },
  ]);

  useEditorStore.setState({
    currentNote: { id: "note-1", path: "notes/demo.md", title: "Demo" } as any,
    searchNavigationTarget: null,
  });

  render(<OutlinePanel />);
  await user.click(await screen.findByRole("button", { name: "方案" }));

  expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
    note_path: "notes/demo.md",
    line_start: 4,
    line_end: 8,
    match_text: "方案",
  });
});

it("renders OutlinePanel inside the outline tab", async () => {
  useEditorStore.setState({
    currentNote: { id: "note-1", path: "notes/demo.md", title: "Demo" } as any,
  });
  apiMocks.getNoteOutline.mockResolvedValue([]);

  render(<RightSidebar />);

  expect(await screen.findByText("当前笔记暂无可用标题")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused sidebar tests to verify failure**

Run:

```bash
corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx
```

Expected: FAIL because the outline panel component and integration behavior are not implemented yet.

- [ ] **Step 3: Implement `OutlinePanel` with debounce refresh and shared navigation dispatch**

```tsx
export function OutlinePanel() {
  const currentNote = useEditorStore((state) => state.currentNote);
  const setSearchNavigationTarget = useEditorStore((state) => state.setSearchNavigationTarget);
  const [items, setItems] = useState<NoteOutlineItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentNote?.path) {
      setItems(null);
      setError(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setItems(await api.getNoteOutline(currentNote.path));
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载大纲失败");
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [currentNote?.path, currentNote?.title]);

  const handleNavigate = (item: NoteOutlineItem) => {
    if (!currentNote) return;
    setSearchNavigationTarget({
      note_id: currentNote.id,
      note_path: currentNote.path,
      note_title: currentNote.title,
      line_start: item.lineStart,
      line_end: item.lineEnd,
      occurrence_order: 1,
      match_text: item.text,
      context_snippet: item.text,
      source: "body",
      revision: Date.now(),
    });
  };
}
```

- [ ] **Step 4: Run the focused frontend validation and full build**

Run:

```bash
corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx
corepack pnpm build
```

Expected: PASS with the outline panel tests green and the application build succeeding.

- [ ] **Step 5: Commit**

```bash
git add src/components/RightSidebar/OutlinePanel.tsx src/components/RightSidebar/OutlinePanel.test.tsx src/components/RightSidebar/RightSidebar.tsx src/components/RightSidebar/RightSidebar.test.tsx
git commit -m "feat: render note outline in right sidebar"
```

### Task 5: End-To-End Slice Validation For Outline Navigation

**Files:**
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
- Test: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`

- [ ] **Step 1: Add a failing integration test proving editor and preview receive the same outline navigation target**

```tsx
it("passes outline navigation targets to both editor and preview", async () => {
  useEditorStore.setState({
    currentNote: { id: "note-1", path: "notes/demo.md", title: "Demo" } as any,
    searchNavigationTarget: {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 4,
      line_end: 8,
      occurrence_order: 1,
      match_text: "方案",
      context_snippet: "方案",
      source: "body",
      revision: 1,
    },
  });

  render(<EditorWorkspace />);

  expect(capturedProps.editor?.searchNavigationTarget).toMatchObject({ line_start: 4, line_end: 8 });
  expect(capturedProps.preview?.searchNavigationTarget).toMatchObject({ line_start: 4, line_end: 8 });
});
```

- [ ] **Step 2: Run the focused workspace test to verify behavior before any repair**

Run:

```bash
corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx
```

Expected: PASS if no regression is needed, or FAIL if the new outline dispatch exposes a mismatch in the existing navigation chain.

- [ ] **Step 3: Repair only if the test exposes a real navigation gap**

```tsx
const activeSearchNavigationTarget = searchNavigationTarget
  && (searchNavigationTarget.revision > (tagNavigationTarget?.revision ?? -1))
  ? searchNavigationTarget
  : null;
```

If the test already passes, make no production code change in this step.

- [ ] **Step 4: Run the full feature validation suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml infrastructure::markdown::tests
cargo test --manifest-path src-tauri/Cargo.toml commands::note::tests
corepack pnpm vitest run src/components/RightSidebar/OutlinePanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
corepack pnpm build
```

Expected: PASS across Rust parser/command tests, React sidebar tests, workspace navigation tests, and application build.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorWorkspace/EditorWorkspace.test.tsx
git commit -m "test: validate outline navigation sync"
```

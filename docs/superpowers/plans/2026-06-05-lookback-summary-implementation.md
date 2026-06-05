# Lookback Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-burden, semi-automatic lookback summary flow that surfaces under the note title, generates a local candidate summary, saves only on explicit user confirmation, and feeds search/result judgment.

**Architecture:** Keep `summary` as the single persisted field in Markdown Front Matter and SQLite. Add a focused Rust summary service plus Tauri commands for candidate generation and explicit save, then add a small React orchestration hook and a dedicated summary card in the editor workspace. Use a lightweight Zustand store to track prompt throttling and recent-open signals so suggestion logic stays isolated from the core editor store.

**Tech Stack:** React 19 + TypeScript + Zustand + Vitest on the frontend; Tauri + Rust + rusqlite + serde_yaml on the backend.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-05 | v1.0 | 按 superpowers writing-plans 流程生成正式 implementation plan。 |

## 目录

- [Task 1: Backend Summary Commands](#task-1-backend-summary-commands)
- [Task 2: Frontend Summary Hook](#task-2-frontend-summary-hook)
- [Task 3: Summary Card UI](#task-3-summary-card-ui)
- [Task 4: Suggestion Signals And Throttling](#task-4-suggestion-signals-and-throttling)
- [Task 5: Search And Sidebar Surfacing](#task-5-search-and-sidebar-surfacing)
- [Task 6: Full Verification](#task-6-full-verification)

### Task 1: Backend Summary Commands

**Files:**
- Create: `src-tauri/src/services/summary.rs`
- Create: `src-tauri/src/commands/summary.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/services/note.rs`
- Modify: `src/api/commands.ts`

- [ ] **Step 1: Write failing Rust tests for candidate generation and explicit summary save**

Add these tests to `src-tauri/src/services/summary.rs` first:

```rust
#[cfg(test)]
mod tests {
    use super::{build_summary_candidate, save_note_summary_in_conn};
    use crate::infrastructure::db::init_db;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn seed_note(conn: &Connection, path: &str, title: &str, body: &str) {
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at)
             VALUES ('note-1', ?1, ?2, NULL, 'hash', 120, '2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z', NULL)",
            rusqlite::params![path, title],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES ('note-1', ?1, '', ?2)",
            rusqlite::params![title, body],
        ).unwrap();
    }

    #[test]
    fn builds_candidate_from_heading_and_intro() {
        let content = "---\ntitle: Demo\n---\n\n# Demo\n\n这是一段用于测试的首段内容。\n\n## 要点\n\n- 第一条\n- 第二条";
        let candidate = build_summary_candidate(content, "Demo").unwrap();
        assert!(candidate.contains("这是一段用于测试的首段内容"));
        assert!(candidate.contains("要点"));
    }

    #[test]
    fn save_note_summary_updates_front_matter_and_note_index() {
        let root = tempdir().unwrap();
        let notes_dir = root.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        let note_path = notes_dir.join("demo.md");
        std::fs::write(&note_path, "---\ntitle: Demo\n---\n\n# Demo\n\nBody").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        seed_note(&conn, "notes/demo.md", "Demo", "Body");

        let note = save_note_summary_in_conn(&conn, root.path(), "notes/demo.md", "新的回看摘要").unwrap();
        assert_eq!(note.summary.as_deref(), Some("新的回看摘要"));

        let saved = std::fs::read_to_string(&note_path).unwrap();
        assert!(saved.contains("summary: 新的回看摘要"));
    }
}
```

- [ ] **Step 2: Run targeted Rust tests and verify they fail**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test builds_candidate_from_heading_and_intro save_note_summary_updates_front_matter_and_note_index
```

Expected: FAIL because `summary.rs` and the tested functions do not exist yet.

- [ ] **Step 3: Implement the summary service and commands**

Create `src-tauri/src/services/summary.rs` with focused helpers:

```rust
use crate::domain::note::Note;
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::resolve_kb_path;
use crate::infrastructure::markdown::{extract_h1, parse_note, render_note, split_front_matter, FrontMatter};
use crate::services::index::index_note_full;
use rusqlite::{params, Connection};
use std::path::Path;

const MAX_SUMMARY_CHARS: usize = 180;

pub fn build_summary_candidate(content: &str, fallback_title: &str) -> AppResult<String> {
    let parsed = parse_note(content, fallback_title)?;
    let intro = parsed
        .body
        .split("\n\n")
        .map(str::trim)
        .find(|segment| !segment.is_empty() && !segment.starts_with('#'))
        .unwrap_or("");

    let headings = parsed
        .body
        .lines()
        .filter_map(|line| line.trim().strip_prefix("## ").or_else(|| line.trim().strip_prefix("# ")))
        .take(2)
        .collect::<Vec<_>>()
        .join("，");

    let mut candidate = intro.to_string();
    if !headings.is_empty() {
        if !candidate.is_empty() {
            candidate.push('；');
        }
        candidate.push_str("重点包括");
        candidate.push_str(&headings);
    }

    let normalized = candidate.split_whitespace().collect::<Vec<_>>().join(" ");
    let truncated = normalized.chars().take(MAX_SUMMARY_CHARS).collect::<String>();
    if truncated.is_empty() {
        Ok(extract_h1(&parsed.body).unwrap_or_else(|| fallback_title.to_string()))
    } else {
        Ok(truncated)
    }
}

pub fn save_note_summary_in_conn(
    conn: &Connection,
    root: &Path,
    rel_path: &str,
    summary: &str,
) -> AppResult<Note> {
    let abs = resolve_kb_path(root, rel_path)?;
    let content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", rel_path)))?;
    let (front_matter_raw, body) = split_front_matter(&content);
    let mut fm = if let Some(raw) = front_matter_raw {
        crate::infrastructure::markdown::parse_front_matter(raw)?
    } else {
        FrontMatter::default()
    };
    fm.summary = Some(summary.trim().to_string());
    let rendered = render_note(&fm, body)?;
    std::fs::write(&abs, &rendered)?;
    index_note_full(conn, root, rel_path, &rendered)
}
```

Create `src-tauri/src/commands/summary.rs`:

```rust
use crate::error::AppError;
use crate::services::summary::{build_summary_candidate, save_note_summary_in_conn};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn generate_summary_candidate(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let abs = crate::infrastructure::fs::resolve_kb_path(root, &path)?;
    let content = std::fs::read_to_string(abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", path)))?;
    Ok(build_summary_candidate(&content, path.rsplit('/').next().unwrap_or("Untitled"))?)
}

#[tauri::command]
pub async fn save_note_summary(
    state: State<'_, AppState>,
    path: String,
    summary: String,
) -> Result<crate::domain::note::Note, AppError> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    save_note_summary_in_conn(conn, root, &path, &summary)
}
```

Register them:

```rust
// src-tauri/src/services/mod.rs
pub mod summary;

// src-tauri/src/commands/mod.rs
pub mod summary;

// src-tauri/src/lib.rs
commands::summary::generate_summary_candidate,
commands::summary::save_note_summary,
```

Expose them in `src/api/commands.ts`:

```ts
  generateSummaryCandidate: (path: string) =>
    invoke<string>("generate_summary_candidate", { path }),

  saveNoteSummary: (path: string, summary: string) =>
    invoke<Note>("save_note_summary", { path, summary }),
```

- [ ] **Step 4: Run targeted backend verification**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test builds_candidate_from_heading_and_intro save_note_summary_updates_front_matter_and_note_index
```

Expected: PASS for the two new tests.

- [ ] **Step 5: Commit backend summary APIs**

Run:

```bash
git add src-tauri/src/services/summary.rs src-tauri/src/commands/summary.rs src-tauri/src/services/mod.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/api/commands.ts
git commit -m "feat: add lookback summary backend commands"
```

### Task 2: Frontend Summary Hook

**Files:**
- Create: `src/hooks/useLookbackSummary.ts`
- Create: `src/hooks/useLookbackSummary.test.tsx`
- Modify: `src/test/testData.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write failing hook tests for generate and save flows**

Create `src/hooks/useLookbackSummary.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLookbackSummary } from "./useLookbackSummary";
import { useEditorStore } from "../store/useEditorStore";
import { makeNote } from "../test/testData";
import { api } from "../api/commands";

vi.mock("../api/commands", () => ({
  api: {
    generateSummaryCandidate: vi.fn(),
    saveNoteSummary: vi.fn(),
    getNoteLinks: vi.fn(),
  },
}));

describe("useLookbackSummary", () => {
  it("loads a candidate only on explicit generate", async () => {
    useEditorStore.setState({ currentNote: makeNote({ path: "notes/demo.md", summary: null, word_count: 350 }) });
    vi.mocked(api.generateSummaryCandidate).mockResolvedValueOnce("候选摘要");

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.generateCandidate();
    });

    expect(result.current.candidate).toBe("候选摘要");
    expect(api.generateSummaryCandidate).toHaveBeenCalledWith("notes/demo.md");
  });

  it("updates current note after explicit save", async () => {
    useEditorStore.setState({ currentNote: makeNote({ path: "notes/demo.md", summary: null, word_count: 350 }) });
    vi.mocked(api.saveNoteSummary).mockResolvedValueOnce(makeNote({ path: "notes/demo.md", summary: "已保存摘要" }));

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      result.current.setCandidate("已保存摘要");
      await result.current.saveCandidate();
    });

    expect(useEditorStore.getState().currentNote?.summary).toBe("已保存摘要");
  });
});
```

- [ ] **Step 2: Run the hook tests and verify they fail**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx
```

Expected: FAIL because `useLookbackSummary.ts` does not exist yet.

- [ ] **Step 3: Implement the orchestration hook**

Create `src/hooks/useLookbackSummary.ts`:

```ts
import { useCallback, useMemo, useState } from "react";
import { api } from "../api/commands";
import { useEditorStore } from "../store/useEditorStore";

export function useLookbackSummary() {
  const currentNote = useEditorStore((s) => s.currentNote);
  const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
  const [candidate, setCandidate] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedSummary = currentNote?.summary ?? "";
  const hasSummary = Boolean(savedSummary.trim());

  const generateCandidate = useCallback(async () => {
    if (!currentNote) return;
    setIsGenerating(true);
    setError(null);
    try {
      const nextCandidate = await api.generateSummaryCandidate(currentNote.path);
      setCandidate(nextCandidate);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setIsGenerating(false);
    }
  }, [currentNote]);

  const saveCandidate = useCallback(async () => {
    if (!currentNote) return;
    const trimmed = candidate.trim();
    if (!trimmed) return;
    setIsSaving(true);
    setError(null);
    try {
      const note = await api.saveNoteSummary(currentNote.path, trimmed);
      setCurrentNote(note);
      setCandidate(trimmed);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setIsSaving(false);
    }
  }, [candidate, currentNote, setCurrentNote]);

  return useMemo(() => ({
    candidate,
    setCandidate,
    savedSummary,
    hasSummary,
    isGenerating,
    isSaving,
    error,
    generateCandidate,
    saveCandidate,
  }), [candidate, error, generateCandidate, hasSummary, isGenerating, isSaving, saveCandidate, savedSummary]);
}
```

If you add helper types, define them in `src/types/index.ts` instead of inline string unions.

- [ ] **Step 4: Run the hook tests and verify they pass**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the summary hook**

Run:

```bash
git add src/hooks/useLookbackSummary.ts src/hooks/useLookbackSummary.test.tsx src/test/testData.ts src/types/index.ts
git commit -m "feat: add lookback summary hook"
```

### Task 3: Summary Card UI

**Files:**
- Create: `src/components/EditorWorkspace/LookbackSummaryCard.tsx`
- Create: `src/components/EditorWorkspace/LookbackSummaryCard.test.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`

- [ ] **Step 1: Write failing component and integration tests**

Add a card-level test in `src/components/EditorWorkspace/LookbackSummaryCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LookbackSummaryCard } from "./LookbackSummaryCard";

describe("LookbackSummaryCard", () => {
  it("shows explicit generate action when there is no saved summary", () => {
    render(
      <LookbackSummaryCard
        savedSummary=""
        candidate=""
        hasSummary={false}
        isGenerating={false}
        isSaving={false}
        error={null}
        onChangeCandidate={vi.fn()}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "生成候选摘要" })).toBeInTheDocument();
  });
});
```

Add an integration assertion to `src/components/EditorWorkspace/EditorWorkspace.test.tsx`:

```tsx
it("renders the lookback summary card under the note title", () => {
  useEditorStore.setState({
    currentNote: makeNote({ path: "notes/demo.md", title: "Demo", summary: "这是一条摘要" }),
  });

  render(<EditorWorkspace />);

  expect(screen.getByText("回看摘要")).toBeInTheDocument();
  expect(screen.getByText("这是一条摘要")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the UI tests and verify they fail**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/EditorWorkspace/LookbackSummaryCard.test.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
```

Expected: FAIL because the card component is not implemented yet.

- [ ] **Step 3: Implement the summary card and mount it below the title bar**

Create `src/components/EditorWorkspace/LookbackSummaryCard.tsx`:

```tsx
type LookbackSummaryCardProps = {
  savedSummary: string;
  candidate: string;
  hasSummary: boolean;
  isGenerating: boolean;
  isSaving: boolean;
  error: string | null;
  onChangeCandidate: (value: string) => void;
  onGenerate: () => void;
  onSave: () => void;
};

export function LookbackSummaryCard(props: LookbackSummaryCardProps) {
  const displayValue = props.candidate || props.savedSummary;

  return (
    <section style={{
      borderBottom: "1px solid #e5e7eb",
      padding: "12px 16px",
      background: "linear-gradient(180deg, #fffdf5 0%, #fff 100%)",
      display: "grid",
      gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>回看摘要</strong>
        {!props.hasSummary && <span style={{ fontSize: 12, color: "#a16207" }}>可选，不影响正常写作</span>}
      </div>

      {displayValue ? (
        <textarea
          aria-label="回看摘要内容"
          value={displayValue}
          onChange={(event) => props.onChangeCandidate(event.target.value)}
          rows={3}
          style={{ resize: "vertical", width: "100%", fontSize: 13, lineHeight: 1.6 }}
        />
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
          用一句到两句帮助未来的你快速判断这篇笔记值不值得重读。
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={props.onGenerate} disabled={props.isGenerating}>
          {props.isGenerating ? "生成中..." : "生成候选摘要"}
        </button>
        <button type="button" onClick={props.onSave} disabled={props.isSaving || !displayValue.trim()}>
          {props.isSaving ? "保存中..." : "保存回看摘要"}
        </button>
      </div>

      {props.error && <div style={{ fontSize: 12, color: "#dc2626" }}>{props.error}</div>}
    </section>
  );
}
```

Integrate it in `src/components/EditorWorkspace/EditorWorkspace.tsx` immediately below the title row:

```tsx
import { useLookbackSummary } from "../../hooks/useLookbackSummary";
import { LookbackSummaryCard } from "./LookbackSummaryCard";

const lookbackSummary = useLookbackSummary();

<LookbackSummaryCard
  savedSummary={lookbackSummary.savedSummary}
  candidate={lookbackSummary.candidate}
  hasSummary={lookbackSummary.hasSummary}
  isGenerating={lookbackSummary.isGenerating}
  isSaving={lookbackSummary.isSaving}
  error={lookbackSummary.error}
  onChangeCandidate={lookbackSummary.setCandidate}
  onGenerate={() => void lookbackSummary.generateCandidate()}
  onSave={() => void lookbackSummary.saveCandidate()}
/>
```

- [ ] **Step 4: Run focused UI verification**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/EditorWorkspace/LookbackSummaryCard.test.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the UI slice**

Run:

```bash
git add src/components/EditorWorkspace/LookbackSummaryCard.tsx src/components/EditorWorkspace/LookbackSummaryCard.test.tsx src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
git commit -m "feat: surface lookback summary in editor workspace"
```

### Task 4: Suggestion Signals And Throttling

**Files:**
- Create: `src/store/useLookbackSummaryStore.ts`
- Create: `src/store/useLookbackSummaryStore.test.ts`
- Modify: `src/hooks/useOpenNote.ts`
- Modify: `src/hooks/useLookbackSummary.ts`
- Modify: `src/api/commands.ts`

- [ ] **Step 1: Write failing store tests for prompt throttling**

Create `src/store/useLookbackSummaryStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLookbackSummaryStore } from "./useLookbackSummaryStore";

beforeEach(() => {
  useLookbackSummaryStore.getState().resetForTest();
});

describe("useLookbackSummaryStore", () => {
  it("records note opens and throttles prompts within 24 hours", () => {
    const now = new Date("2026-06-05T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    useLookbackSummaryStore.getState().recordOpen("notes/demo.md");
    useLookbackSummaryStore.getState().markPromptShown("notes/demo.md");

    expect(useLookbackSummaryStore.getState().shouldPrompt("notes/demo.md", { wordCount: 400, recentViews: 1, backlinks: 2 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the store tests and verify they fail**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/store/useLookbackSummaryStore.test.ts
```

Expected: FAIL because the store does not exist yet.

- [ ] **Step 3: Implement prompt state and connect it to note opening**

Create `src/store/useLookbackSummaryStore.ts`:

```ts
import { create } from "zustand";

const DAY_MS = 24 * 60 * 60 * 1000;

type SignalInput = {
  wordCount: number;
  recentViews: number;
  backlinks: number;
};

interface LookbackSummaryState {
  openCounts: Record<string, number>;
  lastOpenedAt: Record<string, number>;
  lastPromptAt: Record<string, number>;
  recordOpen: (path: string) => void;
  markPromptShown: (path: string) => void;
  shouldPrompt: (path: string, signal: SignalInput) => boolean;
  resetForTest: () => void;
}

export const useLookbackSummaryStore = create<LookbackSummaryState>((set, get) => ({
  openCounts: {},
  lastOpenedAt: {},
  lastPromptAt: {},
  recordOpen: (path) => set((state) => ({
    openCounts: { ...state.openCounts, [path]: (state.openCounts[path] ?? 0) + 1 },
    lastOpenedAt: { ...state.lastOpenedAt, [path]: Date.now() },
  })),
  markPromptShown: (path) => set((state) => ({
    lastPromptAt: { ...state.lastPromptAt, [path]: Date.now() },
  })),
  shouldPrompt: (path, signal) => {
    const lastPrompt = get().lastPromptAt[path] ?? 0;
    if (Date.now() - lastPrompt < DAY_MS) return false;
    const meetsWordCount = signal.wordCount >= 300;
    const meetsViews = signal.recentViews >= 2;
    const meetsBacklinks = signal.backlinks >= 1;
    return meetsWordCount || meetsViews || meetsBacklinks;
  },
  resetForTest: () => set({ openCounts: {}, lastOpenedAt: {}, lastPromptAt: {} }),
}));
```

Update `src/hooks/useOpenNote.ts` after `setCurrentNote(detail.note);`:

```ts
import { useLookbackSummaryStore } from "../store/useLookbackSummaryStore";

const recordLookbackOpen = useLookbackSummaryStore((s) => s.recordOpen);

recordLookbackOpen(path);
```

Extend `src/hooks/useLookbackSummary.ts` to fetch backlinks lazily and expose `shouldSuggest`:

```ts
const [backlinkCount, setBacklinkCount] = useState(0);
const openCounts = useLookbackSummaryStore((s) => s.openCounts);
const shouldPrompt = useLookbackSummaryStore((s) => s.shouldPrompt);
const markPromptShown = useLookbackSummaryStore((s) => s.markPromptShown);

useEffect(() => {
  if (!currentNote?.id) return;
  api.getNoteLinks(currentNote.id)
    .then((links) => setBacklinkCount(links.incoming.length))
    .catch(() => setBacklinkCount(0));
}, [currentNote?.id]);

const shouldSuggest = currentNote
  ? !currentNote.summary && shouldPrompt(currentNote.path, {
      wordCount: currentNote.word_count,
      recentViews: openCounts[currentNote.path] ?? 0,
      backlinks: backlinkCount,
    })
  : false;

useEffect(() => {
  if (currentNote && shouldSuggest) {
    markPromptShown(currentNote.path);
  }
}, [currentNote, markPromptShown, shouldSuggest]);
```

- [ ] **Step 4: Run focused prompt-state verification**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/store/useLookbackSummaryStore.test.ts src/hooks/useLookbackSummary.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the prompt logic**

Run:

```bash
git add src/store/useLookbackSummaryStore.ts src/store/useLookbackSummaryStore.test.ts src/hooks/useOpenNote.ts src/hooks/useLookbackSummary.ts
git commit -m "feat: add lookback summary prompt throttling"
```

### Task 5: Search And Sidebar Surfacing

**Files:**
- Modify: `src-tauri/src/domain/search.rs`
- Modify: `src-tauri/src/commands/search.rs`
- Modify: `src/types/index.ts`
- Modify: `src/hooks/useSearch.test.ts`
- Modify: `src/components/SearchOverlay.tsx`
- Modify: `src/components/SearchOverlay.test.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Write failing tests for summary snippets in search and sidebar hover**

Add this frontend expectation to `src/components/SearchOverlay.test.tsx`:

```tsx
it("shows summary text when a result includes summary_snippet", async () => {
  setSearchResults([
    makeSearchResult({
      title: "Demo",
      summary_snippet: "用一句话概括这篇笔记",
    }),
  ]);

  renderSearchOverlay();
  const input = screen.getByPlaceholderText("输入关键词搜索笔记");
  await userEvent.type(input, "demo");

  expect(await screen.findByText("用一句话概括这篇笔记")).toBeInTheDocument();
});
```

Add this sidebar hover test to `src/components/LeftSidebar/FileTreePanel.test.tsx`:

```tsx
it("shows note summary on note hover when available", async () => {
  api.getNoteByPath = vi.fn().mockResolvedValue({
    note: makeNote({ path: "notes/法律/案例.md", summary: "案例要点摘要" }),
    content: "# 案例\n\nBody",
  });

  render(<FileTreePanel />);
  await userEvent.hover(screen.getByRole("button", { name: "案例.md" }));

  expect(await screen.findByText("案例要点摘要")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused surfacing tests and verify they fail**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/SearchOverlay.test.tsx src/components/LeftSidebar/FileTreePanel.test.tsx src/hooks/useSearch.test.ts
```

Expected: FAIL because `summary_snippet` is not in the DTO/UI yet.

- [ ] **Step 3: Extend search DTOs and surface summaries**

Update `src-tauri/src/domain/search.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub summary_snippet: Option<String>,
    pub line_start: i64,
    pub line_end: i64,
    pub occurrence_order: i64,
    pub match_text: String,
    pub source: SearchResultSource,
    pub link_target_path: Option<String>,
    pub link_target_title: Option<String>,
    pub link_target_href: Option<String>,
    pub score: f64,
}
```

In `src-tauri/src/commands/search.rs`, populate `summary_snippet` from `notes.summary` when building each `SearchResult`.

Update `src/types/index.ts`:

```ts
export interface SearchResult extends SearchHitLocation {
  title: string;
  path: string;
  snippet: string;
  summary_snippet?: string | null;
  link_target_path?: string | null;
  link_target_title?: string | null;
  link_target_href?: string | null;
  score: number;
}
```

Render it in `src/components/SearchOverlay.tsx` under the main snippet:

```tsx
{result.summary_snippet && (
  <div style={{ fontSize: 12, color: "#92400e", marginTop: 4 }}>
    回看摘要：{result.summary_snippet}
  </div>
)}
```

For `src/components/LeftSidebar/FileTreePanel.tsx`, add a lightweight hover preview state and fetch `api.getNoteByPath(node.path)` for file nodes only, then show summary in a floating box near the hovered row:

```tsx
const [hoverSummary, setHoverSummary] = useState<{ path: string; summary: string } | null>(null);

async function handleNoteHover(path: string) {
  const detail = await api.getNoteByPath(path);
  const summary = detail.note.summary?.trim();
  setHoverSummary(summary ? { path, summary } : null);
}
```

- [ ] **Step 4: Run focused search/sidebar verification**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/SearchOverlay.test.tsx src/components/LeftSidebar/FileTreePanel.test.tsx src/hooks/useSearch.test.ts
cd /Users/lijun/mynote/src-tauri
cargo test search_notes
```

Expected: PASS.

- [ ] **Step 5: Commit summary surfacing**

Run:

```bash
git add src-tauri/src/domain/search.rs src-tauri/src/commands/search.rs src/types/index.ts src/hooks/useSearch.test.ts src/components/SearchOverlay.tsx src/components/SearchOverlay.test.tsx src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "feat: surface lookback summaries in search and sidebar"
```

### Task 6: Full Verification

**Files:**
- No new code files.
- Verify all files touched in Tasks 1-5.

- [ ] **Step 1: Run the focused frontend suite for the touched slices**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run \
  src/hooks/useLookbackSummary.test.tsx \
  src/store/useLookbackSummaryStore.test.ts \
  src/components/EditorWorkspace/LookbackSummaryCard.test.tsx \
  src/components/EditorWorkspace/EditorWorkspace.test.tsx \
  src/components/SearchOverlay.test.tsx \
  src/components/LeftSidebar/FileTreePanel.test.tsx \
  src/hooks/useSearch.test.ts
```

Expected: PASS with 0 failed tests.

- [ ] **Step 2: Run the frontend build**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm build
```

Expected: exit code 0.

- [ ] **Step 3: Run the backend test suite**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test
```

Expected: PASS with 0 failed tests.

- [ ] **Step 4: Manual acceptance pass in the running app**

Verify these scenarios manually:

```text
1. Open a long note without summary: card is visible under the title and offers “生成候选摘要”.
2. Click generate: candidate appears but note summary stays unchanged until explicit save.
3. Click save: front matter gains summary, current note summary updates, search can show the summary snippet.
4. Re-open the same note within 24 hours: no repeated active prompt.
5. Hover a summarized note in the left sidebar: summary preview appears.
```

- [ ] **Step 5: Commit the verification checkpoint**

Run:

```bash
git add -A
git commit -m "test: verify lookback summary workflow"
```
# Lookback Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 4A “回看摘要” feature so notes can surface a low-burden, semi-automatic summary at the top of the editor, with explicit user confirmation before save.

**Architecture:** Keep `summary` as the only persisted field in Front Matter and SQLite. Add a dedicated Rust summary service for candidate generation and save operations, then expose a single front-end summary card in `EditorWorkspace` so editor and preview share one interaction surface instead of duplicating UI in both panes.

**Tech Stack:** React 19 + TypeScript + Zustand + Vitest, Tauri commands, Rust services, SQLite/FTS5.

---

## File Map

### New files

- `src/hooks/useLookbackSummary.ts`
- `src/hooks/useLookbackSummary.test.tsx`
- `src/store/useLookbackSummaryStore.ts`
- `src/components/EditorWorkspace/LookbackSummaryCard.tsx`
- `src/components/EditorWorkspace/LookbackSummaryCard.test.tsx`
- `src-tauri/src/services/summary.rs`
- `src-tauri/src/commands/summary.rs`

### Modified files

- `src/api/commands.ts`
- `src/types/index.ts`
- `src/components/EditorWorkspace/EditorWorkspace.tsx`
- `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
- `src/components/SearchOverlay.tsx`
- `src/components/SearchOverlay.test.tsx`
- `src/components/LeftSidebar/FileTreePanel.tsx`
- `src/components/LeftSidebar/FileTreePanel.test.tsx`
- `src/hooks/useOpenNote.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/services/mod.rs`
- `src-tauri/src/services/note.rs`
- `src-tauri/src/domain/search.rs`
- `src-tauri/src/commands/search.rs`

---

### Task 1: Add Rust summary generation and save commands

**Files:**
- Create: `src-tauri/src/services/summary.rs`
- Create: `src-tauri/src/commands/summary.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/services/note.rs`

- [ ] **Step 1: Write the failing Rust tests for candidate generation and summary persistence**

Add these tests in `src-tauri/src/services/summary.rs` first:

```rust
#[cfg(test)]
mod tests {
    use super::{build_summary_candidate, save_note_summary_in_root};
    use rusqlite::Connection;
    use tempfile::tempdir;
    use std::fs;
    use crate::infrastructure::db::init_db;
    use crate::services::index::index_note_full;

    #[test]
    fn build_summary_candidate_prefers_intro_and_headings() {
        let content = "---\ntitle: Demo\n---\n\n# Demo\n\nThis note explains the payment approval flow.\n\n## Risk\n\nLarge contracts need double review.";
        let candidate = build_summary_candidate(content, 160).unwrap();
        assert!(candidate.contains("payment approval flow"));
        assert!(candidate.contains("double review"));
    }

    #[test]
    fn save_note_summary_in_root_updates_front_matter_and_preserves_other_fields() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("notes")).unwrap();
        let path = "notes/demo.md";
        let content = "---\ntitle: Demo\ntags:\n  - flow\n---\n\n# Demo\n\nBody";
        fs::write(root.path().join(path), content).unwrap();

        let mut conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        index_note_full(&conn, root.path(), path, content).unwrap();

        let updated = save_note_summary_in_root(&conn, root.path(), path, "审批流程与双人复核".into()).unwrap();
        let saved = fs::read_to_string(root.path().join(path)).unwrap();

        assert_eq!(updated.summary.as_deref(), Some("审批流程与双人复核"));
        assert!(saved.contains("summary: 审批流程与双人复核"));
        assert!(saved.contains("- flow"));
    }
}
```

- [ ] **Step 2: Run the focused Rust tests and confirm they fail for missing implementation**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test build_summary_candidate_prefers_intro_and_headings save_note_summary_in_root_updates_front_matter_and_preserves_other_fields
```

Expected: FAIL with unresolved imports or missing functions in `services/summary.rs`.

- [ ] **Step 3: Implement the summary service and command wrappers**

Create `src-tauri/src/services/summary.rs` with the minimal implementation shape below:

```rust
use crate::domain::note::Note;
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{normalize_kb_relative_path, resolve_kb_path};
use crate::infrastructure::markdown::{parse_note, render_note, split_front_matter, parse_front_matter, FrontMatter};
use crate::services::index::index_note_full;
use rusqlite::Connection;
use std::path::Path;

const DEFAULT_SUMMARY_LENGTH: usize = 180;

pub fn build_summary_candidate(content: &str, max_len: usize) -> AppResult<String> {
    let parsed = parse_note(content, "untitled")?;
    let mut parts = Vec::new();

    if let Some(first_paragraph) = parsed.body.split("\n\n").map(str::trim).find(|block| !block.is_empty() && !block.starts_with('#')) {
        parts.push(first_paragraph.to_string());
    }

    for line in parsed.body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") || trimmed.starts_with("### ") {
            parts.push(trimmed.trim_start_matches('#').trim().to_string());
        }
        if parts.len() >= 3 {
            break;
        }
    }

    let joined = parts.join("；");
    Ok(joined.chars().take(max_len.max(DEFAULT_SUMMARY_LENGTH)).collect())
}

pub fn save_note_summary_in_root(conn: &Connection, root: &Path, rel_path: &str, summary: String) -> AppResult<Note> {
    let rel_path = normalize_kb_relative_path(rel_path)?;
    let abs_path = resolve_kb_path(root, &rel_path)?;
    let current = std::fs::read_to_string(&abs_path)?;
    let (front_matter_raw, body) = split_front_matter(&current);
    let mut front_matter = match front_matter_raw {
        Some(raw) => parse_front_matter(raw)?,
        None => FrontMatter::default(),
    };
    front_matter.summary = Some(summary.trim().to_string());
    let updated = render_note(&front_matter, body)?;
    std::fs::write(&abs_path, &updated)?;
    index_note_full(conn, root, &rel_path, &updated)
}
```

Create `src-tauri/src/commands/summary.rs`:

```rust
use crate::error::AppError;
use crate::services::summary::{build_summary_candidate, save_note_summary_in_root};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn generate_summary_candidate(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let abs_path = crate::infrastructure::fs::resolve_kb_path(root, &path)?;
    let content = std::fs::read_to_string(abs_path)?;
    build_summary_candidate(&content, 180)
}

#[tauri::command]
pub async fn save_note_summary(
    state: State<'_, AppState>,
    path: String,
    summary: String,
) -> Result<crate::domain::note::Note, AppError> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?.clone();
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    save_note_summary_in_root(conn, &root, &path, summary)
}
```

Register the module and commands:

```rust
// src-tauri/src/commands/mod.rs
pub mod summary;

// src-tauri/src/services/mod.rs
pub mod summary;

// src-tauri/src/lib.rs
commands::summary::generate_summary_candidate,
commands::summary::save_note_summary,
```

- [ ] **Step 4: Run the focused Rust tests again**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test build_summary_candidate_prefers_intro_and_headings save_note_summary_in_root_updates_front_matter_and_preserves_other_fields
```

Expected: PASS for the two new tests.

- [ ] **Step 5: Commit the backend summary API slice**

Run:

```bash
git add src-tauri/src/services/summary.rs src-tauri/src/commands/summary.rs src-tauri/src/services/mod.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/services/note.rs
git commit -m "feat: add lookback summary backend commands"
```

---

### Task 2: Add front-end summary API and orchestration hook

**Files:**
- Modify: `src/api/commands.ts`
- Modify: `src/types/index.ts`
- Create: `src/store/useLookbackSummaryStore.ts`
- Create: `src/hooks/useLookbackSummary.ts`
- Create: `src/hooks/useLookbackSummary.test.tsx`

- [ ] **Step 1: Write the failing hook tests for candidate generation, save, and prompt gating**

Create `src/hooks/useLookbackSummary.test.tsx` with this first test batch:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLookbackSummary } from "./useLookbackSummary";
import { useEditorStore } from "../store/useEditorStore";
import { makeNote } from "../test/testData";
import { api } from "../api/commands";

vi.mock("../api/commands", () => ({
  api: {
    generateSummaryCandidate: vi.fn(),
    saveNoteSummary: vi.fn(),
    getNoteLinks: vi.fn(),
  },
}));

describe("useLookbackSummary", () => {
  beforeEach(() => {
    useEditorStore.setState({ currentNote: makeNote({ word_count: 420, summary: null, path: "notes/demo.md" }) });
  });

  it("loads a candidate only when requested and saves only after explicit confirm", async () => {
    vi.mocked(api.generateSummaryCandidate).mockResolvedValue("候选摘要");
    vi.mocked(api.saveNoteSummary).mockResolvedValue(makeNote({ summary: "候选摘要" }));
    vi.mocked(api.getNoteLinks).mockResolvedValue({ outgoing: [], incoming: [{ id: "1" }] } as never);

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.generateCandidate();
    });
    expect(result.current.candidate).toBe("候选摘要");
    expect(useEditorStore.getState().currentNote?.summary).toBeNull();

    await act(async () => {
      await result.current.saveCandidate();
    });
    expect(api.saveNoteSummary).toHaveBeenCalledWith("notes/demo.md", "候选摘要");
  });
});
```

- [ ] **Step 2: Run the focused hook test and confirm it fails**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx
```

Expected: FAIL because `useLookbackSummary` and the new API methods do not exist yet.

- [ ] **Step 3: Implement the API methods, prompt store, and hook**

Extend `src/api/commands.ts`:

```ts
  generateSummaryCandidate: (path: string) =>
    invoke<string>("generate_summary_candidate", { path }),

  saveNoteSummary: (path: string, summary: string) =>
    invoke<Note>("save_note_summary", { path, summary }),
```

Create `src/store/useLookbackSummaryStore.ts`:

```ts
import { create } from "zustand";

type NoteSummaryPromptState = {
  viewCount: number;
  lastPromptAt: number | null;
};

interface LookbackSummaryState {
  byPath: Record<string, NoteSummaryPromptState>;
  recordOpen: (path: string) => void;
  markPromptShown: (path: string, timestamp: number) => void;
}

export const useLookbackSummaryStore = create<LookbackSummaryState>((set) => ({
  byPath: {},
  recordOpen: (path) => set((state) => ({
    byPath: {
      ...state.byPath,
      [path]: {
        viewCount: (state.byPath[path]?.viewCount ?? 0) + 1,
        lastPromptAt: state.byPath[path]?.lastPromptAt ?? null,
      },
    },
  })),
  markPromptShown: (path, timestamp) => set((state) => ({
    byPath: {
      ...state.byPath,
      [path]: {
        viewCount: state.byPath[path]?.viewCount ?? 0,
        lastPromptAt: timestamp,
      },
    },
  })),
}));
```

Create `src/hooks/useLookbackSummary.ts`:

```ts
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/commands";
import { useEditorStore } from "../store/useEditorStore";
import { useLookbackSummaryStore } from "../store/useLookbackSummaryStore";

const WORD_COUNT_THRESHOLD = 300;
const VIEW_COUNT_THRESHOLD = 3;
const BACKLINK_THRESHOLD = 2;
const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function useLookbackSummary() {
  const currentNote = useEditorStore((state) => state.currentNote);
  const setCurrentNote = useEditorStore((state) => state.setCurrentNote);
  const promptState = useLookbackSummaryStore((state) => currentNote ? state.byPath[currentNote.path] : undefined);
  const markPromptShown = useLookbackSummaryStore((state) => state.markPromptShown);
  const [candidate, setCandidate] = useState("");
  const [draft, setDraft] = useState("");
  const [incomingCount, setIncomingCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCandidate("");
    setDraft(currentNote?.summary ?? "");
    if (!currentNote) return;
    void api.getNoteLinks(currentNote.id).then((links) => setIncomingCount(links.incoming.length)).catch(() => setIncomingCount(0));
  }, [currentNote?.id, currentNote?.path, currentNote?.summary]);

  const shouldSuggest = useMemo(() => {
    if (!currentNote || currentNote.summary) return false;
    const viewCount = promptState?.viewCount ?? 0;
    const lastPromptAt = promptState?.lastPromptAt ?? null;
    const cooledDown = !lastPromptAt || Date.now() - lastPromptAt >= PROMPT_COOLDOWN_MS;
    return cooledDown && (
      currentNote.word_count >= WORD_COUNT_THRESHOLD ||
      viewCount >= VIEW_COUNT_THRESHOLD ||
      incomingCount >= BACKLINK_THRESHOLD
    );
  }, [currentNote, promptState, incomingCount]);

  async function generateCandidate() {
    if (!currentNote) return;
    setBusy(true);
    try {
      const next = await api.generateSummaryCandidate(currentNote.path);
      setCandidate(next);
      setDraft(next);
      if (shouldSuggest) {
        markPromptShown(currentNote.path, Date.now());
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveCandidate() {
    if (!currentNote || !draft.trim()) return;
    setBusy(true);
    try {
      const saved = await api.saveNoteSummary(currentNote.path, draft.trim());
      setCurrentNote(saved);
      setCandidate("");
    } finally {
      setBusy(false);
    }
  }

  return { currentNote, candidate, draft, setDraft, busy, shouldSuggest, generateCandidate, saveCandidate };
}
```

- [ ] **Step 4: Run the hook test again**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx
```

Expected: PASS for the new hook behavior.

- [ ] **Step 5: Commit the front-end orchestration slice**

Run:

```bash
git add src/api/commands.ts src/types/index.ts src/store/useLookbackSummaryStore.ts src/hooks/useLookbackSummary.ts src/hooks/useLookbackSummary.test.tsx
git commit -m "feat: add lookback summary hook and prompt state"
```

---

### Task 3: Add the summary card to the top of EditorWorkspace

**Files:**
- Create: `src/components/EditorWorkspace/LookbackSummaryCard.tsx`
- Create: `src/components/EditorWorkspace/LookbackSummaryCard.test.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`

- [ ] **Step 1: Write the failing component and workspace integration tests**

Add this test to `src/components/EditorWorkspace/EditorWorkspace.test.tsx`:

```tsx
it("renders the lookback summary card between the title bar and content panes", () => {
  useEditorStore.setState({
    currentNote: makeNote({ path: "notes/demo.md", title: "Demo", summary: null, word_count: 420 }),
    content: "# Demo\n\nBody",
  });

  render(<EditorWorkspace />);

  expect(screen.getByText("回看摘要")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成候选摘要" })).toBeInTheDocument();
  expect(screen.getByText("请从左侧文件树选择或新建笔记")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted workspace tests and confirm failure**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx src/components/EditorWorkspace/LookbackSummaryCard.test.tsx
```

Expected: FAIL because the summary card component and integration do not exist yet.

- [ ] **Step 3: Implement the reusable card and mount it once in `EditorWorkspace`**

Create `src/components/EditorWorkspace/LookbackSummaryCard.tsx`:

```tsx
import type { CSSProperties } from "react";

interface LookbackSummaryCardProps {
  summary: string | null;
  draft: string;
  candidate: string;
  busy: boolean;
  shouldSuggest: boolean;
  onDraftChange: (value: string) => void;
  onGenerate: () => void;
  onSave: () => void;
}

export function LookbackSummaryCard(props: LookbackSummaryCardProps) {
  const hasSavedSummary = Boolean(props.summary?.trim());
  const showGenerate = !hasSavedSummary || props.shouldSuggest;

  return (
    <section style={cardStyle} aria-label="回看摘要卡片">
      <div style={headerStyle}>
        <strong>回看摘要</strong>
        <span style={hintStyle}>帮助你在回看时第一眼判断这篇笔记的价值</span>
      </div>
      {hasSavedSummary && !props.candidate ? (
        <p style={summaryStyle}>{props.summary}</p>
      ) : (
        <textarea
          aria-label="回看摘要内容"
          value={props.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
          style={textareaStyle}
          placeholder="生成候选摘要，或手动写一句帮助未来回看的说明"
        />
      )}
      <div style={actionRowStyle}>
        {showGenerate && (
          <button type="button" onClick={props.onGenerate} disabled={props.busy}>
            生成候选摘要
          </button>
        )}
        <button type="button" onClick={props.onSave} disabled={props.busy || !props.draft.trim()}>
          保存回看摘要
        </button>
      </div>
    </section>
  );
}

const cardStyle: CSSProperties = { borderBottom: "1px solid #e5e7eb", padding: "12px 16px", background: "#fcfcf8" };
const headerStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };
const hintStyle: CSSProperties = { color: "#6b7280", fontSize: 12 };
const summaryStyle: CSSProperties = { margin: 0, color: "#1f2937", lineHeight: 1.6 };
const textareaStyle: CSSProperties = { width: "100%", minHeight: 72, resize: "vertical" };
const actionRowStyle: CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
```

Mount it once in `src/components/EditorWorkspace/EditorWorkspace.tsx` directly below the title bar and above the split panes:

```tsx
import { LookbackSummaryCard } from "./LookbackSummaryCard";
import { useLookbackSummary } from "../../hooks/useLookbackSummary";

const lookbackSummary = useLookbackSummary();

<LookbackSummaryCard
  summary={currentNote.summary}
  draft={lookbackSummary.draft}
  candidate={lookbackSummary.candidate}
  busy={lookbackSummary.busy}
  shouldSuggest={lookbackSummary.shouldSuggest}
  onDraftChange={lookbackSummary.setDraft}
  onGenerate={() => void lookbackSummary.generateCandidate()}
  onSave={() => void lookbackSummary.saveCandidate()}
/>
```

- [ ] **Step 4: Run the targeted workspace tests again**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx src/components/EditorWorkspace/LookbackSummaryCard.test.tsx
```

Expected: PASS for the new card visibility and interaction tests.

- [ ] **Step 5: Commit the editor workspace UI slice**

Run:

```bash
git add src/components/EditorWorkspace/LookbackSummaryCard.tsx src/components/EditorWorkspace/LookbackSummaryCard.test.tsx src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
git commit -m "feat: show lookback summary card in editor workspace"
```

---

### Task 4: Record open events and enforce low-interruption prompt rules

**Files:**
- Modify: `src/hooks/useOpenNote.ts`
- Modify: `src/hooks/useLookbackSummary.ts`
- Modify: `src/store/useLookbackSummaryStore.ts`
- Modify: `src/hooks/useLookbackSummary.test.tsx`

- [ ] **Step 1: Extend the failing tests for view-count and 24-hour cooldown logic**

Append these tests to `src/hooks/useLookbackSummary.test.tsx`:

```tsx
it("does not suggest for short notes with low traffic and no backlinks", async () => {
  vi.mocked(api.getNoteLinks).mockResolvedValue({ outgoing: [], incoming: [] } as never);
  useEditorStore.setState({ currentNote: makeNote({ word_count: 40, summary: null, path: "notes/short.md" }) });

  const { result } = renderHook(() => useLookbackSummary());

  await waitFor(() => {
    expect(result.current.shouldSuggest).toBe(false);
  });
});

it("suppresses a second prompt within 24 hours for the same note", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
  vi.mocked(api.getNoteLinks).mockResolvedValue({ outgoing: [], incoming: [{ id: "1" }, { id: "2" }] } as never);

  const { result, rerender } = renderHook(() => useLookbackSummary());
  await act(async () => {
    await result.current.generateCandidate();
  });
  expect(result.current.shouldSuggest).toBe(true);

  rerender();
  expect(result.current.shouldSuggest).toBe(false);
});
```

- [ ] **Step 2: Run the hook tests and confirm the cooldown tests fail**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx
```

Expected: FAIL because open counts and prompt timestamps are not fully wired yet.

- [ ] **Step 3: Wire open-note tracking into the prompt store and finish the gating rules**

Update `src/hooks/useOpenNote.ts` so successful note opens record a view:

```ts
import { useLookbackSummaryStore } from "../store/useLookbackSummaryStore";

const recordOpen = useLookbackSummaryStore((state) => state.recordOpen);

const openNote = useCallback(async (path: string, existingRequestId?: number) => {
  const requestId = existingRequestId ?? beginOpenNote();
  if (requestId !== latestOpenRequestId) return;

  setSelectedNodePath(path);

  try {
    const detail = await api.getNoteByPath(path);
    if (requestId !== latestOpenRequestId) return;
    setCurrentNote(detail.note);
    setContent(detail.content);
    recordOpen(path);
  } catch (e) {
    if (requestId !== latestOpenRequestId) return;
    console.error("Failed to open note:", e);
  }
}, [beginOpenNote, setSelectedNodePath, setCurrentNote, setContent, recordOpen]);
```

Finish the cooldown computation in `useLookbackSummary.ts` by checking `lastPromptAt` before returning `shouldSuggest`.

- [ ] **Step 4: Re-run the hook tests**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useLookbackSummary.test.tsx
```

Expected: PASS for the low-interruption rules.

- [ ] **Step 5: Commit the prompt-gating slice**

Run:

```bash
git add src/hooks/useOpenNote.ts src/hooks/useLookbackSummary.ts src/store/useLookbackSummaryStore.ts src/hooks/useLookbackSummary.test.tsx
git commit -m "feat: enforce low-interruption lookback summary prompts"
```

---

### Task 5: Surface saved summaries in search results and file-tree hover

**Files:**
- Modify: `src-tauri/src/domain/search.rs`
- Modify: `src-tauri/src/commands/search.rs`
- Modify: `src/types/index.ts`
- Modify: `src/hooks/useSearch.test.tsx`
- Modify: `src/components/SearchOverlay.tsx`
- Modify: `src/components/SearchOverlay.test.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Write the failing search and file-tree tests**

Add this to `src/hooks/useSearch.test.tsx`:

```tsx
expect(result.current.results[0]).toMatchObject({
  note_id: "note2",
  summary: "A concise lookback summary",
});
```

Add this to `src/components/SearchOverlay.test.tsx`:

```tsx
it("renders lookback summary text when a search result includes it", async () => {
  setSearchResults([
    makeSearchResult({
      title: "Demo",
      summary: "这是一条用于快速回看的摘要",
    } as never),
  ]);

  renderSearchOverlay();
  await userEvent.type(screen.getByPlaceholderText("输入关键词搜索笔记"), "demo");

  expect(await screen.findByText("这是一条用于快速回看的摘要")).toBeInTheDocument();
});
```

Add this to `src/components/LeftSidebar/FileTreePanel.test.tsx`:

```tsx
it("shows note summary in the file-tree hover tooltip", async () => {
  // mock api.getNoteByPath to return a note with summary
  // hover the note row
  // assert tooltip text contains the summary
});
```

- [ ] **Step 2: Run the focused search and sidebar tests and confirm failure**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useSearch.test.tsx src/components/SearchOverlay.test.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: FAIL because `SearchResult` has no `summary` field and the UI does not render it.

- [ ] **Step 3: Extend the search DTO and UI rendering**

Update `src-tauri/src/domain/search.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub summary: Option<String>,
    pub snippet: String,
    pub line_start: i64,
    pub line_end: i64,
    pub occurrence_order: i64,
    pub match_text: String,
    pub source: SearchResultSource,
    pub link_target_path: Option<String>,
    pub link_target_title: Option<String>,
    pub link_target_href: Option<String>,
    pub score: f64,
}
```

Make `src-tauri/src/commands/search.rs` populate `summary` from the `notes` table, then update `src/types/index.ts`:

```ts
export interface SearchResult extends SearchHitLocation {
  title: string;
  path: string;
  summary?: string | null;
  snippet: string;
  link_target_path?: string | null;
  link_target_title?: string | null;
  link_target_href?: string | null;
  score: number;
}
```

Render the summary in `src/components/SearchOverlay.tsx` below the title/snippet block only when present.

For `FileTreePanel.tsx`, add a small hover card backed by `api.getNoteByPath(node.path)` for note rows only, and render `detail.note.summary` when available.

- [ ] **Step 4: Re-run the focused search and sidebar tests**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useSearch.test.tsx src/components/SearchOverlay.test.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: PASS for summary rendering in search and note-list hover.

- [ ] **Step 5: Commit the search/list surfacing slice**

Run:

```bash
git add src-tauri/src/domain/search.rs src-tauri/src/commands/search.rs src/types/index.ts src/hooks/useSearch.test.tsx src/components/SearchOverlay.tsx src/components/SearchOverlay.test.tsx src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "feat: surface lookback summaries in search and note list"
```

---

### Task 6: Run full targeted verification and baseline checks

**Files:**
- No new files
- Verify all touched files from Tasks 1-5

- [ ] **Step 1: Run the front-end targeted test batch**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run \
  src/hooks/useLookbackSummary.test.tsx \
  src/components/EditorWorkspace/LookbackSummaryCard.test.tsx \
  src/components/EditorWorkspace/EditorWorkspace.test.tsx \
  src/hooks/useSearch.test.tsx \
  src/components/SearchOverlay.test.tsx \
  src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: PASS with 0 failed tests.

- [ ] **Step 2: Run the Rust targeted test batch**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test build_summary_candidate_prefers_intro_and_headings save_note_summary_in_root_updates_front_matter_and_preserves_other_fields search_notes
```

Expected: PASS with 0 failed tests.

- [ ] **Step 3: Run the app build**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm build
```

Expected: exit code 0.

- [ ] **Step 4: Run the full Rust suite required by repo baseline**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test
```

Expected: exit code 0.

- [ ] **Step 5: Commit the verified feature branch state**

Run:

```bash
git add src api src-tauri
git commit -m "feat: implement lookback summary workflow"
```

---

## Scope Notes

- Keep the persisted field name as `summary`; do not introduce `lookback_summary` or any parallel schema.
- Do not auto-save generated candidates.
- The summary card must exist once per open note in `EditorWorkspace`; do not duplicate a second card inside `MarkdownPreview`.
- If FileTree hover summary proves too noisy during implementation, keep the search-result summary in this plan and move the sidebar hover piece behind a follow-up plan rather than silently dropping it.

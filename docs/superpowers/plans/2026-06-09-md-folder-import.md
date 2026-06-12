# Markdown Folder Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add left-sidebar import support for Markdown folders, preserving directory structure and copying in-scope image assets so imported notes remain usable.

**Architecture:** Keep the current single-file import path intact and add a new batch import path that accepts either Markdown files or one folder source. The backend owns folder expansion, asset copying, conflict handling, and result aggregation; the frontend owns source selection, confirmation UI, and result rendering.

**Tech Stack:** React 19 + Vitest + Testing Library, TypeScript, Tauri command bridge, Rust services and serde types, cargo test

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-09 | v1.0 | 基于已确认规格拆解 Markdown 文件夹导入的实现任务、测试顺序与验证命令。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 实施约束](#2-实施约束)
- [3. Task 1: 前端契约与命令映射](#3-task-1-前端契约与命令映射)
- [4. Task 2: 后端文件夹导入服务](#4-task-2-后端文件夹导入服务)
- [5. Task 3: 左侧栏导入交互](#5-task-3-左侧栏导入交互)
- [6. Task 4: 导入结果与回归验证](#6-task-4-导入结果与回归验证)
- [7. 规格覆盖检查](#7-规格覆盖检查)

## 1. 文件结构

**Modify:**

- `src/types/index.ts`
- `src/api/commands.ts`
- `src/api/commands.test.ts`
- `src/components/LeftSidebar/FileTreePanel.tsx`
- `src/components/LeftSidebar/FileTreePanel.test.tsx`
- `src/components/LeftSidebar/ImportDialog.tsx`
- `src-tauri/src/domain/note.rs`
- `src-tauri/src/commands/note.rs`
- `src-tauri/src/services/note.rs`
- `src-tauri/src/lib.rs`

**No new runtime files required unless the backend helper extraction becomes necessary during implementation.** If helper complexity grows, split only into `src-tauri/src/services/note_import.rs` and update imports in the same task that introduces it.

## 2. 实施约束

- 先写失败测试，再写最小实现，不跳过红灯验证。
- 不删除现有 `import_note`，保持单文件导入兼容。
- 不提交 git commit，除非用户显式要求。
- 目录导入只覆盖 Markdown 和图片附件，不扩展到通用附件。
- 路径解析与图片链接抽取必须优先复用现有 Markdown / FS 基础设施，不新增脆弱字符串扫描。

## 3. Task 1: 前端契约与命令映射

**Files:**

- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Modify: `src/api/commands.test.ts`

- [ ] **Step 1: Write the failing API contract test**

Add this test near the existing command-mapping tests in `src/api/commands.test.ts`:

```ts
it("maps importMarkdownSources batch results into frontend contracts", async () => {
  tauriMocks.invoke.mockResolvedValueOnce({
    imported: [
      {
        source_path: "/Users/lijun/Desktop/project/docs/a.md",
        note: {
          id: "note-1",
          path: "notes/work/project/docs/a.md",
          title: "a",
          summary: null,
          content_hash: "hash-1",
          word_count: 10,
          created_at: "2026-06-09T00:00:00Z",
          updated_at: "2026-06-09T00:00:00Z",
          indexed_at: "2026-06-09T00:00:00Z",
          deleted_at: null,
        },
      },
    ],
    warnings: [
      {
        source_path: "/Users/lijun/Desktop/project/docs/a.md",
        message: "Skipped external asset ../shared/cover.png",
      },
    ],
    failures: [],
  });

  const result = await api.importMarkdownSources({
    sources: [{ kind: "directory", path: "/Users/lijun/Desktop/project" }],
    destDirectory: "notes/work",
  });

  expect(tauriMocks.invoke).toHaveBeenCalledWith("import_markdown_sources", {
    request: {
      sources: [{ kind: "directory", path: "/Users/lijun/Desktop/project" }],
      destDirectory: "notes/work",
    },
  });
  expect(result.imported[0]?.note.path).toBe("notes/work/project/docs/a.md");
  expect(result.warnings[0]).toEqual({
    sourcePath: "/Users/lijun/Desktop/project/docs/a.md",
    message: "Skipped external asset ../shared/cover.png",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest src/api/commands.test.ts -t "maps importMarkdownSources batch results into frontend contracts"
```

Expected: FAIL because `api.importMarkdownSources` and related types do not exist yet.

- [ ] **Step 3: Add the minimal frontend types and command mapping**

Add these types in `src/types/index.ts` near the note contracts:

```ts
export type MarkdownImportSource =
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string };

export interface MarkdownImportRequest {
  sources: MarkdownImportSource[];
  destDirectory: string;
}

export interface MarkdownImportItem {
  sourcePath: string;
  note: Note;
}

export interface MarkdownImportMessage {
  sourcePath: string;
  message: string;
}

export interface MarkdownImportResult {
  imported: MarkdownImportItem[];
  warnings: MarkdownImportMessage[];
  failures: MarkdownImportMessage[];
}
```

Add the minimal mapping in `src/api/commands.ts`:

```ts
type RawMarkdownImportItem = {
  source_path: string;
  note: RawNote;
};

type RawMarkdownImportMessage = {
  source_path: string;
  message: string;
};

type RawMarkdownImportResult = {
  imported: RawMarkdownImportItem[];
  warnings: RawMarkdownImportMessage[];
  failures: RawMarkdownImportMessage[];
};

function mapMarkdownImportResult(result: RawMarkdownImportResult): MarkdownImportResult {
  return {
    imported: result.imported.map((item) => ({
      sourcePath: item.source_path,
      note: mapNote(item.note),
    })),
    warnings: result.warnings.map((item) => ({
      sourcePath: item.source_path,
      message: item.message,
    })),
    failures: result.failures.map((item) => ({
      sourcePath: item.source_path,
      message: item.message,
    })),
  };
}

importMarkdownSources: (request: MarkdownImportRequest) =>
  invoke<RawMarkdownImportResult>("import_markdown_sources", { request }).then(mapMarkdownImportResult),
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm vitest src/api/commands.test.ts -t "maps importMarkdownSources batch results into frontend contracts"
```

Expected: PASS.

## 4. Task 2: 后端文件夹导入服务

**Files:**

- Modify: `src-tauri/src/domain/note.rs`
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/services/note.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing Rust service tests**

Add these tests in the `#[cfg(test)]` module of `src-tauri/src/services/note.rs`:

```rust
#[test]
fn import_markdown_sources_preserves_selected_directory_name_and_nested_paths() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
    let db_path = root.path().join("index.sqlite");
    let mut conn = open_and_migrate(&db_path).unwrap();

    let source_root = TempDir::new().unwrap();
    let project_dir = source_root.path().join("project");
    std::fs::create_dir_all(project_dir.join("docs")).unwrap();
    std::fs::write(project_dir.join("docs/a.md"), "# A\n").unwrap();

    let result = import_markdown_sources_in_root(
        &mut conn,
        root.path(),
        MarkdownImportRequest {
            sources: vec![MarkdownImportSource::Directory {
                path: project_dir.to_string_lossy().to_string(),
            }],
            dest_directory: "notes/work".into(),
        },
    )
    .unwrap();

    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.imported[0].note.path, "notes/work/project/docs/a.md");
}

#[test]
fn import_markdown_sources_copies_relative_images_inside_selected_directory() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
    let db_path = root.path().join("index.sqlite");
    let mut conn = open_and_migrate(&db_path).unwrap();

    let source_root = TempDir::new().unwrap();
    let project_dir = source_root.path().join("project");
    std::fs::create_dir_all(project_dir.join("docs/images")).unwrap();
    std::fs::write(project_dir.join("docs/images/p1.png"), b"png").unwrap();
    std::fs::write(
        project_dir.join("docs/a.md"),
        "# A\n\n![cover](./images/p1.png)\n",
    )
    .unwrap();

    let result = import_markdown_sources_in_root(
        &mut conn,
        root.path(),
        MarkdownImportRequest {
            sources: vec![MarkdownImportSource::Directory {
                path: project_dir.to_string_lossy().to_string(),
            }],
            dest_directory: "notes/work".into(),
        },
    )
    .unwrap();

    assert!(root.path().join("notes/work/project/docs/images/p1.png").exists());
    assert!(result.warnings.is_empty());
}

#[test]
fn import_markdown_sources_warns_when_relative_image_points_outside_selected_directory() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
    let db_path = root.path().join("index.sqlite");
    let mut conn = open_and_migrate(&db_path).unwrap();

    let source_root = TempDir::new().unwrap();
    let project_dir = source_root.path().join("project");
    let shared_dir = source_root.path().join("shared");
    std::fs::create_dir_all(project_dir.join("docs")).unwrap();
    std::fs::create_dir_all(&shared_dir).unwrap();
    std::fs::write(shared_dir.join("cover.png"), b"png").unwrap();
    std::fs::write(
        project_dir.join("docs/a.md"),
        "# A\n\n![cover](../shared/cover.png)\n",
    )
    .unwrap();

    let result = import_markdown_sources_in_root(
        &mut conn,
        root.path(),
        MarkdownImportRequest {
            sources: vec![MarkdownImportSource::Directory {
                path: project_dir.to_string_lossy().to_string(),
            }],
            dest_directory: "notes/work".into(),
        },
    )
    .unwrap();

    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.warnings.len(), 1);
}
```

- [ ] **Step 2: Run the first focused Rust tests and verify they fail**

Run:

```bash
cargo test import_markdown_sources --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL because `MarkdownImportRequest`, `MarkdownImportSource`, and `import_markdown_sources_in_root` do not exist yet.

- [ ] **Step 3: Implement the minimal backend batch import contracts and service**

Add these serde types in `src-tauri/src/domain/note.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MarkdownImportSource {
    File { path: String },
    Directory { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownImportRequest {
    pub sources: Vec<MarkdownImportSource>,
    pub dest_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownImportItem {
    pub source_path: String,
    pub note: Note,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownImportMessage {
    pub source_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownImportResult {
    pub imported: Vec<MarkdownImportItem>,
    pub warnings: Vec<MarkdownImportMessage>,
    pub failures: Vec<MarkdownImportMessage>,
}
```

Add the new command in `src-tauri/src/commands/note.rs`:

```rust
#[tauri::command]
pub async fn import_markdown_sources(
    state: State<'_, AppState>,
    request: MarkdownImportRequest,
) -> Result<MarkdownImportResult, AppError> {
    import_markdown_sources_service(&state, request)
}
```

Register it in `src-tauri/src/lib.rs` next to `commands::note::import_note`:

```rust
commands::note::import_markdown_sources,
```

Implement the minimum service surface in `src-tauri/src/services/note.rs`:

```rust
pub fn import_markdown_sources_service(
    state: &State<AppState>,
    request: MarkdownImportRequest,
) -> AppResult<MarkdownImportResult> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let mut db_guard = state.db_guard();
    let conn = db_guard
        .as_mut()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    import_markdown_sources_in_root(conn, &root, request)
}
```

And back it with a root helper that:

- normalizes the destination directory once
- expands `File` sources to the existing `import_note_service` behavior
- expands `Directory` sources by walking the selected folder recursively
- keeps the selected directory name in the target relative path
- copies in-scope image assets beside imported notes when the asset resolves inside the selected directory tree
- accumulates warnings for out-of-scope local assets instead of failing the note import

Use this minimum helper shape:

```rust
pub fn import_markdown_sources_in_root(
    conn: &mut rusqlite::Connection,
    root: &Path,
    request: MarkdownImportRequest,
) -> AppResult<MarkdownImportResult> {
    let mut result = MarkdownImportResult {
        imported: Vec::new(),
        warnings: Vec::new(),
        failures: Vec::new(),
    };

    for source in request.sources {
        match source {
            MarkdownImportSource::File { path } => {
                match import_single_markdown_file(conn, root, &path, &request.dest_directory) {
                    Ok(note) => result.imported.push(MarkdownImportItem { source_path: path, note }),
                    Err(err) => result.failures.push(MarkdownImportMessage {
                        source_path: path,
                        message: err.to_string(),
                    }),
                }
            }
            MarkdownImportSource::Directory { path } => {
                import_markdown_directory_into_result(conn, root, &path, &request.dest_directory, &mut result)?;
            }
        }
    }

    Ok(result)
}
```

- [ ] **Step 4: Run the Rust tests to verify they pass**

Run:

```bash
cargo test import_markdown_sources --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

## 5. Task 3: 左侧栏导入交互

**Files:**

- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`
- Modify: `src/components/LeftSidebar/ImportDialog.tsx`

- [ ] **Step 1: Write the failing UI tests**

Add these tests in `src/components/LeftSidebar/FileTreePanel.test.tsx`:

```tsx
it("opens a source chooser before importing and supports directory import", async () => {
  const user = userEvent.setup();
  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "导入笔记" }));
  await user.click(screen.getByRole("button", { name: "导入文件夹" }));

  expect(tauriMocks.openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
  expect(await screen.findByText("即将导入 1 个来源")).toBeInTheDocument();
});

it("submits directory sources through batch import and keeps warnings visible", async () => {
  const user = userEvent.setup();
  tauriMocks.openDialog.mockResolvedValueOnce("/Users/lijun/Desktop/project");
  apiMocks.importMarkdownSources = vi.fn().mockResolvedValue({
    imported: [],
    warnings: [{ sourcePath: "/Users/lijun/Desktop/project/docs/a.md", message: "Skipped external asset ../shared/cover.png" }],
    failures: [],
  });

  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "导入笔记" }));
  await user.click(screen.getByRole("button", { name: "导入文件夹" }));
  await user.click(await screen.findByRole("button", { name: "开始导入" }));

  expect(apiMocks.importMarkdownSources).toHaveBeenCalled();
  expect(await screen.findByText("Skipped external asset ../shared/cover.png")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused UI tests and verify they fail**

Run:

```bash
pnpm vitest src/components/LeftSidebar/FileTreePanel.test.tsx -t "supports directory import"
pnpm vitest src/components/LeftSidebar/FileTreePanel.test.tsx -t "keeps warnings visible"
```

Expected: FAIL because there is no source chooser UI and `ImportDialog` still assumes a plain string array of files.

- [ ] **Step 3: Implement the minimal UI flow**

In `src/components/LeftSidebar/FileTreePanel.tsx`, replace the plain `importFiles` state with import source state:

```ts
const [importSources, setImportSources] = useState<MarkdownImportSource[] | null>(null);
const [showImportChooser, setShowImportChooser] = useState(false);
```

Replace `handleImport` with a chooser opener plus two concrete pickers:

```ts
function handleImport() {
  setShowImportChooser(true);
}

async function handleImportFiles() {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  setShowImportChooser(false);
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  setImportSources(paths.map((path) => ({ kind: "file", path })));
}

async function handleImportDirectory() {
  const selected = await open({ directory: true, multiple: false });
  setShowImportChooser(false);
  if (!selected || Array.isArray(selected)) return;
  setImportSources([{ kind: "directory", path: selected }]);
}
```

Render a minimal chooser popover/modal with two buttons labeled `导入 Markdown 文件` and `导入文件夹`.

Update `ImportDialog.tsx` props from `files: string[]` to:

```ts
interface Props {
  sources: MarkdownImportSource[];
  existingDirs: string[];
  onClose: () => void;
  onDone: (lastImported?: Note) => void | Promise<void>;
}
```

Add minimal summary rendering:

```ts
const sourceCount = sources.length;
const fileCount = sources.filter((source) => source.kind === "file").length;
const directoryCount = sources.filter((source) => source.kind === "directory").length;
```

And submit through the new API:

```ts
const result = await api.importMarkdownSources({
  sources,
  destDirectory: finalDir,
});

const lastImported = result.imported.at(-1)?.note;
setErrors([
  ...result.warnings.map((item) => `${item.sourcePath}: ${item.message}`),
  ...result.failures.map((item) => `${item.sourcePath}: ${item.message}`),
]);

if (result.failures.length === 0) {
  await onDone(lastImported);
}
```

Keep the dialog open whenever warnings or failures exist.

- [ ] **Step 4: Run the focused UI tests to verify they pass**

Run:

```bash
pnpm vitest src/components/LeftSidebar/FileTreePanel.test.tsx -t "supports directory import"
pnpm vitest src/components/LeftSidebar/FileTreePanel.test.tsx -t "keeps warnings visible"
```

Expected: PASS.

## 6. Task 4: 导入结果与回归验证

**Files:**

- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`
- Modify: `src/api/commands.test.ts`
- Modify: `src-tauri/src/services/note.rs`

- [ ] **Step 1: Add regression tests for single-file compatibility and last-opened note behavior**

Add one frontend test in `src/components/LeftSidebar/FileTreePanel.test.tsx`:

```tsx
it("opens the last imported note after a successful batch import with no warnings", async () => {
  const user = userEvent.setup();
  tauriMocks.openDialog.mockResolvedValueOnce(["/Users/lijun/Desktop/a.md"]);
  apiMocks.importMarkdownSources = vi.fn().mockResolvedValue({
    imported: [
      { sourcePath: "/Users/lijun/Desktop/a.md", note: { ...makeNoteDetail().note, path: "notes/work/a.md", title: "a" } },
    ],
    warnings: [],
    failures: [],
  });

  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "导入笔记" }));
  await user.click(screen.getByRole("button", { name: "导入 Markdown 文件" }));
  await user.click(await screen.findByRole("button", { name: "开始导入" }));

  await waitFor(() => expect(hookMocks.openNote).toHaveBeenCalledWith("notes/work/a.md"));
});
```

And one Rust test in `src-tauri/src/services/note.rs`:

```rust
#[test]
fn import_markdown_sources_accepts_single_file_sources_without_directory_logic() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes")).unwrap();
    let db_path = root.path().join("index.sqlite");
    let mut conn = open_and_migrate(&db_path).unwrap();

    let source_root = TempDir::new().unwrap();
    let file_path = source_root.path().join("a.md");
    std::fs::write(&file_path, "# A\n").unwrap();

    let result = import_markdown_sources_in_root(
        &mut conn,
        root.path(),
        MarkdownImportRequest {
            sources: vec![MarkdownImportSource::File {
                path: file_path.to_string_lossy().to_string(),
            }],
            dest_directory: "notes".into(),
        },
    )
    .unwrap();

    assert_eq!(result.imported.len(), 1);
    assert!(result.failures.is_empty());
}
```

- [ ] **Step 2: Run the new regression tests to verify they fail if behavior is not wired correctly**

Run:

```bash
pnpm vitest src/components/LeftSidebar/FileTreePanel.test.tsx -t "opens the last imported note"
cargo test accepts_single_file_sources --manifest-path src-tauri/Cargo.toml
```

Expected: if the main tasks are complete, these may already pass; if not, use the failure to repair the same slice before broadening scope.

- [ ] **Step 3: Repair the smallest remaining gaps**

Typical fixes in this step should be limited to:

- preserving `onDone(lastImported)` only when there are no failures
- making file-source imports call the same batch path instead of the deprecated loop in `ImportDialog`
- ensuring the result dialog keeps warnings visible without swallowing successful imports

Keep changes within the files already touched above.

- [ ] **Step 4: Run the focused verification suite**

Run:

```bash
pnpm vitest src/api/commands.test.ts
pnpm vitest src/components/LeftSidebar/FileTreePanel.test.tsx
cargo test import_markdown_sources --manifest-path src-tauri/Cargo.toml
```

Expected: PASS on all three commands.

## 7. 规格覆盖检查

- 左侧栏支持文件与文件夹双入口：Task 3
- 文件夹递归导入 Markdown：Task 2
- 保留所选目录名与相对层级：Task 2
- 图片附件随目录导入并保持相对位置：Task 2
- 目录外资源给警告而非阻断：Task 2
- 结果摘要、错误保留、最后成功笔记打开：Task 3、Task 4
- 单文件兼容不回退：Task 1、Task 4

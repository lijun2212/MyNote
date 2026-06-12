# Editor Image Insert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为编辑区右键菜单增加“插入图片”能力，把图片统一复制到隐藏的 notes/assets，并让 Markdown 预览正确显示且不溢出。

**Architecture:** 前端沿用现有菜单与 ContextMenuHost 链路，在 editor blank 和 editor selection 菜单中新增同一个动作。后端新增一个专用 Tauri 命令负责系统选图、图片校验、复制到 notes/assets、计算相对当前笔记的 Markdown 路径，前端只负责把返回路径插入当前编辑器内容。预览层不参与资源补偿，只补图片样式约束与必要的相对路径放行。

**Tech Stack:** React 19 + TypeScript + Zustand + CodeMirror 6 + Vitest + Tauri + Rust

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-09 | v1.0 | 基于 2026-06-09-editor-image-insert-design.md 输出实施计划。 |

## 目录

- [1. 实施范围总览](#1-实施范围总览)
- [2. 文件结构与职责](#2-文件结构与职责)
- [3. Task 1 菜单契约与前端桥接](#3-task-1-菜单契约与前端桥接)
- [4. Task 2 编辑器右键插图实现](#4-task-2-编辑器右键插图实现)
- [5. Task 3 预览图片显示与样式约束](#5-task-3-预览图片显示与样式约束)
- [6. Task 4 Tauri 图片导入命令](#6-task-4-tauri-图片导入命令)
- [7. Task 5 全链路回归](#7-task-5-全链路回归)
- [8. 自检结果](#8-自检结果)

## 1. 实施范围总览

本计划只覆盖以下能力：

1. 编辑区空白右键菜单出现“插入图片”。
2. 编辑区选区右键菜单出现“插入图片”。
3. 点击后通过系统选图器选择图片。
4. 图片复制到隐藏的 notes/assets。
5. 编辑器立即插入 `![图片](相对路径)`。
6. 预览区完整显示图片，不横向溢出。

本计划不覆盖：

- 多图批量插入。
- 图片压缩。
- 拖拽插图。
- 图片资源管理面板。

## 2. 文件结构与职责

### 2.1 前端文件

- Modify: `src/menu/menuIds.ts`
  - 新增 editor 右键插图动作 id。
- Modify: `src/components/ContextMenu/contextMenuTypes.ts`
  - 为 `editorSelection` 和 `editorBlank` payload 增加 `insertImage` handler。
- Modify: `src/menu/menuSchema.ts`
  - 在 `editorSelection` 与 `editorBlank` 菜单中暴露“插入图片”。
- Modify: `src/menu/menuActionRunner.ts`
  - 新增动作路由与 handler 契约。
- Modify: `src/components/ContextMenu/ContextMenuHost.tsx`
  - 把 editor blank / selection 的 `insertImage` handler 映射到 runner。
- Modify: `src/api/commands.ts`
  - 新增调用 Tauri 命令的前端桥接方法。
- Modify: `src/types/index.ts`
  - 新增图片插入结果 DTO。
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx`
  - 右键菜单接入动作并在编辑器中插入 Markdown 图片语法。
- Modify: `src/components/EditorWorkspace/MarkdownEditor.test.tsx`
  - 覆盖菜单显示、成功插入、取消与失败分支。
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - 补图片渲染样式约束，必要时放行相对路径图片。
- Modify: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`
  - 覆盖图片显示与不溢出约束。

### 2.2 后端文件

- Modify: `src-tauri/src/lib.rs`
  - 注册新 Tauri 命令。
- Modify: `src-tauri/src/commands/note.rs`
  - 暴露新命令函数。
- Modify: `src-tauri/src/domain/note.rs`
  - 新增图片插入返回 DTO。
- Modify: `src-tauri/src/services/note.rs`
  - 实现选图、校验、复制、相对路径生成。
- Test: `src-tauri/src/services/note.rs`
  - 补路径生成、命名和文件类型校验测试。

### 2.3 验证命令

- 前端定向测试：`corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx src/api/commands.test.ts`
- 前端构建：`corepack pnpm build`
- Rust 测试：`cd src-tauri && cargo test`

## 3. Task 1 菜单契约与前端桥接

**Files:**
- Modify: `src/menu/menuIds.ts`
- Modify: `src/components/ContextMenu/contextMenuTypes.ts`
- Modify: `src/menu/menuSchema.ts`
- Modify: `src/menu/menuActionRunner.ts`
- Modify: `src/components/ContextMenu/ContextMenuHost.tsx`
- Modify: `src/api/commands.ts`
- Modify: `src/types/index.ts`
- Test: `src/menu/menuSchema.test.ts`
- Test: `src/menu/menuActionRunner.test.ts`
- Test: `src/api/commands.test.ts`

- [ ] **Step 1: 在菜单与桥接层先写失败测试**

在 `src/menu/menuSchema.test.ts` 增加 editor 菜单断言：

```ts
it("shows insert image in editor blank and selection menus", () => {
  const blankMenu = buildContextMenuSchema({
    type: "editorBlank",
    handlers: { insertImage: vi.fn() },
  });
  const selectionMenu = buildContextMenuSchema({
    type: "editorSelection",
    selectedText: "selected",
    handlers: { insertImage: vi.fn() },
  });

  expect(blankMenu.map((item) => item.id)).toContain("blank.insertImage");
  expect(selectionMenu.map((item) => item.id)).toContain("selection.insertImage");
});
```

在 `src/menu/menuActionRunner.test.ts` 增加动作路由断言：

```ts
it("routes selection.insertImage to the provided handler", async () => {
  const handlers = {
    insertImageFromSelection: vi.fn(),
  };
  const runner = createMenuActionRunner(handlers);

  await expect(runner.run("selection.insertImage", {
    type: "editorSelection",
    selectedText: "x",
  })).resolves.toBe(true);

  expect(handlers.insertImageFromSelection).toHaveBeenCalledOnce();
});
```

在 `src/api/commands.test.ts` 增加桥接断言：

```ts
it("calls insert_image_for_note and maps markdownPath", async () => {
  invokeMock.mockResolvedValue({ markdown_path: "../assets/20260609-101010-a1b2c3.png" });

  await expect(api.insertImageForNote("notes/demo.md")).resolves.toEqual({
    markdownPath: "../assets/20260609-101010-a1b2c3.png",
  });
});
```

- [ ] **Step 2: 跑菜单与桥接测试并确认先失败**

Run: `corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts src/api/commands.test.ts`

Expected: FAIL，报错提示缺少 `blank.insertImage` / `selection.insertImage`、缺少 action executor，或 `api.insertImageForNote` 未定义。

- [ ] **Step 3: 写最小菜单契约与桥接实现**

在 `src/menu/menuIds.ts` 增加动作 id：

```ts
"selection.insertImage",
"blank.insertImage",
```

在 `src/components/ContextMenu/contextMenuTypes.ts` 增加 handler：

```ts
export interface EditorSelectionContextMenuPayload extends ContextMenuPayloadBase {
  type: "editorSelection";
  selectedText: string;
  handlers?: {
    insertLink?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
    insertImage?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
    insertTag?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
    createWikiLink?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
  };
}
```

在 `src/menu/menuSchema.ts` 加菜单项：

```ts
item("selection.insertImage", "插入图片", isEnabled(payload.handlers?.insertImage)),
item("blank.insertImage", "插入图片", isEnabled(payload.handlers?.insertImage)),
```

在 `src/menu/menuActionRunner.ts` 增加 handler 契约与 executor：

```ts
insertImageFromSelection?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
insertImageFromBlank?: (payload: EditorBlankContextMenuPayload) => MaybePromise;

"selection.insertImage": (payload) =>
  requireHandler(handlers, "selection.insertImage", "insertImageFromSelection")(assertEditorSelectionPayload(payload)),
"blank.insertImage": (payload) =>
  requireHandler(handlers, "blank.insertImage", "insertImageFromBlank")(assertEditorBlankPayload(payload)),
```

在 `src/components/ContextMenu/ContextMenuHost.tsx` 映射 handler：

```ts
insertImageFromSelection: (selectionPayload) => selectionPayload.handlers?.insertImage?.(selectionPayload),
insertImageFromBlank: (blankPayload) => blankPayload.handlers?.insertImage?.(blankPayload),
```

在 `src/types/index.ts` 增加 DTO：

```ts
export interface InsertImageResult {
  markdownPath: string;
}
```

在 `src/api/commands.ts` 增加桥接方法：

```ts
type RawInsertImageResult = {
  markdown_path: string;
};

async function insertImageForNote(notePath: string): Promise<InsertImageResult | null> {
  const result = await invoke<RawInsertImageResult | null>("insert_image_for_note", { notePath });
  if (!result) {
    return null;
  }

  return { markdownPath: result.markdown_path };
}
```

- [ ] **Step 4: 跑菜单与桥接测试确认转绿**

Run: `corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts src/api/commands.test.ts`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src/menu/menuIds.ts src/components/ContextMenu/contextMenuTypes.ts src/menu/menuSchema.ts src/menu/menuActionRunner.ts src/components/ContextMenu/ContextMenuHost.tsx src/api/commands.ts src/types/index.ts src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts src/api/commands.test.ts
git commit -m "feat: add editor image menu actions"
```

## 4. Task 2 编辑器右键插图实现

**Files:**
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx`
- Test: `src/components/EditorWorkspace/MarkdownEditor.test.tsx`

- [ ] **Step 1: 先写编辑器失败测试**

在 `src/components/EditorWorkspace/MarkdownEditor.test.tsx` 增加以下测试：

```ts
it("shows insert image in the editor blank context menu", async () => {
  const onChange = vi.fn();
  const { container } = render(
    <ContextMenuProvider>
      <MarkdownEditor initialContent={"Body"} onChange={onChange} />
      <ContextMenuHost />
    </ContextMenuProvider>,
  );

  fireEvent.contextMenu(container.querySelector(".cm-content") as Element, { clientX: 40, clientY: 50 });

  expect(await screen.findByRole("menuitem", { name: "插入图片" })).toBeInTheDocument();
});
```

```ts
it("inserts markdown image syntax at the cursor after selecting an image", async () => {
  vi.spyOn(api, "insertImageForNote").mockResolvedValue({ markdownPath: "../assets/20260609-101010-a1b2c3.png" });
  useEditorStore.setState({
    currentNote: { id: "note-1", path: "notes/demo.md", title: "Demo", summary: null, content_hash: "h", word_count: 0, created_at: "", updated_at: "", indexed_at: "", deleted_at: null },
  });
  const onChange = vi.fn();

  const { container } = render(
    <ContextMenuProvider>
      <MarkdownEditor initialContent={"Body"} onChange={onChange} />
      <ContextMenuHost />
    </ContextMenuProvider>,
  );

  fireEvent.contextMenu(container.querySelector(".cm-content") as Element, { clientX: 40, clientY: 50 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "插入图片" }));

  await waitFor(() => {
    expect(onChange).toHaveBeenCalled();
  });

  expect(onChange.mock.lastCall?.[0]).toContain("![图片](../assets/20260609-101010-a1b2c3.png)");
});
```

```ts
it("does not change content when image selection is cancelled", async () => {
  vi.spyOn(api, "insertImageForNote").mockResolvedValue(null);
  useEditorStore.setState({
    currentNote: { id: "note-1", path: "notes/demo.md", title: "Demo", summary: null, content_hash: "h", word_count: 0, created_at: "", updated_at: "", indexed_at: "", deleted_at: null },
  });
  const onChange = vi.fn();

  const { container } = render(
    <ContextMenuProvider>
      <MarkdownEditor initialContent={"Body"} onChange={onChange} />
      <ContextMenuHost />
    </ContextMenuProvider>,
  );

  fireEvent.contextMenu(container.querySelector(".cm-content") as Element, { clientX: 40, clientY: 50 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "插入图片" }));

  await waitFor(() => {
    expect(api.insertImageForNote).toHaveBeenCalled();
  });

  expect(onChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑编辑器测试并确认先失败**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx`

Expected: FAIL，提示找不到“插入图片”菜单项或 `api.insertImageForNote` 未定义。

- [ ] **Step 3: 写最小编辑器实现**

在 `src/components/EditorWorkspace/MarkdownEditor.tsx` 新增统一插入函数：

```ts
async function insertImageAtSelection(view: EditorView, notePath: string) {
  const result = await api.insertImageForNote(notePath);
  if (!result) {
    return;
  }

  const imageMarkdown = `![图片](${result.markdownPath})`;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: imageMarkdown },
  });
}
```

把 handler 注入 editorSelection / editorBlank 的 `openContextMenu` payload：

```ts
handlers: {
  insertLink: () => void handleInsertLink(),
  insertImage: () => void handleInsertImage(),
  insertTag: () => void handleInsertTag(),
  createWikiLink: () => void handleCreateWikiLink(),
}
```

实现 `handleInsertImage`：

```ts
async function handleInsertImage() {
  const notePath = useEditorStore.getState().currentNote?.path;
  if (!notePath || !viewRef.current) {
    return;
  }

  await insertImageAtSelection(viewRef.current, notePath);
}
```

无当前笔记时禁用菜单项：

```ts
insertImage: currentNote?.path ? () => void handleInsertImage() : undefined,
```

- [ ] **Step 4: 跑编辑器测试确认转绿**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src/components/EditorWorkspace/MarkdownEditor.tsx src/components/EditorWorkspace/MarkdownEditor.test.tsx
git commit -m "feat: insert images from editor context menu"
```

## 5. Task 3 预览图片显示与样式约束

**Files:**
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Test: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [ ] **Step 1: 先写预览失败测试**

在 `src/components/EditorWorkspace/MarkdownPreview.test.tsx` 增加图片显示断言：

```ts
it("keeps rendered images constrained to the preview pane", () => {
  const { container } = render(
    <MarkdownPreview content="![图片](../assets/20260609-101010-a1b2c3.png)" />,
  );

  expect(container.querySelector("img")).toHaveStyle({
    maxWidth: "100%",
    height: "auto",
    display: "block",
  });
});
```

- [ ] **Step 2: 跑预览测试并确认先失败**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/MarkdownPreview.test.tsx`

Expected: FAIL，当前 `img` 未带这些样式。

- [ ] **Step 3: 写最小预览实现**

在 `src/components/EditorWorkspace/MarkdownPreview.tsx` 的预览容器样式中补 `img` 规则：

```ts
"& img": {
  maxWidth: "100%",
  height: "auto",
  display: "block",
  margin: "12px auto",
  objectFit: "contain",
},
```

如果相对路径被 URI 白名单拦截，保持最小放开：

```ts
const ALLOWED_MARKDOWN_URI = /^(?:(?:https?):|(?:data:image\/(?:gif|png|jpe?g|webp);base64,)|(?:notes\/)|(?:\.?\.\/)|(?:\/)|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
```

- [ ] **Step 4: 跑预览测试确认转绿**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/MarkdownPreview.test.tsx`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src/components/EditorWorkspace/MarkdownPreview.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
git commit -m "fix: constrain preview images within pane"
```

## 6. Task 4 Tauri 图片导入命令

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/domain/note.rs`
- Modify: `src-tauri/src/services/note.rs`
- Test: `src-tauri/src/services/note.rs`

- [ ] **Step 1: 先写 Rust 失败测试**

在 `src-tauri/src/services/note.rs` 增加针对纯函数的单测，先定义目标行为：

```rust
#[test]
fn builds_timestamped_asset_name_with_original_extension() {
    let file_name = build_inserted_image_file_name(
        "png",
        chrono::NaiveDate::from_ymd_opt(2026, 6, 9).unwrap().and_hms_opt(10, 10, 10).unwrap(),
        "a1b2c3",
    );

    assert_eq!(file_name, "20260609-101010-a1b2c3.png");
}
```

```rust
#[test]
fn computes_relative_markdown_path_from_note_directory() {
    let note_path = std::path::Path::new("notes/project/demo.md");
    let asset_path = std::path::Path::new("notes/assets/20260609-101010-a1b2c3.png");

    let relative = build_markdown_relative_asset_path(note_path, asset_path).unwrap();

    assert_eq!(relative, "../assets/20260609-101010-a1b2c3.png");
}
```

```rust
#[test]
fn rejects_non_image_extension() {
    let result = validate_insertable_image_extension("pdf");
    assert!(result.is_err());
}
```

- [ ] **Step 2: 跑 Rust 定向测试并确认先失败**

Run: `cd src-tauri && cargo test services::note::`

Expected: FAIL，提示辅助函数不存在。

- [ ] **Step 3: 写最小后端实现**

在 `src-tauri/src/domain/note.rs` 增加 DTO：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertImageResult {
    pub markdown_path: String,
}
```

在 `src-tauri/src/services/note.rs` 增加纯函数：

```rust
fn validate_insertable_image_extension(ext: &str) -> Result<&str, AppError> {
    match ext.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" => Ok(ext),
        _ => Err(AppError::InvalidInput("Selected file is not a supported image".into())),
    }
}

fn build_inserted_image_file_name(ext: &str, timestamp: NaiveDateTime, suffix: &str) -> String {
    format!("{}-{}.{}", timestamp.format("%Y%m%d-%H%M%S"), suffix, ext)
}
```

实现服务主函数：

```rust
pub fn insert_image_for_note_service(
    state: &AppState,
    note_path: &str,
) -> Result<Option<InsertImageResult>, AppError> {
    let root = state
        .kb_root_guard()
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();

    let source_path = match FileDialogBuilder::new()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"])
        .pick_file()
    {
        Some(path) => path,
        None => return Ok(None),
    };

    let ext = source_path
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput("Selected file has no extension".into()))?;
    validate_insertable_image_extension(ext)?;

    let assets_dir = root.join("notes").join("assets");
    std::fs::create_dir_all(&assets_dir)?;

    let suffix = &uuid::Uuid::new_v4().simple().to_string()[..6];
    let file_name = build_inserted_image_file_name(ext, chrono::Local::now().naive_local(), suffix);
    let target_path = assets_dir.join(file_name);
    std::fs::copy(&source_path, &target_path)?;

    let relative_asset_path = target_path
        .strip_prefix(root.join("notes"))
        .map_err(|_| AppError::InvalidInput("Failed to normalize asset path".into()))?;
    let markdown_path = build_markdown_relative_asset_path(
        std::path::Path::new(note_path),
        &std::path::Path::new("notes").join(relative_asset_path),
    )?;

    Ok(Some(InsertImageResult { markdown_path }))
}
```

在 `src-tauri/src/commands/note.rs` 暴露命令：

```rust
#[tauri::command]
pub async fn insert_image_for_note(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<Option<InsertImageResult>, AppError> {
    insert_image_for_note_service(&state, &note_path)
}
```

在 `src-tauri/src/lib.rs` 注册：

```rust
commands::note::insert_image_for_note,
```

- [ ] **Step 4: 跑 Rust 测试确认转绿**

Run: `cd src-tauri && cargo test`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands/note.rs src-tauri/src/domain/note.rs src-tauri/src/services/note.rs
git commit -m "feat: import editor images into assets directory"
```

## 7. Task 5 全链路回归

**Files:**
- Verify only

- [ ] **Step 1: 跑前端定向测试**

Run: `corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx src/api/commands.test.ts`

Expected: PASS

- [ ] **Step 2: 跑前端构建验证**

Run: `corepack pnpm build`

Expected: build 成功，无 TypeScript 错误。

- [ ] **Step 3: 跑 Rust 全量测试**

Run: `cd src-tauri && cargo test`

Expected: PASS

- [ ] **Step 4: 手工冒烟验证**

Run: `PATH="$HOME/.npm-global/bin:$PATH" DISABLE_AUTO_UPDATE=true corepack pnpm tauri dev`

Expected:

1. 打开任意笔记。
2. 在编辑区空白处右键可以看到“插入图片”。
3. 选择 png/jpg/webp 图片后，正文出现 `![图片](...)`。
4. 左侧树不出现 assets 目录。
5. 分栏预览中图片完整显示且不横向溢出。

- [ ] **Step 5: 提交收尾**

```bash
git add .
git commit -m "feat: add editor image insertion workflow"
```

## 8. 自检结果

### 8.1 Spec coverage

- 编辑区右键入口：Task 1 + Task 2 覆盖。
- 统一写入 notes/assets：Task 4 覆盖。
- 文件名系统生成：Task 4 覆盖。
- Markdown 立即写入：Task 2 覆盖。
- 预览不溢出：Task 3 覆盖。
- assets 继续隐藏：Task 5 手工冒烟验证覆盖。

### 8.2 Placeholder scan

- 已检查，文档内没有未决占位表达。

### 8.3 Type consistency

- 前端 DTO 名称统一为 `InsertImageResult`。
- Tauri 命令名统一为 `insert_image_for_note`。
- 前端桥接方法统一为 `insertImageForNote`。
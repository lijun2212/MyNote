# MyNote Phase 2 — Tags · Wiki Links · Full-Text Search · File Watcher

**Date:** 2026-05-30  
**Status:** Approved  
**Builds on:** Phase 1 (KB management, note CRUD, editor, auto-save)

---

## 1. 目标

Phase 2 在 Phase 1 的可用内核上增加知识管理的核心增强能力：

| 功能 | 价值 |
|------|------|
| 标签系统 | 按主题组织笔记，支持过滤和分类 |
| Wiki 双链与反链 | 在笔记间建立显式知识连接 |
| FTS5 全文搜索 | 按关键字快速定位知识 |
| 文件监听 | 支持外部编辑器修改后自动同步索引 |

---

## 2. 范围

**包含：**
- 标签提取（Front Matter + 内联 `#标签`）
- 标签面板（左侧边栏选项卡）
- Wiki 链接解析与渲染（`[[笔记标题]]`、`[[标题|文本]]`、`[[标题#章节]]`）
- 反链面板（右侧边栏：出链 / 反链 / 未解析链接）
- FTS5 全文搜索（AppHeader 搜索框 + 结果浮层）
- 文件监听（`notify`，防抖 500ms，触发增量索引）

**不包含（Phase 3）：**
- 手动关系（related/prerequisite 等）
- 总结陈词历史
- 修订快照与差异查看
- 知识图谱渲染

---

## 3. 数据库变更

### 3.1 新增表（Migration v2）

```sql
-- 标签表
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 笔记-标签关联
CREATE TABLE note_tags (
  note_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL,   -- 'front_matter' | 'inline'
  PRIMARY KEY (note_id, tag_id, source),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 链接表
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  source_note_id TEXT NOT NULL,
  target_note_id TEXT,
  target_raw TEXT NOT NULL,
  display_text TEXT,
  link_type TEXT NOT NULL,   -- 'wiki' | 'markdown' | 'asset'
  anchor TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  start_offset INTEGER,
  end_offset INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX idx_links_source ON links(source_note_id);
CREATE INDEX idx_links_target ON links(target_note_id);
CREATE INDEX idx_links_resolved ON links(resolved);

-- 文件事件日志（监听/诊断用）
CREATE TABLE file_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,   -- 'create' | 'modify' | 'delete' | 'rename'
  path TEXT NOT NULL,
  old_path TEXT,
  content_hash TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

-- 全文搜索虚拟表
CREATE VIRTUAL TABLE note_fts USING fts5(
  note_id UNINDEXED,
  title,
  summary,
  body,
  tokenize = 'unicode61'
);
```

### 3.2 迁移策略

- `db.rs` 的迁移机制已存在（Phase 1）。本次在 `schema_migrations` 中写入 `version = 2`，名称 `phase2_tags_links_fts_watcher`。
- 迁移失败时停止打开知识库并提示备份恢复。
- 索引重建时重新填充 `note_fts`。

---

## 4. 后端设计

### 4.1 `infrastructure/markdown.rs` 扩展

新增函数：

```
extract_tags(content: &str) -> TagExtractionResult
  - 解析 Front Matter tags 数组 → source: front_matter
  - 解析正文内联 #标签（跳过代码块和 URL 片段）→ source: inline

extract_links(content: &str, note_path: &str) -> Vec<RawLink>
  - 解析 [[title]], [[title|text]], [[title#anchor]]
  - 解析 [text](relative/path.md), [text](path.md#anchor)
  - 返回 RawLink { target_raw, display_text, link_type, anchor, start_offset, end_offset }
```

内联标签规则：
- `#` 后接中文、英文、数字、`-`、`_`，不含空格
- 不识别代码块（` ``` ``` `、` ` ` `）内的标签
- 不识别 URL 片段（`://` 之后的 `#anchor`）

### 4.2 `services/index_service.rs` 扩展

在 `index_note(note_id, content, db)` 中新增步骤（与现有 note upsert 在同一事务内）：

1. 删除该 note 的旧 `note_tags`（by note_id）
2. Upsert 提取到的每个 tag → `tags` 表（name/normalized_name），取 id
3. 插入 `note_tags`（note_id, tag_id, source）
4. 删除该 note 的旧 `links`
5. 解析 links，按优先级解析 target_note_id（ID → 路径 → 标题），插入 `links`
6. Delete + Insert `note_fts`（note_id, title, summary, plain_body）

链接解析优先级（`resolve_link_target`）：
1. 精确匹配 `notes.id`
2. 精确匹配 `notes.path`（相对路径）
3. 精确匹配 `notes.title`（区分大小写）
4. 忽略大小写匹配 `notes.title`
5. 无匹配 → `resolved = 0, target_note_id = NULL`

### 4.3 `commands/search.rs`（新文件）

```rust
#[tauri::command]
pub async fn search_notes(
    kb_id: String,
    query: String,
    limit: Option<usize>,
    state: State<AppState>,
) -> Result<Vec<SearchResult>, String>
```

SQL：
```sql
SELECT n.id, n.title, n.path,
       snippet(note_fts, 2, '<mark>', '</mark>', '…', 20) as snippet,
       rank
FROM note_fts
JOIN notes n ON note_fts.note_id = n.id
WHERE note_fts MATCH ? AND n.deleted_at IS NULL
ORDER BY rank
LIMIT ?
```

返回：`SearchResult { note_id, title, path, snippet, score }`

### 4.4 `commands/link.rs`（新文件）

```rust
#[tauri::command]
pub async fn get_note_links(
    note_id: String,
    state: State<AppState>,
) -> Result<NoteLinks, String>
```

`NoteLinks`:
- `outgoing: Vec<LinkItem>` — 本笔记的出链（`links.source_note_id = note_id`）
- `backlinks: Vec<LinkItem>` — 指向本笔记的反链（`links.target_note_id = note_id`）
- `unresolved: Vec<LinkItem>` — 本笔记中未解析链接（`resolved = 0`）

`LinkItem { link_id, note_id, note_title, note_path, target_raw, display_text, link_type }`

### 4.5 `services/watcher_service.rs`（新文件）

```
WatcherService {
  watcher: RecommendedWatcher,  // notify crate
  debounce_map: HashMap<PathBuf, Instant>,
  index_queue: Sender<PathBuf>,
}

start_watching(root_path: PathBuf, app_handle: AppHandle) -> Result<WatcherHandle>
  - 监听 notes/ 目录递归变更
  - 事件类型: Create | Modify | Remove | Rename
  - 防抖: 同路径事件合并，500ms 无新事件才入队
  - 入队后: 调用 index_service.index_note_from_path
  - 索引完成后: emit "note:index_updated" 事件
  - Remove 事件: soft-delete note (deleted_at = now)
  - Rename 事件: update notes.path + links resolution
```

`AppState` 中持有 `WatcherHandle`；`open_knowledge_base` 时启动，`close_knowledge_base` 时停止。

---

## 5. 前端设计

### 5.1 `LeftSidebar` 扩展

左侧边栏顶部新增选项卡栏（文件树 / 标签）：

```
[ 文件 ] [ 标签 ]
```

**`TagPanel.tsx`（新文件）**：
- 从 `api.listTags(kb_id)` 获取标签列表（带笔记数）
- 标签按笔记数降序排列
- 点击标签 → 触发标签过滤，`FileTreePanel` 切换到文件树选项卡并只显示含该标签的笔记
- 支持多选（Ctrl/Cmd+Click），多选时 AND 过滤
- 选中标签在标签面板中高亮显示

新增 Tauri command：
```
list_tags(kb_id) -> Vec<TagSummary { id, name, note_count }>
list_notes_by_tag(kb_id, tag_ids: Vec<String>) -> Vec<NoteTreeNode>
```

### 5.2 `RightSidebar` 扩展

右侧边栏顶部新增选项卡（大纲 / 反链）：

```
[ 大纲 ] [ 反链 ]
```

**`BacklinksPanel.tsx`（新文件）**：
- 调用 `api.getNoteLinks(note_id)` 获取链接数据
- 三个折叠区域：
  - **出链** `(n)` — 本笔记中所有出链，显示目标标题 + 路径
  - **反链** `(n)` — 引用本笔记的其他笔记，显示来源标题 + 路径
  - **未解析链接** `(n)` — 红色标注，显示原始链接文本
- 点击任意条目 → 打开对应笔记（`setCurrentNote`）
- 当前笔记切换时自动刷新

### 5.3 `AppHeader` 搜索

**搜索触发：**
- `⌘K` / `Ctrl+K` 聚焦搜索框
- 搜索框在 AppHeader 居中显示

**搜索行为：**
- 空输入时显示最近 10 条访问的笔记
- 输入后 300ms 防抖触发 `search_notes`
- 结果浮层（最多 50 条），每条显示：标题 + 相对路径 + 匹配片段（`<mark>` 高亮）
- 键盘 ↑/↓ 导航，Enter 打开，Escape 关闭
- 点击结果打开笔记

**`useSearch.ts`（新 hook）：**
- 管理搜索状态（query, results, isOpen, loading）
- 防抖逻辑

### 5.4 `MarkdownPreview` Wiki 链接渲染

在 `markdown-it` 实例上注册自定义规则，将 `[[target]]`、`[[target|text]]`、`[[target#anchor]]` 渲染为：

```html
<!-- 已解析 -->
<a class="wiki-link resolved" data-note-id="..." href="#">显示文本</a>
<!-- 未解析 -->
<a class="wiki-link unresolved" href="#">[[未解析目标]]</a>
```

前端在预览容器上使用事件委托监听点击，调用 `setCurrentNote` 导航。

未解析链接以虚线下划线 + 红色样式显示。

---

## 6. 实施顺序（全栈切片法）

| 切片 | 内容 | 依赖 |
|------|------|------|
| S1 | DB Migration v2（tags/links/note_fts/file_events 表）| Phase 1 db.rs |
| S2 | 标签提取 + 索引（后端）+ 标签面板（前端）| S1 |
| S3 | Wiki 链接解析 + 索引（后端）+ 链接渲染 + 反链面板（前端）| S1 |
| S4 | FTS5 搜索命令（后端）+ 搜索 UI（前端）| S1, S2, S3（FTS需标签和链接数据填充）|
| S5 | 文件监听（后端）+ 前端事件处理 + StatusBar 提示 | S1, S2, S3, S4 |

---

## 7. 关键约束

1. **中文搜索**：FTS5 `unicode61` 分词对中文支持有限（按 Unicode 码点分词），首版可接受，后续可升级为 trigram tokenizer。
2. **链接解析一致性**：链接解析在索引时执行（非查询时），因此目标笔记不存在时先记录为 `resolved=0`，后续保存笔记时重新尝试解析。
3. **文件监听与自动保存的协调**：自动保存触发的文件写入不应再触发文件监听重新索引（已通过 content_hash 比较避免）。
4. **FTS 更新原子性**：FTS 表的 delete + insert 必须在同一事务中执行，与 `notes` 表更新一起提交。

---

## 8. 新增 TypeScript 类型

```typescript
interface Tag { id: string; name: string; note_count?: number }

interface LinkItem {
  link_id: string;
  note_id: string | null;
  note_title: string | null;
  note_path: string | null;
  target_raw: string;
  display_text: string | null;
  link_type: "wiki" | "markdown" | "asset";
}

interface NoteLinks {
  outgoing: LinkItem[];
  backlinks: LinkItem[];
  unresolved: LinkItem[];
}

interface SearchResult {
  note_id: string;
  title: string;
  path: string;
  snippet: string;
  score: number;
}
```

---

## 8b. 侧栏可折叠与可调宽设计

### 布局行为

| 侧栏 | 初始状态 | 默认宽度 | 宽度范围 |
|------|----------|----------|----------|
| 左侧边栏 | **展开** | 240px | 120px ~ 480px |
| 右侧边栏 | **收起** | 280px（展开时）| 200px ~ 400px |

### 交互规则

- 每个侧栏在其靠编辑区一侧有一个 **resize handle**（8px 宽透明拖拽区，hover 时变为双向箭头光标），按住拖动实时改变宽度。
- 每个侧栏有一个 **折叠按钮**（`‹` / `›`）：
  - 左侧栏折叠按钮在栏顶部右侧
  - 右侧栏折叠按钮在栏顶部左侧
  - 折叠时内容区宽度收为 0，resize handle 不可用，折叠按钮仍显示在编辑区边缘
- 宽度偏好持久化到 `localStorage`（key: `mynote:left-sidebar:width`, `mynote:right-sidebar:width`, `mynote:right-sidebar:visible`），下次启动恢复。
- 收起状态下内容区 `display: none`，避免不可见内容仍占用渲染资源。

### 实现方式

- 不引入第三方 resize 库，用自定义 hook `useSidebarResize(side, defaultWidth)` 实现：
  - 返回 `{ width, isCollapsed, toggleCollapse, handleMouseDown }`
  - `handleMouseDown` 绑定到 resize handle 的 `onMouseDown`
  - `mousemove` / `mouseup` 监听在 `document` 上，避免鼠标快速移动时中断拖拽
- `AppShell.tsx` 的侧栏从 CSS 固定宽度改为 `inline style` 动态宽度，`editor-workspace` 保持 `flex: 1` 自动填充剩余空间

---

## 9. 不变更

- Phase 1 的知识库创建/打开/笔记 CRUD 流程保持不变
- `auto_save` 逻辑不变，仅在 `index_service` 中增加标签/链接/FTS 的同步更新
- 现有 SQLite 表（`knowledge_base_meta`, `notes`）只增字段，不破坏现有数据

# 个人 Markdown 笔记知识库详细设计

## 1. 文档说明

本文档在 `docs/personal-knowledge-base-design.md` 的总体方案基础上展开，进一步定义系统模块、数据模型、接口边界、核心流程、异常处理、同步策略、测试方案和实施拆分。本文档面向后续工程实现，用于指导前端、桌面端、本地服务、数据库和文件系统相关开发。

## 2. 总体设计细化

### 2.1 系统定位

系统是一款本地优先的个人知识库桌面应用。它不是云笔记服务，也不是多人协作文档系统。核心能力是让用户用 Markdown 文件长期保存知识，并通过 SQLite 索引获得目录、搜索、双链、图谱、总结和修订记录等增强能力。

### 2.2 数据权威性

系统中存在两类数据：

| 数据类型 | 权威来源 | 说明 |
| --- | --- | --- |
| 笔记正文 | Markdown 文件 | 用户知识资产的最终载体 |
| 附件 | assets 目录 | 图片、PDF、其他引用文件 |
| 笔记基础元数据 | Markdown Front Matter 优先 | id、title、tags、summary、created_at、updated_at |
| 索引数据 | SQLite | 可从 Markdown 重建 |
| 手动关系 | SQLite，定期备份 | 无法完全从 Markdown 推导 |
| 修订快照 | `.mynote/backups` | 可选增强数据 |
| 应用设置 | config 文件与 SQLite | 本地配置数据 |

当 Markdown 文件与 SQLite 索引不一致时，以 Markdown 文件为准。SQLite 中不可推导数据需要备份与迁移机制保护。

### 2.3 技术栈建议

| 层级 | 推荐技术 | 说明 |
| --- | --- | --- |
| 桌面容器 | Tauri | 跨平台桌面封装 |
| 本地核心 | Rust | 文件系统、SQLite、索引、监听、命令接口 |
| 前端框架 | React 或 Vue | UI 状态管理和组件组合 |
| 编辑器 | CodeMirror 6 或 Milkdown | 首版建议 CodeMirror 6 + 预览，后续增强所见即所得 |
| Markdown 解析 | markdown-it / pulldown-cmark | 前端预览与后端索引可分别使用成熟解析器 |
| 图谱渲染 | Cytoscape.js / Sigma.js | 首版局部图谱优先 |
| 数据库 | SQLite + FTS5 | 本地索引和全文搜索 |
| 文件监听 | notify | Rust 跨平台文件监听 |

## 3. 目录结构详细设计

### 3.1 知识库目录

```text
MyKnowledgeBase/
  notes/
    inbox/
    projects/
    reading/
  assets/
    images/
    files/
  .mynote/
    index.sqlite
    index.sqlite.bak
    config.json
    backups/
      revisions/
      database/
    logs/
    tmp/
```

### 3.2 目录职责

| 路径 | 职责 | 是否建议同步 |
| --- | --- | --- |
| `notes/` | Markdown 笔记 | 是 |
| `assets/images/` | 图片附件 | 是 |
| `assets/files/` | 普通附件 | 是 |
| `.mynote/index.sqlite` | SQLite 索引库 | 可同步，但允许重建 |
| `.mynote/config.json` | 知识库配置 | 是 |
| `.mynote/backups/revisions/` | 修订快照 | 可选 |
| `.mynote/backups/database/` | 数据库备份 | 可选 |
| `.mynote/logs/` | 本地日志 | 否 |
| `.mynote/tmp/` | 临时文件 | 否 |

### 3.3 路径规则

1. 数据库存储相对知识库根目录的路径。
2. Markdown 内部附件引用使用相对路径。
3. 路径分隔符在内部统一为 `/`。
4. 文件名允许中文、空格和常见符号，但禁止系统保留字符。
5. 文件移动后保持笔记 `id` 不变。

## 4. 前端详细设计

### 4.1 页面布局

主窗口由五个区域组成：

```text
┌────────────────────────────────────────────────────────────┐
│ AppHeader：知识库名 / 搜索入口 / 保存状态 / 设置             │
├───────────────┬────────────────────────────┬───────────────┤
│ LeftSidebar   │ EditorWorkspace            │ RightSidebar  │
│ 文件树/标签    │ 编辑器/预览/图谱/搜索结果     │ 大纲/摘要/反链 │
├───────────────┴────────────────────────────┴───────────────┤
│ StatusBar：路径 / 字数 / 索引状态 / 同步提示                 │
└────────────────────────────────────────────────────────────┘
```

### 4.2 前端模块划分

| 模块 | 职责 |
| --- | --- |
| `AppShell` | 应用主布局、全局快捷键、窗口状态 |
| `KnowledgeBaseSwitcher` | 打开、创建、切换知识库 |
| `FileTreePanel` | 展示和操作目录树 |
| `TagPanel` | 标签列表、标签过滤 |
| `MarkdownEditor` | 编辑 Markdown 内容 |
| `MarkdownPreview` | 实时预览 |
| `DocumentOutline` | 当前文档标题大纲 |
| `BacklinksPanel` | 出链、反向链接、未解析链接 |
| `SummaryPanel` | 总结陈词展示和编辑 |
| `RevisionPanel` | 修订记录列表、差异查看、恢复 |
| `GraphView` | 局部知识图谱 |
| `SearchView` | 全文搜索、过滤和跳转 |
| `SettingsView` | 应用级和知识库级设置 |

### 4.3 前端状态模型

建议将状态分为四类：

| 状态类型 | 示例 | 存放位置 |
| --- | --- | --- |
| 会话状态 | 当前打开笔记、侧栏开关、选中标签 | 前端 store |
| 编辑状态 | 当前文档内容、脏状态、光标位置 | 编辑器状态 |
| 持久设置 | 主题、字体、自动保存间隔 | SQLite/config |
| 后端索引状态 | 当前索引进度、文件监听状态 | 后端事件推送 |

### 4.4 编辑体验

首版建议实现“源码编辑 + 实时预览 + 专注模式”，所见即所得作为后续增强。

原因：

- 源码编辑稳定、可控、易调试。
- 实时预览能满足大多数 Markdown 写作需求。
- 所见即所得需要处理 Markdown AST、光标映射、复杂快捷键和粘贴行为，首版风险较高。

### 4.5 自动保存策略

1. 用户输入后标记文档为 dirty。
2. 800ms 内无继续输入则触发自动保存。
3. 保存期间显示 `保存中`。
4. 保存成功显示 `已保存`。
5. 保存失败显示错误并保留编辑器内容。
6. 用户切换文档前若存在未保存内容，先尝试保存；失败时阻止切换并提示。

## 5. Tauri/Rust 后端详细设计

### 5.1 后端职责

后端承担所有与本地系统强相关的能力：

- 知识库创建与打开。
- 文件读取、写入、移动、删除。
- SQLite 数据库访问。
- Markdown 索引解析。
- 文件监听。
- 全文搜索。
- 修订快照。
- 图谱查询。
- 设置读写。

前端不直接访问文件系统和数据库，只通过 Tauri command 调用后端服务。

### 5.2 后端模块划分

```text
src-tauri/src/
  main.rs
  commands/
    knowledge_base.rs
    note.rs
    search.rs
    graph.rs
    revision.rs
    settings.rs
  services/
    knowledge_base_service.rs
    note_service.rs
    index_service.rs
    link_service.rs
    graph_service.rs
    revision_service.rs
    watcher_service.rs
    settings_service.rs
  domain/
    note.rs
    tag.rs
    link.rs
    relation.rs
    revision.rs
    graph.rs
  infrastructure/
    db.rs
    fs.rs
    markdown.rs
    front_matter.rs
    path.rs
    hash.rs
    logger.rs
```

### 5.3 服务边界

| 服务 | 输入 | 输出 | 依赖 |
| --- | --- | --- | --- |
| KnowledgeBaseService | 根目录路径 | 知识库信息 | fs、db、settings |
| NoteService | note_id/path/content | 笔记详情 | fs、index、revision |
| IndexService | Markdown 文件路径 | 索引结果 | markdown、db、fts |
| LinkService | 笔记正文 | 链接集合 | markdown、db |
| GraphService | note_id、深度、过滤条件 | 节点与边 | db |
| RevisionService | note_id、content_hash | 修订记录 | fs、db |
| WatcherService | root_path | 文件事件 | notify、index |
| SettingsService | key/value | 设置项 | config、db |

### 5.4 Tauri Command 设计

#### 知识库

```text
create_knowledge_base(path, name) -> KnowledgeBase
open_knowledge_base(path) -> KnowledgeBase
get_recent_knowledge_bases() -> KnowledgeBase[]
close_knowledge_base(id) -> void
rebuild_index(kb_id) -> RebuildIndexResult
```

#### 笔记

```text
list_notes(kb_id, parent_path?) -> NoteTreeNode[]
create_note(kb_id, directory, title) -> NoteDetail
get_note(note_id) -> NoteDetail
save_note(note_id, content, expected_hash?) -> SaveNoteResult
rename_note(note_id, new_title) -> NoteDetail
move_note(note_id, target_directory) -> NoteDetail
delete_note(note_id) -> void
restore_note(note_id) -> NoteDetail
```

#### 搜索

```text
search_notes(kb_id, query, filters, limit, offset) -> SearchResult[]
search_tags(kb_id, query) -> Tag[]
```

#### 链接与关系

```text
get_note_links(note_id) -> NoteLinks
create_relation(source_note_id, target_note_id, relation_type, description) -> Relation
delete_relation(relation_id) -> void
list_relations(note_id) -> Relation[]
```

#### 图谱

```text
get_local_graph(note_id, depth, filters) -> GraphData
get_global_graph(kb_id, filters, limit) -> GraphData
```

#### 修订

```text
list_revisions(note_id) -> Revision[]
get_revision_diff(note_id, revision_id) -> RevisionDiff
restore_revision(note_id, revision_id) -> NoteDetail
```

#### 设置

```text
get_settings(scope) -> Settings
update_settings(scope, patch) -> Settings
```

### 5.5 事件推送

后端通过 Tauri event 向前端推送异步状态：

```text
note:file_changed
note:index_updated
note:save_failed
kb:index_rebuild_started
kb:index_rebuild_progress
kb:index_rebuild_finished
kb:database_conflict_detected
sync:conflict_file_detected
watcher:error
```

## 6. 领域模型详细设计

### 6.1 Note

```text
Note {
  id: string
  path: string
  title: string
  summary: string | null
  tags: Tag[]
  content_hash: string
  word_count: number
  created_at: datetime
  updated_at: datetime
  indexed_at: datetime
  deleted_at: datetime | null
}
```

### 6.2 NoteDetail

```text
NoteDetail {
  note: Note
  content: string
  front_matter: object
  outline: OutlineItem[]
  links: Link[]
  backlinks: Link[]
  unresolved_links: Link[]
}
```

### 6.3 Link

```text
Link {
  id: string
  source_note_id: string
  target_note_id: string | null
  target_raw: string
  display_text: string | null
  link_type: "wiki" | "markdown" | "heading" | "asset"
  anchor: string | null
  resolved: boolean
  position: TextRange
}
```

### 6.4 Relation

```text
Relation {
  id: string
  source_note_id: string
  target_note_id: string
  relation_type: "related" | "prerequisite" | "extension" | "opposes" | "supports" | "similar"
  description: string | null
  created_at: datetime
  updated_at: datetime
}
```

### 6.5 GraphData

```text
GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

GraphNode {
  id: string
  title: string
  path: string
  summary: string | null
  tags: string[]
  node_type: "note" | "tag" | "unresolved"
  weight: number
}

GraphEdge {
  id: string
  source: string
  target: string
  edge_type: "link" | "backlink" | "manual_relation" | "tag_cooccurrence" | "directory"
  label: string | null
  weight: number
}
```

## 7. 数据库详细设计

### 7.1 Schema 管理

SQLite 使用迁移机制管理版本：

```text
schema_migrations(
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)
```

每次应用启动时检查数据库版本，按顺序执行迁移。迁移失败时停止打开知识库并提示用户恢复备份。

### 7.2 表结构

#### knowledge_base_meta

```sql
CREATE TABLE knowledge_base_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### notes

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  content_hash TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  front_matter_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_notes_path ON notes(path);
CREATE INDEX idx_notes_title ON notes(title);
CREATE INDEX idx_notes_deleted_at ON notes(deleted_at);
```

#### tags

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### note_tags

```sql
CREATE TABLE note_tags (
  note_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (note_id, tag_id, source),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

`source` 取值为 `front_matter` 或 `inline`。

#### links

```sql
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  source_note_id TEXT NOT NULL,
  target_note_id TEXT,
  target_raw TEXT NOT NULL,
  display_text TEXT,
  link_type TEXT NOT NULL,
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
```

#### relations

```sql
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  source_note_id TEXT NOT NULL,
  target_note_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX idx_relations_source ON relations(source_note_id);
CREATE INDEX idx_relations_target ON relations(target_note_id);
CREATE INDEX idx_relations_type ON relations(relation_type);
```

#### revisions

```sql
CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  word_count INTEGER NOT NULL,
  snapshot_path TEXT,
  change_source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX idx_revisions_note ON revisions(note_id);
CREATE INDEX idx_revisions_created_at ON revisions(created_at);
```

`change_source` 取值为 `editor`、`external`、`restore`、`sync`。

#### settings

```sql
CREATE TABLE settings (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
```

`scope` 取值为 `app` 或 `knowledge_base`。

#### file_events

用于诊断和同步冲突分析：

```sql
CREATE TABLE file_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL,
  old_path TEXT,
  content_hash TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);
```

#### note_fts

```sql
CREATE VIRTUAL TABLE note_fts USING fts5(
  note_id UNINDEXED,
  title,
  summary,
  body,
  tokenize = 'unicode61'
);
```

中文全文搜索首版可使用 SQLite 默认 unicode61 分词提供基础能力；后续如需更好的中文分词，可评估 FTS5 trigram tokenizer 或引入专门分词索引。

### 7.3 事务规则

以下操作必须使用数据库事务：

- 创建笔记并写入索引。
- 保存笔记后的索引更新。
- 重命名或移动笔记。
- 删除笔记。
- 重建索引。
- 恢复修订版本。

文件写入与数据库事务无法天然原子化，因此采用补偿策略：先写临时文件并原子替换，再更新数据库；若数据库更新失败，将文件事件记录为待重新索引。

## 8. Markdown 解析详细设计

### 8.1 Front Matter 解析

支持 YAML Front Matter。字段规则：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| id | 推荐 | 稳定笔记 ID，缺失时系统生成 |
| title | 可选 | 缺失时使用一级标题或文件名 |
| created_at | 可选 | 缺失时使用文件创建时间 |
| updated_at | 可选 | 保存时更新 |
| tags | 可选 | 字符串数组 |
| summary | 可选 | 总结陈词 |
| aliases | 可选 | 标题别名，用于链接解析 |

### 8.2 标题提取优先级

1. Front Matter 的 `title`。
2. 正文第一个一级标题。
3. 文件名去除扩展名。

### 8.3 标签提取

标签来源：

1. Front Matter `tags`。
2. 正文内联标签，例如 `#软件工程`。

正文标签识别规则：

- 标签以 `#` 开头。
- 后续允许中文、英文、数字、短横线、下划线。
- 代码块内不识别标签。
- URL 片段不识别为标签。

### 8.4 链接提取

支持以下形式：

```text
[[笔记标题]]
[[笔记标题#章节]]
[[笔记标题|显示文本]]
[显示文本](relative/path.md)
[章节](relative/path.md#heading)
![图片](../assets/images/a.png)
```

链接解析优先级：

1. 精确匹配笔记 `id`。
2. 精确匹配相对路径。
3. 精确匹配标题。
4. 精确匹配别名。
5. 忽略大小写匹配标题或别名。
6. 无匹配则标记为未解析。

如果多个笔记标题相同，链接状态为 `ambiguous`，UI 提示用户选择目标。数据库首版可通过 `resolved = 0` 与 `target_raw` 表示，后续增加 `resolution_status` 字段。

### 8.5 正文纯文本提取

用于全文搜索和字数统计：

- 移除 Front Matter。
- 移除 Markdown 标记。
- 保留标题、段落、列表文字。
- 代码块内容默认纳入搜索，但在搜索结果中标记来源。
- 图片 alt 文本纳入搜索。

## 9. 核心流程详细设计

### 9.1 创建知识库

```text
用户选择目录
  -> 校验目录是否为空或是否已有 .mynote
  -> 创建 notes/assets/.mynote 子目录
  -> 创建 config.json
  -> 创建 index.sqlite
  -> 执行数据库迁移
  -> 写入 knowledge_base_meta
  -> 启动文件监听
  -> 返回知识库信息
```

异常处理：

- 目录无权限：提示更换目录。
- 已存在知识库：转为打开知识库流程。
- 数据库初始化失败：删除未完成的 `.mynote/tmp` 临时文件，保留用户目录。

### 9.2 打开知识库

```text
用户选择根目录
  -> 检查 .mynote/config.json
  -> 检查 index.sqlite
  -> 检查 schema 版本
  -> 执行必要迁移
  -> 快速扫描 notes 目录
  -> 对比文件 mtime/hash 与 notes 表
  -> 异步补充索引
  -> 启动文件监听
  -> 返回目录树和最近笔记
```

### 9.3 创建笔记

```text
前端请求 create_note(directory, title)
  -> 后端规范化文件名
  -> 生成 note_id
  -> 生成 Front Matter
  -> 写入临时文件
  -> 原子重命名为 .md 文件
  -> 解析 Markdown
  -> 写入 notes/note_fts/tags/links
  -> 返回 NoteDetail
```

### 9.4 保存笔记

```text
前端请求 save_note(note_id, content, expected_hash)
  -> 查询 note 当前 path 和 content_hash
  -> 若 expected_hash 与数据库不一致，执行冲突判断
  -> 写入 .tmp 文件
  -> fsync 后原子替换
  -> 计算新 hash
  -> 判断是否需要创建 revision
  -> 解析 Markdown
  -> 在事务中更新 notes/tags/links/note_fts
  -> 推送 note:index_updated
  -> 返回 SaveNoteResult
```

冲突规则：

- 如果数据库 hash 与前端 expected_hash 不一致，说明保存期间文件被外部修改。
- 不覆盖外部修改，保存当前编辑器内容为冲突副本。
- UI 提示用户对比合并。

### 9.5 重命名笔记

```text
前端请求 rename_note(note_id, new_title)
  -> 查询当前 path
  -> 生成新文件名
  -> 检查目标路径是否存在
  -> 移动文件
  -> 更新 Front Matter title
  -> 更新 notes.path/title
  -> 重新解析链接
  -> 推送目录树刷新
```

重命名不改变 note_id。引用当前笔记的 Wiki 链接不自动重写，因链接解析可通过 ID、别名或标题处理；若用户希望保持文本一致，可提供“批量更新引用”功能作为后续能力。

### 9.6 删除笔记

首版采用软删除：

```text
用户删除笔记
  -> 移动 Markdown 到 .mynote/trash/YYYY-MM-DD/
  -> notes.deleted_at 写入时间
  -> 从默认目录树隐藏
  -> 保留 revisions 和关系
```

恢复时将文件移回原路径；若原路径已被占用，则追加后缀。

### 9.7 外部变更处理

```text
文件监听事件
  -> 写入 file_events
  -> 防抖合并同一路径事件
  -> 判断文件类型
  -> Markdown 文件进入索引队列
  -> 附件文件更新资源索引
  -> config 文件触发设置刷新
  -> SQLite 冲突副本触发重建提示
```

防抖建议：

- 单文件事件延迟 500ms。
- 云盘批量同步时聚合 2-5 秒。
- 大量事件超过阈值时提示用户正在批量同步，并延迟重建索引。

### 9.8 索引重建

```text
用户触发 rebuild_index
  -> 备份当前 index.sqlite
  -> 创建临时数据库 index.rebuild.sqlite
  -> 执行 schema 迁移
  -> 扫描 notes/**/*.md
  -> 逐个解析并写入临时数据库
  -> 尝试迁移旧库中的 relations/revisions/settings
  -> 校验记录数量
  -> 原子替换 index.sqlite
  -> 重启数据库连接
  -> 推送完成事件
```

这样避免重建中途失败导致原数据库不可用。

## 10. 知识图谱详细设计

### 10.1 节点类型

| 类型 | 来源 | 说明 |
| --- | --- | --- |
| note | notes 表 | 笔记节点 |
| tag | tags 表 | 标签节点，可选显示 |
| unresolved | links 表 | 未解析链接节点 |

### 10.2 边类型

| 类型 | 来源 | 说明 |
| --- | --- | --- |
| link | links | 当前笔记指向其他笔记 |
| backlink | links | 其他笔记指向当前笔记 |
| manual_relation | relations | 用户手动关系 |
| tag_cooccurrence | note_tags | 标签共现关系 |
| directory | notes.path | 同目录关系 |

### 10.3 局部图谱查询

默认查询当前笔记一跳节点：

1. 当前笔记出链。
2. 当前笔记反链。
3. 当前笔记手动关系。
4. 当前笔记标签。

用户可切换到两跳。两跳查询需要限制最大节点数，默认不超过 80 个节点，避免图谱难以阅读。

### 10.4 图谱权重

节点权重：

- 反向链接数量越多权重越高。
- 手动关系数量越多权重越高。
- 最近访问或最近编辑可轻微加权。

边权重：

- 手动关系权重高于自动链接。
- 多次链接可合并加权。
- 标签共现权重最低。

## 11. 修订记录详细设计

### 11.1 修订触发条件

创建修订记录的条件：

- 内容哈希变化。
- 距离上次修订超过配置时间。
- 用户手动创建版本。
- 外部同步修改。
- 恢复历史版本。

默认策略：

- 每次保存记录修订元数据。
- 快照最多每 10 分钟保存一次。
- 用户手动版本一定保存快照。

### 11.2 快照路径

```text
.mynote/backups/revisions/
  2026/
    05/
      note-id/
        20260529T164000_hash.md
```

### 11.3 差异展示

首版使用行级 diff：

- 左侧历史版本。
- 右侧当前版本。
- 高亮新增、删除、修改行。

后续可增强为 Markdown 语义 diff。

### 11.4 恢复历史版本

恢复不是简单覆盖，而是一次新的保存：

1. 读取历史快照。
2. 当前内容先创建修订。
3. 将历史内容写入当前 Markdown 文件。
4. 更新索引。
5. 创建 `change_source = restore` 的修订记录。

## 12. 搜索详细设计

### 12.1 搜索入口

- 顶部全局搜索。
- 文件树过滤搜索。
- 标签搜索。
- 当前文档内搜索。

### 12.2 搜索过滤条件

```text
SearchFilters {
  tags?: string[]
  path_prefix?: string
  updated_after?: datetime
  updated_before?: datetime
  has_unresolved_links?: boolean
  relation_type?: string
}
```

### 12.3 搜索结果排序

排序权重：

1. 标题完全匹配。
2. 标题前缀匹配。
3. 标签匹配。
4. 总结命中。
5. 正文命中。
6. 最近修改时间。

## 13. 同步与冲突详细设计

### 13.1 同步边界

应用不直接调用百度云盘 API。用户通过云盘客户端同步知识库文件夹。应用需要适配同步后的本地文件变化，而不是负责网络传输。

### 13.2 冲突识别

常见云盘冲突文件名：

```text
note (冲突副本).md
note (conflicted copy).md
index (冲突副本).sqlite
```

识别后处理：

- Markdown 冲突副本作为独立笔记导入，并标记为冲突。
- SQLite 冲突副本不直接使用，提示用户重建索引。
- config 冲突副本保留，提示用户选择版本。

### 13.3 保存冲突

如果用户正在编辑时外部同步修改了同一文件：

1. 后端检测到 `expected_hash` 不一致。
2. 当前编辑器内容写入 `原文件名.local-conflict.md`。
3. 原文件保留外部版本。
4. UI 打开冲突解决视图。

### 13.4 数据库冲突恢复

当检测到数据库异常或冲突副本：

1. 停止写入当前数据库。
2. 备份现有数据库。
3. 提示用户以 Markdown 文件重建索引。
4. 尝试从备份数据库迁移 `relations`、`revisions`、`settings`。
5. 迁移失败时保留备份并提示不可恢复的数据类型。

## 14. 设置详细设计

### 14.1 应用级设置

```json
{
  "theme": "system",
  "language": "zh-CN",
  "fontFamily": "system",
  "fontSize": 15,
  "recentKnowledgeBases": [],
  "shortcutProfile": "default"
}
```

### 14.2 知识库级设置

```json
{
  "notesDir": "notes",
  "assetsDir": "assets",
  "autoSaveDelayMs": 800,
  "revisionSnapshotIntervalMinutes": 10,
  "maxRevisionStorageMb": 1024,
  "defaultGraphDepth": 1,
  "maxGraphNodes": 80,
  "syncMode": "folder",
  "indexOnStartup": "incremental"
}
```

### 14.3 设置写入规则

- 应用级设置存储在用户配置目录。
- 知识库级设置存储在 `.mynote/config.json`，并同步一份到 SQLite 便于查询。
- 设置写入使用临时文件原子替换。

## 15. 安全与可靠性设计

### 15.1 文件写入

所有 Markdown 保存采用：

1. 写入同目录临时文件。
2. flush/fsync。
3. 原子 rename 替换原文件。
4. 再更新数据库索引。

### 15.2 数据库备份

触发条件：

- 应用升级前。
- schema 迁移前。
- 用户手动重建索引前。
- 每日首次打开知识库。

### 15.3 日志

日志记录：

- 数据库迁移。
- 文件监听错误。
- 索引失败。
- 保存失败。
- 冲突检测。
- 修订恢复。

日志不记录完整笔记正文，避免泄露用户隐私。

## 16. 性能设计

### 16.1 启动性能

打开知识库时避免全量解析：

- 先从 SQLite 读取目录树。
- 后台扫描文件 mtime/hash。
- 发现变化再增量索引。

### 16.2 编辑性能

- 自动保存防抖。
- Markdown 预览防抖。
- 大文档预览使用增量渲染或延迟渲染。
- 索引解析放到后端异步队列。

### 16.3 图谱性能

- 默认局部图谱。
- 限制最大节点数。
- 缓存当前笔记一跳关系。
- 全库图谱异步加载。

### 16.4 大库目标

首版性能目标：

| 指标 | 目标 |
| --- | --- |
| 1,000 篇笔记启动 | 3 秒内显示目录树 |
| 10,000 篇笔记启动 | 8 秒内显示目录树 |
| 单篇保存 | 500ms 内完成文件写入 |
| 搜索响应 | 300ms 内返回首屏 |
| 局部图谱 | 1 秒内渲染 80 节点以内 |

## 17. 测试详细设计

### 17.1 单元测试

| 模块 | 测试点 |
| --- | --- |
| front_matter | 缺失字段、非法 YAML、字段补齐 |
| markdown | 标题、标签、链接、正文提取 |
| path | 中文路径、空格路径、跨平台分隔符 |
| hash | 相同内容 hash 一致，不同内容 hash 不同 |
| link | 标题匹配、路径匹配、别名匹配、未解析 |
| graph | 一跳、两跳、过滤、节点上限 |

### 17.2 集成测试

- 创建知识库。
- 打开已有知识库。
- 创建笔记并保存。
- 外部新增 Markdown 后自动索引。
- 重命名文件后保留 note_id。
- 删除和恢复笔记。
- 搜索标题、正文、标签、总结。
- 创建手动关系并出现在图谱中。
- 修订快照创建和恢复。
- 重建索引后笔记数量一致。

### 17.3 桌面端测试

- macOS、Windows、Linux 打包安装。
- 文件拖拽。
- 粘贴图片。
- 快捷键。
- 高 DPI 显示。
- 深浅色主题。

### 17.4 同步场景测试

- 云盘同步新增文件。
- 云盘同步修改文件。
- 同一文件产生冲突副本。
- 数据库产生冲突副本。
- 大量文件一次性同步。

## 18. 实施拆分

### 18.1 第一个可运行版本

目标是完成最小闭环：

1. 创建或打开知识库。
2. 展示目录树。
3. 创建 Markdown 笔记。
4. 编辑和实时预览。
5. 保存到文件。
6. 写入 SQLite notes 表。
7. 关闭后重新打开仍能读取。

### 18.2 第二个版本

加入知识组织能力：

1. Front Matter 解析。
2. 标签提取。
3. Wiki 链接解析。
4. 出链和反链。
5. FTS5 搜索。
6. 外部文件增量索引。

### 18.3 第三个版本

加入长期维护能力：

1. 总结陈词编辑。
2. 修订记录。
3. 快照和恢复。
4. 手动关系。
5. 局部知识图谱。

### 18.4 第四个版本

加入同步适配和稳定性：

1. 文件监听防抖。
2. 冲突检测。
3. 索引重建。
4. 数据库备份。
5. 跨平台打包。

## 19. 开发顺序建议

建议按以下顺序实现，避免过早进入复杂 UI：

1. 定义知识库目录结构和 SQLite schema。
2. 实现 Rust 文件读写和数据库访问。
3. 实现最小 Tauri command。
4. 实现前端三栏布局。
5. 集成 Markdown 编辑器和预览。
6. 实现保存、自动保存和打开笔记。
7. 实现索引解析。
8. 实现搜索、标签和双链。
9. 实现修订和图谱。
10. 实现同步冲突处理和重建索引。

## 20. 未进入首版的能力

以下能力不建议进入首版：

- 移动端应用。
- 多人协作。
- 直接调用百度云盘 API。
- 插件系统。
- AI 自动摘要。
- 全库复杂图谱分析。
- 完整 Typora 级所见即所得编辑。

这些能力应在基础数据模型稳定后逐步加入。

## 21. 详细设计结论

本详细设计将系统拆分为前端 UI、Tauri command、本地服务、领域模型、SQLite、文件系统和同步适配七个主要部分。核心实现策略是：Markdown 文件保存知识本体，SQLite 提供可重建索引与增强数据，Rust 后端负责可靠的本地能力，前端提供简洁编辑和知识关系展示。

首个工程目标应是完成“创建知识库 -> 创建笔记 -> 编辑预览 -> 保存文件 -> 写入索引 -> 重新打开”的最小闭环。随后再逐步加入标签、双链、全文搜索、总结、修订、图谱和同步冲突处理。

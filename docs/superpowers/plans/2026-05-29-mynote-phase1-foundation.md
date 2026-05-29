# MyNote Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成"创建知识库 → 创建笔记 → 编辑 → 保存到文件 → 写入 SQLite → 重新打开仍可读"的最小工作闭环。

**Architecture:** Tauri 2.x 桌面容器，Rust 后端负责文件系统、SQLite 和所有本地能力，React + TypeScript 前端负责三栏 UI、CodeMirror 6 编辑器和 Markdown 实时预览。前端只通过 Tauri `invoke` 与后端通信，不直接访问文件系统或数据库。

**Tech Stack:** Rust 1.78+, Tauri 2.x, React 18, TypeScript 5, Vite 5, CodeMirror 6, markdown-it 14, rusqlite 0.31 (bundled), serde + serde_json + serde_yaml, ulid, sha2, chrono, anyhow, thiserror

---

## 阶段说明

本计划是四阶段系列的第一阶段，实现最小可用内核：

| 阶段 | 内容 |
| --- | --- |
| **Phase 1（本计划）** | 环境、项目脚手架、SQLite、知识库 CRUD、笔记 CRUD、三栏 UI、编辑器、预览、自动保存 |
| Phase 2 | 标签、Wiki 双链、反链、FTS5 全文搜索、文件监听 |
| Phase 3 | 总结陈词、修订记录、快照恢复、手动关系、局部知识图谱 |
| Phase 4 | 云盘同步冲突检测、索引重建、跨平台打包、性能优化 |

---

## 文件结构

```text
mynote/                          ← 应用工程根目录（与 docs/ 同层）
  package.json
  pnpm-workspace.yaml
  vite.config.ts
  tsconfig.json
  index.html
  src/                           ← React 前端
    main.tsx
    App.tsx
    store/
      useAppStore.ts             ← Zustand 全局状态
      useEditorStore.ts          ← 编辑器状态（当前文件、dirty、内容）
    components/
      AppShell.tsx               ← 主布局三栏
      AppHeader.tsx              ← 顶栏
      StatusBar.tsx              ← 底栏
      LeftSidebar/
        LeftSidebar.tsx
        FileTreePanel.tsx
        FileTreeNode.tsx
      EditorWorkspace/
        EditorWorkspace.tsx
        MarkdownEditor.tsx       ← CodeMirror 6
        MarkdownPreview.tsx      ← markdown-it 渲染
      RightSidebar/
        RightSidebar.tsx
    hooks/
      useAutoSave.ts
      useKnowledgeBase.ts
    api/
      commands.ts                ← 所有 Tauri invoke 调用的类型安全封装
    types/
      index.ts                   ← 与 Rust 对应的 TypeScript 类型
    styles/
      global.css
      layout.css
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs
      lib.rs
      commands/
        mod.rs
        knowledge_base.rs        ← create_knowledge_base, open_knowledge_base, get_recent_kbs
        note.rs                  ← create_note, get_note, list_notes, save_note, delete_note
      services/
        mod.rs
        knowledge_base_service.rs
        note_service.rs
        index_service.rs
      domain/
        mod.rs
        note.rs                  ← Note, NoteDetail, SaveNoteResult 结构体
        knowledge_base.rs        ← KnowledgeBase 结构体
      infrastructure/
        mod.rs
        db.rs                    ← SQLite 连接、迁移
        fs.rs                    ← 原子写入、路径工具
        markdown.rs              ← Front Matter 解析、正文提取
        hash.rs                  ← SHA-256 哈希
      error.rs                   ← AppError 类型
      state.rs                   ← Tauri 托管的 AppState
```

---

## Task 1: 环境搭建

**Files:** 无代码文件，只安装工具链

- [ ] **Step 1: 安装 Rust**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version   # 期望: rustc 1.78.x 或更新
```

- [ ] **Step 2: 安装 Tauri CLI v2 前置系统依赖（macOS）**

```bash
# macOS 无需额外系统包，确认 Xcode CLI 工具已安装
xcode-select --install 2>/dev/null || echo "already installed"
```

- [ ] **Step 3: 安装 pnpm**

```bash
npm install -g pnpm
pnpm --version   # 期望: 9.x
```

- [ ] **Step 4: 安装 Tauri CLI**

```bash
cargo install tauri-cli --version "^2" --locked
cargo tauri --version   # 期望: tauri-cli 2.x.x
```

- [ ] **Step 5: 确认环境**

```bash
node --version    # 22.x
npm --version     # 10.x
rustc --version   # 1.78+
cargo --version   # 1.78+
pnpm --version    # 9.x
cargo tauri --version  # 2.x
```

---

## Task 2: 初始化 Tauri 项目

**Files:**
- Create: `package.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`

- [ ] **Step 1: 在 mynote 目录初始化 Tauri + React 项目**

```bash
cd /Users/lijun/mynote
pnpm create tauri-app@latest . --template react-ts --manager pnpm --yes
```

若交互式提示：
- Project name: `mynote`
- Frontend: `React`
- Language: `TypeScript`

- [ ] **Step 2: 安装前端依赖**

```bash
cd /Users/lijun/mynote
pnpm install
```

- [ ] **Step 3: 安装 CodeMirror 6 和 Markdown 预览库**

```bash
pnpm add @codemirror/state @codemirror/view @codemirror/lang-markdown @codemirror/language @codemirror/commands @codemirror/theme-one-dark codemirror markdown-it @types/markdown-it
```

- [ ] **Step 4: 安装状态管理库**

```bash
pnpm add zustand immer
```

- [ ] **Step 5: 添加 Rust 后端依赖**

打开 `src-tauri/Cargo.toml`，在 `[dependencies]` 中添加：

```toml
[dependencies]
tauri = { version = "2", features = ["dialog"] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
rusqlite = { version = "0.31", features = ["bundled"] }
ulid = "1"
sha2 = "0.10"
hex = "0.4"
chrono = { version = "0.4", features = ["serde"] }
anyhow = "1"
thiserror = "1"
tokio = { version = "1", features = ["full"] }
once_cell = "1"
```

- [ ] **Step 6: 验证能够编译启动**

```bash
cd /Users/lijun/mynote
cargo tauri dev
```

期望：应用窗口弹出，显示默认 Vite + React 欢迎页。关闭窗口后继续下一步。

- [ ] **Step 7: 提交初始框架**

```bash
cd /Users/lijun/mynote
git init
git add .
git commit -m "chore: initialize Tauri 2 + React TS project"
```

---

## Task 3: Rust 基础设施 — 错误类型、路径工具、哈希

**Files:**
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/src/infrastructure/mod.rs`
- Create: `src-tauri/src/infrastructure/hash.rs`
- Create: `src-tauri/src/infrastructure/fs.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建 error.rs**

```rust
// src-tauri/src/error.rs
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("Database error: {0}")]
    Database(String),
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Already exists: {0}")]
    AlreadyExists(String),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Conflict: {0}")]
    Conflict(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

- [ ] **Step 2: 创建 infrastructure/hash.rs**

```rust
// src-tauri/src/infrastructure/hash.rs
use sha2::{Digest, Sha256};

pub fn sha256_str(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_content_produces_same_hash() {
        let a = sha256_str("hello world");
        let b = sha256_str("hello world");
        assert_eq!(a, b);
    }

    #[test]
    fn different_content_produces_different_hash() {
        let a = sha256_str("hello");
        let b = sha256_str("world");
        assert_ne!(a, b);
    }
}
```

- [ ] **Step 3: 运行哈希测试（先验证失败再运行）**

```bash
cd /Users/lijun/mynote/src-tauri
cargo test hash -- --nocapture
```

期望：2 tests passed。

- [ ] **Step 4: 创建 infrastructure/fs.rs**

```rust
// src-tauri/src/infrastructure/fs.rs
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// 原子写入：先写临时文件，再 rename 替换
pub fn atomic_write(path: &Path, content: &str) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("No parent dir for {:?}", path)))?;
    std::fs::create_dir_all(parent)?;
    let tmp_path = path.with_extension("tmp");
    std::fs::write(&tmp_path, content)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

/// 归一化路径：分隔符统一为 /，返回相对根目录的路径字符串
pub fn normalize_relative(root: &Path, abs_path: &Path) -> AppResult<String> {
    let rel = abs_path
        .strip_prefix(root)
        .map_err(|_| AppError::InvalidInput(format!("{:?} not under root {:?}", abs_path, root)))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// 安全文件名：移除路径中非法字符
pub fn safe_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// 从根目录和相对路径构造绝对路径
pub fn abs_path(root: &Path, relative: &str) -> PathBuf {
    root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_safe_filename() {
        assert_eq!(safe_filename("hello/world"), "hello-world");
        assert_eq!(safe_filename("my note"), "my note");
        assert_eq!(safe_filename("标题"), "标题");
    }

    #[test]
    fn test_atomic_write_creates_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        atomic_write(&path, "hello").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn test_normalize_relative() {
        let root = Path::new("/home/user/kb");
        let abs = Path::new("/home/user/kb/notes/a.md");
        assert_eq!(normalize_relative(root, abs).unwrap(), "notes/a.md");
    }
}
```

- [ ] **Step 5: 添加 tempfile dev 依赖并运行 fs 测试**

在 `src-tauri/Cargo.toml` `[dev-dependencies]` 中添加：

```toml
[dev-dependencies]
tempfile = "3"
```

```bash
cd /Users/lijun/mynote/src-tauri
cargo test fs -- --nocapture
```

期望：3 tests passed。

- [ ] **Step 6: 创建 infrastructure/mod.rs**

```rust
// src-tauri/src/infrastructure/mod.rs
pub mod db;
pub mod fs;
pub mod hash;
pub mod markdown;
```

（`db.rs` 和 `markdown.rs` 在后续任务中创建，此时先留空占位）

- [ ] **Step 7: 更新 lib.rs 声明模块**

```rust
// src-tauri/src/lib.rs
pub mod commands;
pub mod domain;
pub mod error;
pub mod infrastructure;
pub mod services;
pub mod state;
```

- [ ] **Step 8: 创建其余 mod.rs 空文件**

```bash
mkdir -p src-tauri/src/commands src-tauri/src/services src-tauri/src/domain
touch src-tauri/src/commands/mod.rs
touch src-tauri/src/services/mod.rs
touch src-tauri/src/domain/mod.rs
touch src-tauri/src/state.rs
touch src-tauri/src/infrastructure/db.rs
touch src-tauri/src/infrastructure/markdown.rs
```

- [ ] **Step 9: 验证编译通过**

```bash
cd /Users/lijun/mynote/src-tauri
cargo check
```

期望：无错误。

- [ ] **Step 10: 提交**

```bash
cd /Users/lijun/mynote
git add src-tauri/
git commit -m "feat(infra): add AppError, atomic_write, hash, path utils"
```

---

## Task 4: Markdown 解析基础设施

**Files:**
- Modify: `src-tauri/src/infrastructure/markdown.rs`

- [ ] **Step 1: 写 markdown.rs**

```rust
// src-tauri/src/infrastructure/markdown.rs
use crate::error::{AppError, AppResult};

#[derive(Debug, Default, serde::Serialize, serde::Deserialize, Clone)]
pub struct FrontMatter {
    pub id: Option<String>,
    pub title: Option<String>,
    pub tags: Option<Vec<String>>,
    pub summary: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub aliases: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct ParsedNote {
    pub front_matter: FrontMatter,
    pub body: String,
    pub title: String,
    pub word_count: usize,
}

/// 分离 Front Matter 和正文
pub fn split_front_matter(content: &str) -> (Option<&str>, &str) {
    if !content.starts_with("---") {
        return (None, content);
    }
    let rest = &content[3..];
    if let Some(end_pos) = rest.find("\n---") {
        let fm = &rest[..end_pos];
        let body_start = end_pos + 4; // 跳过 \n---
        let body = rest.get(body_start..).unwrap_or("").trim_start_matches('\n');
        (Some(fm), body)
    } else {
        (None, content)
    }
}

/// 解析 Front Matter YAML
pub fn parse_front_matter(fm_str: &str) -> AppResult<FrontMatter> {
    serde_yaml::from_str(fm_str).map_err(|e| AppError::Parse(e.to_string()))
}

/// 从正文提取第一个一级标题
pub fn extract_h1(body: &str) -> Option<String> {
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

/// 统计字数（按空白分词，对中文按字符计）
pub fn count_words(text: &str) -> usize {
    let stripped = strip_markdown(text);
    // 英文按空格词，中文按字符，简单估算
    stripped.split_whitespace().count()
}

/// 去除 Markdown 标记，返回纯文本（用于索引）
pub fn strip_markdown(text: &str) -> String {
    let mut in_code_block = false;
    let mut result = String::new();
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            result.push_str(line);
            result.push('\n');
            continue;
        }
        // 移除标题标记
        let clean = line
            .trim_start_matches('#')
            .trim_start_matches('>')
            .trim_start_matches('-')
            .trim_start_matches('*')
            .trim();
        result.push_str(clean);
        result.push('\n');
    }
    result
}

/// 完整解析一篇笔记内容
pub fn parse_note(content: &str, filename_stem: &str) -> AppResult<ParsedNote> {
    let (fm_str, body) = split_front_matter(content);
    let front_matter = if let Some(fm) = fm_str {
        parse_front_matter(fm)?
    } else {
        FrontMatter::default()
    };

    // 标题优先级：front_matter.title > 正文 H1 > 文件名
    let title = front_matter
        .title
        .clone()
        .or_else(|| extract_h1(body))
        .unwrap_or_else(|| filename_stem.to_string());

    let word_count = count_words(body);

    Ok(ParsedNote {
        front_matter,
        body: body.to_string(),
        title,
        word_count,
    })
}

/// 将 Front Matter 序列化并与正文重新组合
pub fn render_note(fm: &FrontMatter, body: &str) -> AppResult<String> {
    let fm_str = serde_yaml::to_string(fm).map_err(|e| AppError::Parse(e.to_string()))?;
    Ok(format!("---\n{}---\n\n{}", fm_str, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_front_matter_with_fm() {
        let content = "---\ntitle: Test\n---\n\nHello";
        let (fm, body) = split_front_matter(content);
        assert!(fm.is_some());
        assert_eq!(body.trim(), "Hello");
    }

    #[test]
    fn test_split_front_matter_without_fm() {
        let content = "# Hello\nWorld";
        let (fm, body) = split_front_matter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn test_parse_front_matter_fields() {
        let fm_str = "title: My Note\ntags:\n  - rust\n  - tauri\n";
        let fm = parse_front_matter(fm_str).unwrap();
        assert_eq!(fm.title.unwrap(), "My Note");
        assert_eq!(fm.tags.unwrap(), vec!["rust", "tauri"]);
    }

    #[test]
    fn test_extract_h1() {
        assert_eq!(extract_h1("# Hello World\nsome text"), Some("Hello World".into()));
        assert_eq!(extract_h1("no heading"), None);
    }

    #[test]
    fn test_parse_note_title_from_h1() {
        let content = "# My Title\n\nSome content.";
        let note = parse_note(content, "filename").unwrap();
        assert_eq!(note.title, "My Title");
    }

    #[test]
    fn test_parse_note_title_from_filename() {
        let content = "Just some text without heading.";
        let note = parse_note(content, "my-file").unwrap();
        assert_eq!(note.title, "my-file");
    }

    #[test]
    fn test_render_and_parse_roundtrip() {
        let fm = FrontMatter {
            title: Some("Test".into()),
            tags: Some(vec!["tag1".into()]),
            ..Default::default()
        };
        let body = "Hello world";
        let rendered = render_note(&fm, body).unwrap();
        let parsed = parse_note(&rendered, "test").unwrap();
        assert_eq!(parsed.title, "Test");
        assert_eq!(parsed.front_matter.tags.unwrap(), vec!["tag1"]);
    }
}
```

- [ ] **Step 2: 运行 markdown 测试**

```bash
cd /Users/lijun/mynote/src-tauri
cargo test markdown -- --nocapture
```

期望：7 tests passed。

- [ ] **Step 3: 提交**

```bash
cd /Users/lijun/mynote
git add src-tauri/
git commit -m "feat(infra): markdown front matter parser with tests"
```

---

## Task 5: SQLite 数据库基础设施

**Files:**
- Modify: `src-tauri/src/infrastructure/db.rs`
- Create: `src-tauri/src/state.rs`

- [ ] **Step 1: 写 db.rs（连接与 schema 迁移）**

```rust
// src-tauri/src/infrastructure/db.rs
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use std::path::Path;

/// 打开 SQLite 数据库并执行所有 schema 迁移
pub fn open_and_migrate(db_path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(db_path).map_err(|e| AppError::Database(e.to_string()))?;
    // 启用 WAL 模式提升写入并发性能
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            applied_at TEXT    NOT NULL
        );",
    )?;

    let applied: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    )?;

    for (version, name, sql) in MIGRATIONS {
        if *version > applied {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, datetime('now'))",
                params![version, name],
            )?;
        }
    }
    Ok(())
}

const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "create_knowledge_base_meta",
        "CREATE TABLE IF NOT EXISTS knowledge_base_meta (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            root_path  TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    ),
    (
        2,
        "create_notes",
        "CREATE TABLE IF NOT EXISTS notes (
            id               TEXT PRIMARY KEY,
            path             TEXT NOT NULL UNIQUE,
            title            TEXT NOT NULL,
            summary          TEXT,
            content_hash     TEXT NOT NULL,
            word_count       INTEGER NOT NULL DEFAULT 0,
            front_matter_json TEXT NOT NULL DEFAULT '{}',
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL,
            indexed_at       TEXT NOT NULL,
            deleted_at       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);
        CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title);
        CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at);",
    ),
    (
        3,
        "create_settings",
        "CREATE TABLE IF NOT EXISTS settings (
            scope      TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (scope, key)
        );",
    ),
    (
        4,
        "create_note_fts",
        "CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
            note_id UNINDEXED,
            title,
            summary,
            body,
            tokenize = 'unicode61'
        );",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_open_and_migrate_creates_tables() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 4); // 4 migrations

        // 验证 notes 表存在
        conn.execute_batch("INSERT INTO notes (id,path,title,content_hash,word_count,front_matter_json,created_at,updated_at,indexed_at) VALUES ('x','a.md','T','h',0,'{}','2024','2024','2024')").unwrap();
    }

    #[test]
    fn test_migrations_are_idempotent() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("idem.sqlite");
        open_and_migrate(&db_path).unwrap();
        // 再次打开，不应失败
        open_and_migrate(&db_path).unwrap();
    }
}
```

- [ ] **Step 2: 运行 db 测试**

```bash
cd /Users/lijun/mynote/src-tauri
cargo test db -- --nocapture
```

期望：2 tests passed。

- [ ] **Step 3: 写 state.rs（Tauri 全局状态）**

```rust
// src-tauri/src/state.rs
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// Tauri 应用全局状态，通过 tauri::State 注入到所有 command
pub struct AppState {
    /// 当前打开的知识库根目录（可为空表示未打开）
    pub kb_root: Mutex<Option<PathBuf>>,
    /// SQLite 连接（可为空）
    pub db: Mutex<Option<Connection>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            kb_root: Mutex::new(None),
            db: Mutex::new(None),
        }
    }
}
```

- [ ] **Step 4: 提交**

```bash
cd /Users/lijun/mynote
git add src-tauri/
git commit -m "feat(infra): SQLite connection and schema migrations with tests"
```

---

## Task 6: 领域模型结构体

**Files:**
- Modify: `src-tauri/src/domain/mod.rs`
- Create: `src-tauri/src/domain/knowledge_base.rs`
- Create: `src-tauri/src/domain/note.rs`

- [ ] **Step 1: 创建 domain/knowledge_base.rs**

```rust
// src-tauri/src/domain/knowledge_base.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeBase {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub updated_at: String,
}
```

- [ ] **Step 2: 创建 domain/note.rs**

```rust
// src-tauri/src/domain/note.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub path: String,
    pub title: String,
    pub summary: Option<String>,
    pub content_hash: String,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub indexed_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDetail {
    pub note: Note,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteTreeNode {
    pub id: Option<String>,  // None for directory nodes
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<NoteTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveNoteResult {
    pub note: Note,
    pub conflict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub directory: String,  // relative path, e.g. "notes/work"
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveNoteInput {
    pub note_id: String,
    pub content: String,
    pub expected_hash: Option<String>,
}
```

- [ ] **Step 3: 更新 domain/mod.rs**

```rust
// src-tauri/src/domain/mod.rs
pub mod knowledge_base;
pub mod note;
```

- [ ] **Step 4: 验证编译**

```bash
cd /Users/lijun/mynote/src-tauri
cargo check
```

期望：无错误。

- [ ] **Step 5: 提交**

```bash
cd /Users/lijun/mynote
git add src-tauri/
git commit -m "feat(domain): KnowledgeBase, Note, NoteDetail domain structs"
```

---

## Task 7: KnowledgeBase 服务与 Tauri Command

**Files:**
- Create: `src-tauri/src/services/knowledge_base_service.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Create: `src-tauri/src/commands/knowledge_base.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`（注册 command）

- [ ] **Step 1: 写 knowledge_base_service.rs**

```rust
// src-tauri/src/services/knowledge_base_service.rs
use crate::{
    domain::knowledge_base::KnowledgeBase,
    error::{AppError, AppResult},
    infrastructure::{db, fs as appfs},
    state::AppState,
};
use rusqlite::params;
use std::path::{Path, PathBuf};
use ulid::Ulid;

pub fn create_knowledge_base(
    root: &Path,
    name: &str,
    state: &AppState,
) -> AppResult<KnowledgeBase> {
    // 检查是否已有知识库
    let mynote_dir = root.join(".mynote");
    if mynote_dir.exists() {
        return open_knowledge_base(root, state);
    }

    // 创建目录结构
    for subdir in &[
        root.join("notes"),
        root.join("assets").join("images"),
        root.join("assets").join("files"),
        mynote_dir.clone(),
        mynote_dir.join("backups").join("revisions"),
        mynote_dir.join("backups").join("database"),
        mynote_dir.join("logs"),
        mynote_dir.join("tmp"),
    ] {
        std::fs::create_dir_all(subdir)?;
    }

    let db_path = mynote_dir.join("index.sqlite");
    let conn = db::open_and_migrate(&db_path)?;

    let kb_id = Ulid::new().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let root_str = root.to_string_lossy().to_string();

    conn.execute(
        "INSERT INTO knowledge_base_meta (id, name, root_path, schema_version, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, ?4, ?5)",
        params![kb_id, name, root_str, now, now],
    )?;

    let kb = KnowledgeBase {
        id: kb_id,
        name: name.to_string(),
        root_path: root_str,
        created_at: now.clone(),
        updated_at: now,
    };

    // 存入 state
    *state.kb_root.lock().unwrap() = Some(root.to_path_buf());
    *state.db.lock().unwrap() = Some(conn);

    Ok(kb)
}

pub fn open_knowledge_base(root: &Path, state: &AppState) -> AppResult<KnowledgeBase> {
    let db_path = root.join(".mynote").join("index.sqlite");
    if !db_path.exists() {
        return Err(AppError::NotFound(format!(
            "No knowledge base found at {:?}",
            root
        )));
    }
    let conn = db::open_and_migrate(&db_path)?;
    let kb: KnowledgeBase = conn.query_row(
        "SELECT id, name, root_path, created_at, updated_at FROM knowledge_base_meta LIMIT 1",
        [],
        |r| {
            Ok(KnowledgeBase {
                id: r.get(0)?,
                name: r.get(1)?,
                root_path: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            })
        },
    )?;

    *state.kb_root.lock().unwrap() = Some(root.to_path_buf());
    *state.db.lock().unwrap() = Some(conn);

    Ok(kb)
}
```

- [ ] **Step 2: 写 commands/knowledge_base.rs**

```rust
// src-tauri/src/commands/knowledge_base.rs
use crate::{
    domain::knowledge_base::KnowledgeBase,
    error::AppError,
    services::knowledge_base_service,
    state::AppState,
};
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn create_knowledge_base(
    path: String,
    name: String,
    state: State<AppState>,
) -> Result<KnowledgeBase, AppError> {
    knowledge_base_service::create_knowledge_base(Path::new(&path), &name, &state)
}

#[tauri::command]
pub fn open_knowledge_base(
    path: String,
    state: State<AppState>,
) -> Result<KnowledgeBase, AppError> {
    knowledge_base_service::open_knowledge_base(Path::new(&path), &state)
}

#[tauri::command]
pub fn get_current_knowledge_base(state: State<AppState>) -> Result<Option<KnowledgeBase>, AppError> {
    let db_guard = state.db.lock().unwrap();
    if let Some(conn) = db_guard.as_ref() {
        let kb = conn.query_row(
            "SELECT id, name, root_path, created_at, updated_at FROM knowledge_base_meta LIMIT 1",
            [],
            |r| {
                Ok(KnowledgeBase {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    root_path: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            },
        )?;
        Ok(Some(kb))
    } else {
        Ok(None)
    }
}
```

- [ ] **Step 3: 更新 services/mod.rs 和 commands/mod.rs**

```rust
// src-tauri/src/services/mod.rs
pub mod knowledge_base_service;
pub mod note_service;
pub mod index_service;
```

```rust
// src-tauri/src/commands/mod.rs
pub mod knowledge_base;
pub mod note;
```

（`note_service.rs`、`index_service.rs`、`commands/note.rs` 在下一 task 中添加，先用空文件占位）

```bash
touch src-tauri/src/services/note_service.rs
touch src-tauri/src/services/index_service.rs
touch src-tauri/src/commands/note.rs
```

- [ ] **Step 4: 注册 command 到 lib.rs**

```rust
// src-tauri/src/lib.rs — 完整内容替换
pub mod commands;
pub mod domain;
pub mod error;
pub mod infrastructure;
pub mod services;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::knowledge_base::create_knowledge_base,
            commands::knowledge_base::open_knowledge_base,
            commands::knowledge_base::get_current_knowledge_base,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: 验证编译**

```bash
cd /Users/lijun/mynote/src-tauri
cargo check
```

期望：无错误。

- [ ] **Step 6: 提交**

```bash
cd /Users/lijun/mynote
git add src-tauri/
git commit -m "feat(kb): create/open knowledge base Tauri commands"
```

---

## Task 8: Note 服务与 Tauri Command

**Files:**
- Modify: `src-tauri/src/services/note_service.rs`
- Modify: `src-tauri/src/services/index_service.rs`
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 写 index_service.rs（索引笔记到数据库）**

```rust
// src-tauri/src/services/index_service.rs
use crate::{
    domain::note::Note,
    error::AppResult,
    infrastructure::{hash, markdown},
};
use rusqlite::{params, Connection};
use std::path::Path;

/// 解析一个 .md 文件并写入/更新 notes 表和 note_fts
pub fn index_note_file(conn: &Connection, root: &Path, abs_path: &Path) -> AppResult<Note> {
    let content = std::fs::read_to_string(abs_path)?;
    let filename_stem = abs_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let parsed = markdown::parse_note(&content, &filename_stem)?;

    let rel_path = crate::infrastructure::fs::normalize_relative(root, abs_path)?;
    let content_hash = hash::sha256_str(&content);
    let now = chrono::Utc::now().to_rfc3339();
    let summary = parsed.front_matter.summary.clone();
    let fm_json = serde_json::to_string(&parsed.front_matter)
        .unwrap_or_else(|_| "{}".to_string());

    // 已存在则更新，不存在则插入
    let note_id: Option<String> = {
        let mut stmt = conn.prepare("SELECT id FROM notes WHERE path = ?1")?;
        stmt.query_row(params![rel_path], |r| r.get(0)).ok()
    };

    let (note_id, created_at) = if let Some(id) = note_id {
        let existing_created: String = conn.query_row(
            "SELECT created_at FROM notes WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        conn.execute(
            "UPDATE notes SET title=?1, summary=?2, content_hash=?3, word_count=?4,
             front_matter_json=?5, updated_at=?6, indexed_at=?7 WHERE id=?8",
            params![
                parsed.title,
                summary,
                content_hash,
                parsed.word_count as i64,
                fm_json,
                now,
                now,
                id
            ],
        )?;
        // 更新 FTS
        conn.execute("DELETE FROM note_fts WHERE note_id = ?1", params![id])?;
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, ?4)",
            params![
                id,
                parsed.title,
                summary.as_deref().unwrap_or(""),
                crate::infrastructure::markdown::strip_markdown(&parsed.body)
            ],
        )?;
        (id, existing_created)
    } else {
        // 新笔记：从 Front Matter 获取 id 或生成新 id
        let new_id = parsed
            .front_matter
            .id
            .clone()
            .unwrap_or_else(|| ulid::Ulid::new().to_string());
        let created_at = parsed
            .front_matter
            .created_at
            .clone()
            .unwrap_or_else(|| now.clone());
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count,
             front_matter_json, created_at, updated_at, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                new_id,
                rel_path,
                parsed.title,
                summary,
                content_hash,
                parsed.word_count as i64,
                fm_json,
                created_at,
                now,
                now
            ],
        )?;
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, ?4)",
            params![
                new_id,
                parsed.title,
                summary.as_deref().unwrap_or(""),
                crate::infrastructure::markdown::strip_markdown(&parsed.body)
            ],
        )?;
        (new_id, created_at)
    };

    Ok(Note {
        id: note_id,
        path: rel_path,
        title: parsed.title,
        summary,
        content_hash,
        word_count: parsed.word_count as i64,
        created_at,
        updated_at: now.clone(),
        indexed_at: now,
        deleted_at: None,
    })
}
```

- [ ] **Step 2: 写 note_service.rs**

```rust
// src-tauri/src/services/note_service.rs
use crate::{
    domain::note::{CreateNoteInput, Note, NoteDetail, NoteTreeNode, SaveNoteInput, SaveNoteResult},
    error::{AppError, AppResult},
    infrastructure::{fs as appfs, hash, markdown},
    services::index_service,
    state::AppState,
};
use rusqlite::params;
use std::path::PathBuf;
use ulid::Ulid;

fn require_kb(state: &AppState) -> AppResult<PathBuf> {
    state
        .kb_root
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))
}

pub fn create_note(input: CreateNoteInput, state: &AppState) -> AppResult<NoteDetail> {
    let root = require_kb(state)?;
    let safe_name = appfs::safe_filename(&input.title);
    let dir = root.join(&input.directory.replace('/', std::path::MAIN_SEPARATOR_STR));
    std::fs::create_dir_all(&dir)?;

    // 如果同名文件已存在，追加序号
    let mut filename = format!("{}.md", safe_name);
    let mut counter = 1;
    while dir.join(&filename).exists() {
        filename = format!("{}-{}.md", safe_name, counter);
        counter += 1;
    }
    let abs_path = dir.join(&filename);

    let note_id = Ulid::new().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let fm = markdown::FrontMatter {
        id: Some(note_id.clone()),
        title: Some(input.title.clone()),
        created_at: Some(now.clone()),
        updated_at: Some(now.clone()),
        ..Default::default()
    };
    let content = markdown::render_note(&fm, &format!("# {}\n\n", input.title))?;
    appfs::atomic_write(&abs_path, &content)?;

    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database connection".into()))?;
    let note = index_service::index_note_file(conn, &root, &abs_path)?;
    Ok(NoteDetail { note, content })
}

pub fn get_note(note_id: &str, state: &AppState) -> AppResult<NoteDetail> {
    let root = require_kb(state)?;
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database connection".into()))?;

    let (path, _, _): (String, String, String) = conn
        .query_row(
            "SELECT path, title, content_hash FROM notes WHERE id = ?1 AND deleted_at IS NULL",
            params![note_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| AppError::NotFound(format!("Note {} not found", note_id)))?;

    let abs_path = appfs::abs_path(&root, &path);
    let content = std::fs::read_to_string(&abs_path)
        .map_err(|e| AppError::Io(format!("Cannot read {:?}: {}", abs_path, e)))?;

    let note: Note = conn.query_row(
        "SELECT id, path, title, summary, content_hash, word_count,
                created_at, updated_at, indexed_at, deleted_at
         FROM notes WHERE id = ?1",
        params![note_id],
        |r| {
            Ok(Note {
                id: r.get(0)?,
                path: r.get(1)?,
                title: r.get(2)?,
                summary: r.get(3)?,
                content_hash: r.get(4)?,
                word_count: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                indexed_at: r.get(8)?,
                deleted_at: r.get(9)?,
            })
        },
    )?;

    Ok(NoteDetail { note, content })
}

pub fn save_note(input: SaveNoteInput, state: &AppState) -> AppResult<SaveNoteResult> {
    let root = require_kb(state)?;
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database connection".into()))?;

    let (path, db_hash): (String, String) = conn
        .query_row(
            "SELECT path, content_hash FROM notes WHERE id = ?1 AND deleted_at IS NULL",
            params![input.note_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| AppError::NotFound(format!("Note {} not found", input.note_id)))?;

    // 冲突检测：前端传来的期望 hash 不匹配时，说明文件在编辑中被外部修改
    let conflict = if let Some(expected) = &input.expected_hash {
        expected != &db_hash
    } else {
        false
    };

    let abs_path = appfs::abs_path(&root, &path);

    if conflict {
        // 保存为冲突副本，不覆盖原文件
        let conflict_path = abs_path.with_extension("local-conflict.md");
        appfs::atomic_write(&conflict_path, &input.content)?;
        let note = get_note_record(conn, &input.note_id)?;
        return Ok(SaveNoteResult { note, conflict: true });
    }

    appfs::atomic_write(&abs_path, &input.content)?;
    let note = index_service::index_note_file(conn, &root, &abs_path)?;
    Ok(SaveNoteResult { note, conflict: false })
}

pub fn list_notes(state: &AppState) -> AppResult<Vec<NoteTreeNode>> {
    let root = require_kb(state)?;
    let notes_dir = root.join("notes");
    build_tree(&notes_dir, &root)
}

pub fn delete_note(note_id: &str, state: &AppState) -> AppResult<()> {
    let root = require_kb(state)?;
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database connection".into()))?;

    let path: String = conn.query_row(
        "SELECT path FROM notes WHERE id = ?1 AND deleted_at IS NULL",
        params![note_id],
        |r| r.get(0),
    ).map_err(|_| AppError::NotFound(format!("Note {} not found", note_id)))?;

    let abs_path = appfs::abs_path(&root, &path);
    let trash_dir = root.join(".mynote").join("trash")
        .join(chrono::Utc::now().format("%Y-%m-%d").to_string());
    std::fs::create_dir_all(&trash_dir)?;
    let trash_path = trash_dir.join(abs_path.file_name().unwrap_or_default());
    std::fs::rename(&abs_path, &trash_path)?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE notes SET deleted_at = ?1 WHERE id = ?2",
        params![now, note_id],
    )?;
    conn.execute("DELETE FROM note_fts WHERE note_id = ?1", params![note_id])?;
    Ok(())
}

fn get_note_record(conn: &rusqlite::Connection, note_id: &str) -> AppResult<Note> {
    conn.query_row(
        "SELECT id, path, title, summary, content_hash, word_count,
                created_at, updated_at, indexed_at, deleted_at
         FROM notes WHERE id = ?1",
        params![note_id],
        |r| {
            Ok(Note {
                id: r.get(0)?,
                path: r.get(1)?,
                title: r.get(2)?,
                summary: r.get(3)?,
                content_hash: r.get(4)?,
                word_count: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                indexed_at: r.get(8)?,
                deleted_at: r.get(9)?,
            })
        },
    ).map_err(|e| AppError::Database(e.to_string()))
}

fn build_tree(dir: &std::path::Path, root: &std::path::Path) -> AppResult<Vec<NoteTreeNode>> {
    let mut nodes = Vec::new();
    if !dir.exists() {
        return Ok(nodes);
    }
    let mut entries: Vec<_> = std::fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| {
        let is_file = e.file_type().map(|t| t.is_file()).unwrap_or(false);
        (if is_file { 1 } else { 0 }, e.file_name())
    });

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel_path = appfs::normalize_relative(root, &path).unwrap_or_default();

        if path.is_dir() {
            let children = build_tree(&path, root)?;
            nodes.push(NoteTreeNode {
                id: None,
                name,
                path: rel_path,
                is_dir: true,
                children,
            });
        } else if name.ends_with(".md") {
            nodes.push(NoteTreeNode {
                id: None, // 前端通过搜索 db 获取 note_id，这里简化
                name: name.trim_end_matches(".md").to_string(),
                path: rel_path,
                is_dir: false,
                children: vec![],
            });
        }
    }
    Ok(nodes)
}
```

- [ ] **Step 3: 写 commands/note.rs**

```rust
// src-tauri/src/commands/note.rs
use crate::{
    domain::note::{CreateNoteInput, NoteDetail, NoteTreeNode, SaveNoteInput, SaveNoteResult},
    error::AppError,
    services::note_service,
    state::AppState,
};
use tauri::State;

#[tauri::command]
pub fn create_note(input: CreateNoteInput, state: State<AppState>) -> Result<NoteDetail, AppError> {
    note_service::create_note(input, &state)
}

#[tauri::command]
pub fn get_note(note_id: String, state: State<AppState>) -> Result<NoteDetail, AppError> {
    note_service::get_note(&note_id, &state)
}

#[tauri::command]
pub fn save_note(input: SaveNoteInput, state: State<AppState>) -> Result<SaveNoteResult, AppError> {
    note_service::save_note(input, &state)
}

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> Result<Vec<NoteTreeNode>, AppError> {
    note_service::list_notes(&state)
}

#[tauri::command]
pub fn delete_note(note_id: String, state: State<AppState>) -> Result<(), AppError> {
    note_service::delete_note(&note_id, &state)
}
```

- [ ] **Step 4: 更新 lib.rs 注册所有 command**

```rust
// src-tauri/src/lib.rs
pub mod commands;
pub mod domain;
pub mod error;
pub mod infrastructure;
pub mod services;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::knowledge_base::create_knowledge_base,
            commands::knowledge_base::open_knowledge_base,
            commands::knowledge_base::get_current_knowledge_base,
            commands::note::create_note,
            commands::note::get_note,
            commands::note::save_note,
            commands::note::list_notes,
            commands::note::delete_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: 验证编译**

```bash
cd /Users/lijun/mynote/src-tauri
cargo check
```

期望：无错误。

- [ ] **Step 6: 提交**

```bash
cd /Users/lijun/mynote
git add src-tauri/
git commit -m "feat(note): note CRUD service and Tauri commands"
```

---

## Task 9: TypeScript 类型与 API 封装

**Files:**
- Create: `src/types/index.ts`
- Create: `src/api/commands.ts`

- [ ] **Step 1: 写 types/index.ts（与 Rust 结构体一一对应）**

```typescript
// src/types/index.ts

export interface KnowledgeBase {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  path: string;
  title: string;
  summary: string | null;
  content_hash: string;
  word_count: number;
  created_at: string;
  updated_at: string;
  indexed_at: string;
  deleted_at: string | null;
}

export interface NoteDetail {
  note: Note;
  content: string;
}

export interface NoteTreeNode {
  id: string | null;
  name: string;
  path: string;
  is_dir: boolean;
  children: NoteTreeNode[];
}

export interface SaveNoteResult {
  note: Note;
  conflict: boolean;
}

export interface CreateNoteInput {
  directory: string;
  title: string;
}

export interface SaveNoteInput {
  note_id: string;
  content: string;
  expected_hash?: string;
}
```

- [ ] **Step 2: 写 api/commands.ts（类型安全 invoke 封装）**

```typescript
// src/api/commands.ts
import { invoke } from "@tauri-apps/api/core";
import type {
  KnowledgeBase,
  NoteDetail,
  NoteTreeNode,
  SaveNoteResult,
  CreateNoteInput,
  SaveNoteInput,
} from "../types";

export const api = {
  createKnowledgeBase: (path: string, name: string) =>
    invoke<KnowledgeBase>("create_knowledge_base", { path, name }),

  openKnowledgeBase: (path: string) =>
    invoke<KnowledgeBase>("open_knowledge_base", { path }),

  getCurrentKnowledgeBase: () =>
    invoke<KnowledgeBase | null>("get_current_knowledge_base"),

  createNote: (input: CreateNoteInput) =>
    invoke<NoteDetail>("create_note", { input }),

  getNote: (noteId: string) =>
    invoke<NoteDetail>("get_note", { noteId }),

  saveNote: (input: SaveNoteInput) =>
    invoke<SaveNoteResult>("save_note", { input }),

  listNotes: () =>
    invoke<NoteTreeNode[]>("list_notes"),

  deleteNote: (noteId: string) =>
    invoke<void>("delete_note", { noteId }),
};
```

- [ ] **Step 3: 提交**

```bash
cd /Users/lijun/mynote
git add src/
git commit -m "feat(frontend): TypeScript types and API command wrappers"
```

---

## Task 10: 全局状态管理

**Files:**
- Create: `src/store/useAppStore.ts`
- Create: `src/store/useEditorStore.ts`

- [ ] **Step 1: 写 useAppStore.ts**

```typescript
// src/store/useAppStore.ts
import { create } from "zustand";
import type { KnowledgeBase, NoteTreeNode } from "../types";
import { api } from "../api/commands";

interface AppState {
  kb: KnowledgeBase | null;
  tree: NoteTreeNode[];
  selectedNodePath: string | null;
  loading: boolean;
  error: string | null;

  setKb: (kb: KnowledgeBase | null) => void;
  setTree: (tree: NoteTreeNode[]) => void;
  setSelectedNodePath: (path: string | null) => void;
  setError: (error: string | null) => void;
  refreshTree: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  kb: null,
  tree: [],
  selectedNodePath: null,
  loading: false,
  error: null,

  setKb: (kb) => set({ kb }),
  setTree: (tree) => set({ tree }),
  setSelectedNodePath: (path) => set({ selectedNodePath: path }),
  setError: (error) => set({ error }),

  refreshTree: async () => {
    try {
      const tree = await api.listNotes();
      set({ tree });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
```

- [ ] **Step 2: 写 useEditorStore.ts**

```typescript
// src/store/useEditorStore.ts
import { create } from "zustand";
import type { Note } from "../types";

interface EditorState {
  currentNote: Note | null;
  content: string;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveStatus: "saved" | "saving" | "unsaved" | "error";

  setCurrentNote: (note: Note | null) => void;
  setContent: (content: string) => void;
  markDirty: () => void;
  markSaved: (note: Note) => void;
  setSaving: (saving: boolean) => void;
  setSaveError: (error: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  currentNote: null,
  content: "",
  isDirty: false,
  isSaving: false,
  saveError: null,
  saveStatus: "saved",

  setCurrentNote: (note) =>
    set({ currentNote: note, isDirty: false, saveStatus: "saved", saveError: null }),
  setContent: (content) => set({ content }),
  markDirty: () => set({ isDirty: true, saveStatus: "unsaved" }),
  markSaved: (note) =>
    set({ currentNote: note, isDirty: false, saveStatus: "saved", saveError: null }),
  setSaving: (saving) => set({ isSaving: saving, saveStatus: saving ? "saving" : "saved" }),
  setSaveError: (error) => set({ saveError: error, saveStatus: "error" }),
}));
```

- [ ] **Step 3: 提交**

```bash
cd /Users/lijun/mynote
git add src/
git commit -m "feat(store): Zustand app and editor state stores"
```

---

## Task 11: 前端布局框架

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/AppShell.tsx`
- Create: `src/components/AppHeader.tsx`
- Create: `src/components/StatusBar.tsx`
- Create: `src/styles/global.css`
- Create: `src/styles/layout.css`

- [ ] **Step 1: 写 global.css**

```css
/* src/styles/global.css */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f6f8fa;
  --bg-sidebar: #f0f2f5;
  --border: #e0e2e7;
  --text-primary: #1a1a2e;
  --text-secondary: #6e7681;
  --accent: #0969da;
  --header-height: 44px;
  --statusbar-height: 28px;
  --sidebar-width: 240px;
  --right-sidebar-width: 260px;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", Menlo, monospace;
}

body {
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  height: 100vh;
  width: 100vw;
}
```

- [ ] **Step 2: 写 layout.css**

```css
/* src/styles/layout.css */
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
}

.app-header {
  height: var(--header-height);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 12px;
  flex-shrink: 0;
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.left-sidebar {
  width: var(--sidebar-width);
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  flex-shrink: 0;
}

.editor-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.right-sidebar {
  width: var(--right-sidebar-width);
  background: var(--bg-sidebar);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  flex-shrink: 0;
}

.status-bar {
  height: var(--statusbar-height);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
```

- [ ] **Step 3: 写 AppHeader.tsx**

```tsx
// src/components/AppHeader.tsx
import { useAppStore } from "../store/useAppStore";

export function AppHeader() {
  const kb = useAppStore((s) => s.kb);

  return (
    <header className="app-header">
      <span style={{ fontWeight: 600, fontSize: 14 }}>
        {kb ? kb.name : "MyNote"}
      </span>
    </header>
  );
}
```

- [ ] **Step 4: 写 StatusBar.tsx**

```tsx
// src/components/StatusBar.tsx
import { useEditorStore } from "../store/useEditorStore";

export function StatusBar() {
  const { currentNote, saveStatus, content } = useEditorStore();

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const statusLabel =
    saveStatus === "saving"
      ? "保存中…"
      : saveStatus === "error"
      ? "保存失败"
      : saveStatus === "unsaved"
      ? "未保存"
      : "已保存";

  return (
    <footer className="status-bar">
      {currentNote && (
        <>
          <span>{currentNote.path}</span>
          <span>{wordCount} 字</span>
          <span>{statusLabel}</span>
        </>
      )}
    </footer>
  );
}
```

- [ ] **Step 5: 写 AppShell.tsx**

```tsx
// src/components/AppShell.tsx
import { AppHeader } from "./AppHeader";
import { StatusBar } from "./StatusBar";
import { LeftSidebar } from "./LeftSidebar/LeftSidebar";
import { EditorWorkspace } from "./EditorWorkspace/EditorWorkspace";
import { RightSidebar } from "./RightSidebar/RightSidebar";
import "../styles/layout.css";

export function AppShell() {
  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-body">
        <aside className="left-sidebar">
          <LeftSidebar />
        </aside>
        <main className="editor-workspace">
          <EditorWorkspace />
        </main>
        <aside className="right-sidebar">
          <RightSidebar />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 6: 创建子组件占位文件**

```bash
mkdir -p src/components/LeftSidebar src/components/EditorWorkspace src/components/RightSidebar
```

```tsx
// src/components/LeftSidebar/LeftSidebar.tsx
export function LeftSidebar() {
  return <div style={{ padding: 12, fontSize: 13 }}>文件树（待实现）</div>;
}
```

```tsx
// src/components/EditorWorkspace/EditorWorkspace.tsx
export function EditorWorkspace() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#999" }}>
      请打开或新建一个笔记
    </div>
  );
}
```

```tsx
// src/components/RightSidebar/RightSidebar.tsx
export function RightSidebar() {
  return <div style={{ padding: 12, fontSize: 13 }}>大纲（待实现）</div>;
}
```

- [ ] **Step 7: 更新 App.tsx**

```tsx
// src/App.tsx
import { AppShell } from "./components/AppShell";
import "./styles/global.css";

export default function App() {
  return <AppShell />;
}
```

- [ ] **Step 8: 验证前端构建**

```bash
cd /Users/lijun/mynote
pnpm build
```

期望：无 TypeScript 或 build 错误。

- [ ] **Step 9: 提交**

```bash
cd /Users/lijun/mynote
git add src/
git commit -m "feat(ui): AppShell 3-column layout with header and status bar"
```

---

## Task 12: 打开知识库 UI 流程

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/WelcomeScreen.tsx`

- [ ] **Step 1: 写 WelcomeScreen.tsx（首次打开时的欢迎页面）**

```tsx
// src/components/WelcomeScreen.tsx
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";

export function WelcomeScreen() {
  const { setKb, refreshTree, setError } = useAppStore();

  async function handleCreate() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    const name = selected.split("/").pop() || "我的知识库";
    try {
      const kb = await api.createKnowledgeBase(selected, name);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleOpen() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    try {
      const kb = await api.openKnowledgeBase(selected);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "#f6f8fa",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>MyNote</h1>
      <p style={{ color: "#6e7681", marginBottom: 24 }}>个人 Markdown 知识库</p>
      <button
        onClick={handleCreate}
        style={{ padding: "10px 24px", fontSize: 15, cursor: "pointer", borderRadius: 6, border: "1px solid #ccc", background: "#0969da", color: "#fff" }}
      >
        新建知识库
      </button>
      <button
        onClick={handleOpen}
        style={{ padding: "10px 24px", fontSize: 15, cursor: "pointer", borderRadius: 6, border: "1px solid #ccc", background: "#fff" }}
      >
        打开知识库
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 更新 App.tsx 根据 kb 状态切换页面**

```tsx
// src/App.tsx
import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { useAppStore } from "./store/useAppStore";
import { api } from "./api/commands";
import "./styles/global.css";

export default function App() {
  const { kb, setKb } = useAppStore();

  useEffect(() => {
    // 应用启动时检查是否有已打开的知识库（重启恢复）
    api.getCurrentKnowledgeBase()
      .then((result) => { if (result) setKb(result); })
      .catch(() => {});
  }, []);

  if (!kb) return <WelcomeScreen />;
  return <AppShell />;
}
```

- [ ] **Step 3: 提交**

```bash
cd /Users/lijun/mynote
git add src/
git commit -m "feat(ui): WelcomeScreen with create/open knowledge base flow"
```

---

## Task 13: 文件树组件

**Files:**
- Modify: `src/components/LeftSidebar/LeftSidebar.tsx`
- Create: `src/components/LeftSidebar/FileTreePanel.tsx`
- Create: `src/components/LeftSidebar/FileTreeNode.tsx`
- Create: `src/hooks/useKnowledgeBase.ts`

- [ ] **Step 1: 写 useKnowledgeBase.ts hook**

```typescript
// src/hooks/useKnowledgeBase.ts
import { useCallback } from "react";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";

export function useKnowledgeBase() {
  const { setSelectedNodePath, refreshTree } = useAppStore();
  const { setCurrentNote, setContent } = useEditorStore();

  const openNote = useCallback(async (noteId: string) => {
    try {
      const detail = await api.getNote(noteId);
      setCurrentNote(detail.note);
      setContent(detail.content);
    } catch (e) {
      console.error("Failed to open note:", e);
    }
  }, [setCurrentNote, setContent]);

  const createNote = useCallback(async (directory: string, title: string) => {
    try {
      const detail = await api.createNote({ directory, title });
      await refreshTree();
      setCurrentNote(detail.note);
      setContent(detail.content);
    } catch (e) {
      console.error("Failed to create note:", e);
    }
  }, [refreshTree, setCurrentNote, setContent]);

  return { openNote, createNote };
}
```

- [ ] **Step 2: 写 FileTreeNode.tsx**

```tsx
// src/components/LeftSidebar/FileTreeNode.tsx
import { useState } from "react";
import type { NoteTreeNode } from "../../types";

interface Props {
  node: NoteTreeNode;
  depth?: number;
  onSelectFile: (node: NoteTreeNode) => void;
  selectedPath: string | null;
}

export function FileTreeNode({ node, depth = 0, onSelectFile, selectedPath }: Props) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === node.path;

  const indent = depth * 14 + 8;

  if (node.is_dir) {
    return (
      <div>
        <div
          onClick={() => setExpanded((e) => !e)}
          style={{
            paddingLeft: indent,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 3,
            cursor: "pointer",
            fontSize: 13,
            color: "#555",
            display: "flex",
            alignItems: "center",
            gap: 4,
            userSelect: "none",
          }}
        >
          <span>{expanded ? "▼" : "▶"}</span>
          <span>{node.name}</span>
        </div>
        {expanded &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelectFile={onSelectFile}
              selectedPath={selectedPath}
            />
          ))}
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelectFile(node)}
      style={{
        paddingLeft: indent,
        paddingRight: 8,
        paddingTop: 3,
        paddingBottom: 3,
        cursor: "pointer",
        fontSize: 13,
        background: isSelected ? "#dbeafe" : "transparent",
        color: isSelected ? "#1d4ed8" : "#333",
        borderRadius: 4,
        userSelect: "none",
      }}
    >
      {node.name}
    </div>
  );
}
```

- [ ] **Step 3: 写 FileTreePanel.tsx**

```tsx
// src/components/LeftSidebar/FileTreePanel.tsx
import { useAppStore } from "../../store/useAppStore";
import { useKnowledgeBase } from "../../hooks/useKnowledgeBase";
import { FileTreeNode } from "./FileTreeNode";
import type { NoteTreeNode } from "../../types";

export function FileTreePanel() {
  const { tree, selectedNodePath, setSelectedNodePath, kb } = useAppStore();
  const { openNote, createNote } = useKnowledgeBase();

  async function handleSelect(node: NoteTreeNode) {
    if (node.is_dir) return;
    setSelectedNodePath(node.path);
    // 通过路径找到 note id — 当前简化版本通过 path 查询
    // Phase 2 中 tree 节点会携带 id；此处通过 list_notes 补充
    // 目前先触发 openNote 时用 path，需要后端增加 get_note_by_path command
    // 暂时以 path 为 key 调用（task 14 中完善）
    console.log("open note at path:", node.path);
  }

  async function handleNewNote() {
    const title = prompt("笔记标题：");
    if (!title) return;
    await createNote("notes", title);
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #e0e2e7",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "#6e7681", textTransform: "uppercase" }}>
          文件
        </span>
        <button
          onClick={handleNewNote}
          style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer", lineHeight: 1, color: "#555" }}
          title="新建笔记"
        >
          +
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
        {tree.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            onSelectFile={handleSelect}
            selectedPath={selectedNodePath}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 更新 LeftSidebar.tsx**

```tsx
// src/components/LeftSidebar/LeftSidebar.tsx
import { FileTreePanel } from "./FileTreePanel";

export function LeftSidebar() {
  return <FileTreePanel />;
}
```

- [ ] **Step 5: 提交**

```bash
cd /Users/lijun/mynote
git add src/
git commit -m "feat(ui): FileTreePanel with expandable directory tree"
```

---

## Task 14: get_note_by_path command + 文件树选择笔记

**Files:**
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api/commands.ts`
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`

- [ ] **Step 1: 在 commands/note.rs 添加 get_note_by_path**

在 `commands/note.rs` 末尾追加：

```rust
#[tauri::command]
pub fn get_note_by_path(path: String, state: State<AppState>) -> Result<NoteDetail, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database connection".into()))?;
    let root = state
        .kb_root.lock().unwrap().clone()
        .ok_or_else(|| AppError::InvalidInput("No KB open".into()))?;

    let note_id: String = conn
        .query_row(
            "SELECT id FROM notes WHERE path = ?1 AND deleted_at IS NULL",
            rusqlite::params![path],
            |r| r.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("Note not found at path: {}", path)))?;

    drop(db_guard);
    crate::services::note_service::get_note(&note_id, &state)
}
```

- [ ] **Step 2: 注册 command 到 lib.rs**

在 `tauri::generate_handler![]` 列表末尾追加：

```rust
commands::note::get_note_by_path,
```

- [ ] **Step 3: 在 api/commands.ts 添加 getNoteByPath**

在 `api` 对象末尾追加：

```typescript
getNoteByPath: (path: string) =>
  invoke<NoteDetail>("get_note_by_path", { path }),
```

- [ ] **Step 4: 更新 FileTreePanel 的 handleSelect 调用真实 API**

将 `FileTreePanel.tsx` 的 `handleSelect` 替换为：

```typescript
async function handleSelect(node: NoteTreeNode) {
  if (node.is_dir) return;
  setSelectedNodePath(node.path);
  try {
    const detail = await api.getNoteByPath(node.path);
    setCurrentNote(detail.note);
    setContent(detail.content);
  } catch (e) {
    console.error("Failed to open note:", e);
  }
}
```

在组件 import 中补充：

```typescript
import { api } from "../../api/commands";
import { useEditorStore } from "../../store/useEditorStore";
```

在组件内获取 setCurrentNote/setContent：

```typescript
const { setCurrentNote, setContent } = useEditorStore();
```

- [ ] **Step 5: 验证编译**

```bash
cd /Users/lijun/mynote/src-tauri && cargo check
cd /Users/lijun/mynote && pnpm build
```

期望：两者均无错误。

- [ ] **Step 6: 提交**

```bash
cd /Users/lijun/mynote
git add .
git commit -m "feat: file tree node click opens note in editor"
```

---

## Task 15: CodeMirror 6 编辑器组件

**Files:**
- Create: `src/components/EditorWorkspace/MarkdownEditor.tsx`
- Create: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`

- [ ] **Step 1: 写 MarkdownEditor.tsx**

```tsx
// src/components/EditorWorkspace/MarkdownEditor.tsx
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { useEditorStore } from "../../store/useEditorStore";

interface Props {
  initialContent: string;
  onChange: (content: string) => void;
}

export function MarkdownEditor({ initialContent, onChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    const startState = EditorState.create({
      doc: initialContent,
      extensions: [
        history(),
        lineNumbers(),
        markdown({ base: markdownLanguage }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "15px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
        }),
      ],
    });

    const view = new EditorView({ state: startState, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // 仅在挂载时创建，避免重建编辑器

  // 当外部 initialContent 变化（切换笔记），重建编辑器内容
  useEffect(() => {
    if (!viewRef.current) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (currentContent !== initialContent) {
      viewRef.current.dispatch({
        changes: { from: 0, to: currentContent.length, insert: initialContent },
      });
    }
  }, [initialContent]);

  return (
    <div
      ref={editorRef}
      style={{ flex: 1, height: "100%", overflow: "auto" }}
    />
  );
}
```

- [ ] **Step 2: 写 MarkdownPreview.tsx**

```tsx
// src/components/EditorWorkspace/MarkdownPreview.tsx
import { useEffect, useRef } from "react";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

interface Props {
  content: string;
}

export function MarkdownPreview({ content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = md.render(content);
  }, [content]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        height: "100%",
        overflowY: "auto",
        padding: "20px 40px",
        maxWidth: 720,
        margin: "0 auto",
        fontSize: 15,
        lineHeight: 1.7,
      }}
    />
  );
}
```

- [ ] **Step 3: 写 EditorWorkspace.tsx（分屏预览）**

```tsx
// src/components/EditorWorkspace/EditorWorkspace.tsx
import { useCallback, useState } from "react";
import { useEditorStore } from "../../store/useEditorStore";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAutoSave } from "../../hooks/useAutoSave";

export function EditorWorkspace() {
  const { currentNote, content, setContent, markDirty } = useEditorStore();
  const [showPreview, setShowPreview] = useState(true);
  useAutoSave();

  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      markDirty();
    },
    [setContent, markDirty]
  );

  if (!currentNote) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#999",
          fontSize: 14,
        }}
      >
        请从左侧文件树选择或新建笔记
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 工具栏 */}
      <div
        style={{
          height: 36,
          borderBottom: "1px solid #e0e2e7",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 8,
          fontSize: 12,
          background: "#fafbfc",
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 500 }}>{currentNote.title}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowPreview((p) => !p)}
          style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer", borderRadius: 4, border: "1px solid #ccc" }}
        >
          {showPreview ? "隐藏预览" : "显示预览"}
        </button>
      </div>
      {/* 编辑区 */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <MarkdownEditor initialContent={content} onChange={handleChange} />
        {showPreview && <MarkdownPreview content={content} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 提交**

```bash
cd /Users/lijun/mynote
git add src/
git commit -m "feat(editor): CodeMirror 6 editor with split markdown preview"
```

---

## Task 16: 自动保存 Hook

**Files:**
- Create: `src/hooks/useAutoSave.ts`

- [ ] **Step 1: 写 useAutoSave.ts**

```typescript
// src/hooks/useAutoSave.ts
import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/useEditorStore";
import { api } from "../api/commands";

const AUTO_SAVE_DELAY_MS = 800;

export function useAutoSave() {
  const { currentNote, content, isDirty, markSaved, setSaving, setSaveError } =
    useEditorStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDirty || !currentNote) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const result = await api.saveNote({
          note_id: currentNote.id,
          content,
          expected_hash: lastSavedHashRef.current ?? currentNote.content_hash,
        });
        if (result.conflict) {
          setSaveError("检测到外部修改，已将当前内容保存为冲突副本");
        } else {
          lastSavedHashRef.current = result.note.content_hash;
          markSaved(result.note);
        }
      } catch (e) {
        setSaveError(String(e));
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isDirty, content, currentNote]);

  // 切换笔记时重置 hash 记录
  useEffect(() => {
    if (currentNote) {
      lastSavedHashRef.current = currentNote.content_hash;
    }
  }, [currentNote?.id]);
}
```

- [ ] **Step 2: 提交**

```bash
cd /Users/lijun/mynote
git add src/
git commit -m "feat(editor): 800ms debounce auto-save with conflict detection"
```

---

## Task 17: 端到端冒烟测试

**目标：** 手动运行应用并验证完整的最小闭环。

- [ ] **Step 1: 启动开发模式**

```bash
cd /Users/lijun/mynote
cargo tauri dev
```

期望：应用窗口弹出，显示 WelcomeScreen（新建/打开知识库按钮）。

- [ ] **Step 2: 创建知识库**

点击"新建知识库"，在弹窗中选择或新建一个空目录（如 `/tmp/test-kb`）。

期望：
- 应用切换到主界面（三栏布局）。
- 左侧文件树为空或仅显示 `notes/` 目录。
- 本地目录中出现 `notes/`、`assets/`、`.mynote/` 子目录。
- `.mynote/index.sqlite` 存在。

- [ ] **Step 3: 新建笔记**

点击左侧栏 `+` 按钮，输入标题"我的第一篇笔记"。

期望：
- 文件树出现 `我的第一篇笔记` 节点。
- 编辑器加载笔记内容（包含 Front Matter 和 `# 我的第一篇笔记`）。
- `notes/我的第一篇笔记.md` 文件出现在磁盘上。

- [ ] **Step 4: 编辑内容**

在编辑器中输入一段文字。

期望：
- 状态栏显示"未保存"。
- 约 800ms 后状态栏自动变为"保存中…"再变为"已保存"。
- 磁盘上的 `.md` 文件内容更新为最新内容。

- [ ] **Step 5: 右侧预览验证**

确认输入 `**粗体**` 等 Markdown 语法后，右侧预览区实时渲染加粗效果。

- [ ] **Step 6: 关闭并重新打开知识库**

关闭应用，重启后点击"打开知识库"，选择之前的目录。

期望：
- 文件树正确展示之前创建的笔记。
- 点击笔记可正常打开并显示之前保存的内容。

- [ ] **Step 7: 提交（完成 Phase 1）**

```bash
cd /Users/lijun/mynote
git add .
git commit -m "feat: Phase 1 complete — create KB, create/edit/save note, reopen"
```

---

## 自检记录

### Spec 覆盖

| Phase 1 需求 | 计划任务 |
| --- | --- |
| 创建知识库目录结构 | Task 7 |
| SQLite schema + 迁移 | Task 5 |
| 笔记创建、读取、保存、删除 | Task 8 |
| Markdown Front Matter 解析 | Task 4 |
| 三栏 UI 布局 | Task 11 |
| 文件树 | Task 13 |
| CodeMirror 6 编辑器 | Task 15 |
| Markdown 实时预览 | Task 15 |
| 自动保存 + 冲突检测 | Task 16 |
| SQLite 笔记索引 | Task 8 |
| 关闭后重新打开知识库 | Task 7 + Task 17 |

### 类型一致性

- `Note`、`NoteDetail`、`SaveNoteResult`、`CreateNoteInput`、`SaveNoteInput` 在 Rust domain 和 TypeScript types 中字段名一致。
- `api.saveNote` 传参为 `{ input }` 匹配 Rust `#[tauri::command] fn save_note(input: SaveNoteInput, ...)` 的参数名。
- `api.getNoteByPath` 传参为 `{ path }` 匹配 Rust `fn get_note_by_path(path: String, ...)`。

### 范围检查

Phase 1 不包含：标签、Wiki 链接、FTS5 搜索、修订记录、图谱、文件监听——这些在 Phase 2-4 中实现。

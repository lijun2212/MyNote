# SQLite Migration Safety Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义 SQLite migration checksum、name 校验、事务化执行和失败恢复策略。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标与非目标](#2-目标与非目标)
- [3. 现状与风险](#3-现状与风险)
- [4. 方案选择](#4-方案选择)
- [5. 目标设计](#5-目标设计)
- [6. 数据模型](#6-数据模型)
- [7. 迁移运行流程](#7-迁移运行流程)
- [8. 错误处理](#8-错误处理)
- [9. 兼容性策略](#9-兼容性策略)
- [10. 测试策略](#10-测试策略)
- [11. 验证命令](#11-验证命令)
- [12. 风险与后续](#12-风险与后续)

## 1. 背景

Baseline 中将 SQLite migration 可靠性列为 P2 风险：当前迁移机制只用 `MAX(version)` 判断数据库迁移进度，缺少已应用迁移的 `name` 和 SQL 内容校验，也缺少迁移失败后的恢复测试。

当前实现位于 `src-tauri/src/infrastructure/db.rs`：

- `open_and_migrate(db_path)` 打开 SQLite 连接，启用 WAL 和 foreign keys，然后调用 `run_migrations`。
- `schema_migrations` 表只有 `version`、`name`、`applied_at` 三列。
- `run_migrations` 读取 `SELECT COALESCE(MAX(version), 0)`，只执行 version 大于最大已应用版本的迁移。
- 每个迁移直接 `execute_batch(sql)`，成功后插入 `schema_migrations`。
- 测试只覆盖首次建表和重复打开幂等。

个人知识库是本地优先应用，Markdown 文件是主要资产，但 SQLite 中仍保存索引、标签、链接、设置和后续可能出现的不可推导数据。迁移机制应尽早发现 schema 污染，避免在不一致状态下继续读写。

## 2. 目标与非目标

### 2.1 目标

1. 记录每个 migration 的稳定 checksum，检测已应用迁移的 SQL 或名称变化。
2. 校验已应用 migration 必须与当前代码中的 `MIGRATIONS` 定义逐项匹配。
3. 避免仅依赖 `MAX(version)` 带来的跳版本风险。
4. 使用事务保证单个 migration 要么完整应用并记录为 `applied`，要么完全回滚。
5. 支持旧数据库无损升级：自动为 `schema_migrations` 补充 `checksum` 和 `status` 列，并回填已应用迁移的 checksum。
6. 增加回归测试覆盖：旧库升级、checksum mismatch、name mismatch、未知版本、非 applied 状态、失败回滚和重复打开幂等。

### 2.2 非目标

1. 不引入第三方 migration framework。
2. 不实现 migration downgrade 或自动回滚到旧版本。
3. 不提供 UI 层的数据库修复工具。
4. 不改变现有业务 schema 1-8 的表结构含义。
5. 不处理搜索 fallback 性能风险；该项仍作为后续 P2 独立任务。

## 3. 现状与风险

### 3.1 当前风险

| 风险 | 现状 | 影响 |
| --- | --- | --- |
| 已应用迁移被改名 | 只存储 name，不校验 | 同版本语义变化无法被发现。 |
| 已应用迁移 SQL 被修改 | 不存 checksum | 新旧数据库可能使用同一 version 但 schema 不一致。 |
| 跳版本 | 只看 `MAX(version)` | 如果表里存在未来版本或代码缺少中间版本，可能误判当前库已完成迁移。 |
| 半应用失败 | SQL 和记录插入没有显式事务边界 | 失败后可能留下部分 schema 对象，缺少测试验证重开行为。 |
| 非正常状态 | 没有 status | 无法区分 applied、applying、failed 等状态。 |

### 3.2 约束

- 当前错误模型已有 `AppError::Database(String)`、`AppError::InvalidInput(String)` 和 `AppError::Conflict(String)`。
- 当前 hash helper 已有 `src-tauri/src/infrastructure/hash.rs::sha256_str`。
- `rusqlite` 已在项目中使用，可使用 transaction。
- `MIGRATIONS` 当前是编译期常量数组，适合在运行时计算 checksum。

## 4. 方案选择

### 4.1 推荐方案：保守校验 + 事务化迁移

该方案扩展 `schema_migrations`，为每条 migration 记录 `checksum` 和 `status`，启动时对已应用 migration 做严格校验，未应用 migration 用事务逐条执行。任何不一致都停止打开数据库并返回明确错误。

优点：

- 改动集中在 `db.rs`。
- 不改变业务 schema。
- 能覆盖 baseline 指出的 checksum/name/失败恢复风险。
- 对旧库兼容，可在首次打开时补列和回填。

缺点：

- 已应用 migration 的 SQL 以后不能随意改动；需要新增 migration 来演进 schema。
- 某些历史库如果已被手工修改，会在启动时 fail-fast，需要用户恢复备份或重建索引。

### 4.2 备选方案：只加 checksum，不改运行流程

只给 `schema_migrations` 增加 checksum，并在启动时校验 checksum，但仍用 `MAX(version)` 决定迁移进度。

优点是改动最小。缺点是跳版本、未知版本和状态恢复问题仍存在，不满足 P2 风险的完整闭环。

### 4.3 备选方案：引入 migration framework

引入外部 Rust migration 工具管理版本、校验和执行。

优点是能力完整。缺点是增加依赖和迁移成本，当前项目只有 8 条迁移，暂时没有必要。

### 4.4 结论

采用 4.1。它在当前代码规模下最稳妥，能保持实现简单，同时把未来 schema 演进的规则固定下来：已发布 migration 不修改，任何 schema 变化通过新增 migration 表达。

## 5. 目标设计

### 5.1 Migration 定义

保留当前 `MIGRATIONS` 常量的表达方式，但在代码中引入一个轻量结构便于命名字段：

```rust
struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}
```

`MIGRATIONS` 改为：

```rust
const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "create_knowledge_base_meta", sql: "..." },
];
```

### 5.2 Checksum 规则

checksum 使用现有 `sha256_str` 计算：

```text
version + "\n" + name + "\n" + sql
```

Rust helper：

```rust
fn migration_checksum(migration: &Migration) -> String {
    sha256_str(&format!("{}\n{}\n{}", migration.version, migration.name, migration.sql))
}
```

规则说明：

- version 参与 checksum，防止复制 SQL 到不同 version 时误判相同。
- name 参与 checksum，防止同 version 改名不被发现。
- sql 参与 checksum，检测 schema 内容变化。
- 不做 SQL normalize。已发布 migration 文本视为不可变，格式变化也应通过新增 migration 或显式兼容逻辑处理。

### 5.3 已应用迁移校验

启动时读取 `schema_migrations` 全量记录，按 version 升序校验：

1. version 必须能在当前 `MIGRATIONS` 中找到。
2. name 必须与当前 migration 定义一致。
3. checksum 必须与当前 migration 计算结果一致。
4. status 必须是 `applied`。
5. 已应用版本必须连续，从 1 到当前最大已应用版本不得缺失。

任何失败都返回 `AppError::Database`，错误消息包含 version 和失败原因。

### 5.4 未应用迁移执行

校验通过后，从第一个未应用 migration 开始顺序执行。

每个 migration 单独使用 transaction：

1. 开启 transaction。
2. 执行 migration SQL。
3. 插入或替换 `schema_migrations(version, name, checksum, status, applied_at)`，status 为 `applied`。
4. commit。

如果步骤 2 或步骤 3 失败，transaction rollback，不写入 `applied` 记录。下一次打开数据库时会重新尝试未完成 migration。

### 5.5 Status 策略

`status` 当前只写入 `applied`。设计上仍保留 status 字段，原因：

- 旧库可以用默认值 `applied` 平滑升级。
- 测试可以覆盖非 `applied` 状态会被拒绝。
- 后续如果需要记录 `failed` 或 `repaired`，不需要再次改变表结构。

本次不写入 `applying` 或 `failed`，避免在 transaction rollback 后留下状态记录带来额外复杂度。

## 6. 数据模型

目标表结构：

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    checksum   TEXT    NOT NULL DEFAULT '',
    status     TEXT    NOT NULL DEFAULT 'applied',
    applied_at TEXT    NOT NULL
);
```

旧库升级策略：

```sql
ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT '';
ALTER TABLE schema_migrations ADD COLUMN status TEXT NOT NULL DEFAULT 'applied';
```

实际实现中需要先用 `PRAGMA table_info(schema_migrations)` 检查列是否存在，只对缺失列执行 `ALTER TABLE`。SQLite 不支持 `ADD COLUMN IF NOT EXISTS` 的所有版本写法，因此用 Rust 检查更稳。

回填策略：

- 对 checksum 为空字符串的已应用 migration，按当前 `MIGRATIONS` 计算并更新 checksum。
- 回填前必须先确认 version 和 name 与当前 migration 定义一致。
- 如果旧库中存在当前代码未知的 version，立即报错，不回填。

## 7. 迁移运行流程

目标流程：

```text
open_and_migrate
  -> open SQLite connection
  -> PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  -> ensure_schema_migrations_table
  -> ensure_schema_migrations_columns
  -> backfill_legacy_migration_checksums
  -> validate_applied_migrations
  -> apply_pending_migrations
  -> return connection
```

### 7.1 ensure schema table

继续使用 `CREATE TABLE IF NOT EXISTS schema_migrations`。新建库会直接包含 `checksum` 和 `status` 列。

### 7.2 ensure columns

读取 `PRAGMA table_info(schema_migrations)`，如果缺少 `checksum` 或 `status`，使用 `ALTER TABLE` 补列。

### 7.3 backfill legacy checksums

只处理 checksum 为空的记录。逻辑：

1. 查询 `version, name, checksum, status`。
2. 对每条记录找到当前 migration。
3. 如果找不到 version，报错。
4. 如果 name 不一致，报错。
5. 如果 status 不是 `applied`，报错。
6. 如果 checksum 为空，写入当前计算出的 checksum。

### 7.4 validate applied migrations

回填后再完整校验所有已应用记录。

额外校验版本连续性：

- 如果存在已应用版本 `[1, 2, 4]`，报错 version gap at 3。
- 如果存在已应用版本 `[1, 2, 3]` 且当前 `MIGRATIONS` 从 1 到 3 都存在，则继续执行 4 以后。

### 7.5 apply pending migrations

顺序遍历 `MIGRATIONS`，跳过已应用版本，执行未应用版本。每条 migration 独立 transaction。执行成功后记录当前 checksum。

## 8. 错误处理

本次使用 `AppError::Database(String)`，不新增错误枚举。错误消息应清晰可定位，例如：

```text
Migration 3 name mismatch: database has 'create_setting', code has 'create_settings'
Migration 4 checksum mismatch for 'create_note_fts'
Migration 9 exists in database but not in current code
Migration version gap: expected 3 but found 4
Migration 5 has invalid status 'failed'
```

知识库打开路径不吞掉这些错误。`open_knowledge_base_service` 和 `create_knowledge_base_service` 继续通过 `?` 传播错误。

## 9. 兼容性策略

### 9.1 旧数据库

已由旧版本创建、只包含 `version/name/applied_at` 的数据库应能首次打开，并自动补充 `checksum/status`。前提是：

- 旧库中已应用 migration version 都存在于当前 `MIGRATIONS`。
- name 与当前定义一致。
- status 补列后默认为 `applied`。

### 9.2 新数据库

新库直接创建完整 `schema_migrations` 表，并记录每条 migration 的 checksum/status。

### 9.3 已发布 migration 不可变

完成本次变更后，`MIGRATIONS` 中已存在的 migration 文本应视为不可变。后续 schema 变化必须新增 version。若必须修复历史 migration 文本，需单独设计兼容策略，不在本次范围内。

### 9.4 数据恢复策略

如果校验失败，应用停止打开知识库。当前阶段不自动修改业务表，也不尝试自动重建数据库。后续可增加用户可见的“重建索引数据库”流程，但这属于独立任务。

## 10. 测试策略

测试继续放在 `src-tauri/src/infrastructure/db.rs` 的 `#[cfg(test)]` 模块内。

必需测试：

1. `test_open_and_migrate_creates_tables`
   - 更新断言：`schema_migrations` 有 8 条记录。
   - 验证 `checksum` 非空，`status = 'applied'`。

2. `test_migrations_are_idempotent`
   - 重复打开数据库不新增记录，不改变 checksum。

3. `test_legacy_migrations_backfill_checksum_and_status`
   - 手动创建旧格式 `schema_migrations(version, name, applied_at)`，插入版本 1。
   - 调用 `open_and_migrate`。
   - 验证新增列存在，版本 1 checksum 被回填，后续 migration 被应用。

4. `test_migration_name_mismatch_fails`
   - 先创建正常库。
   - 手工修改某个 `schema_migrations.name`。
   - 再次调用 `open_and_migrate` 应返回错误。

5. `test_migration_checksum_mismatch_fails`
   - 先创建正常库。
   - 手工修改某个 `schema_migrations.checksum`。
   - 再次调用 `open_and_migrate` 应返回错误。

6. `test_unknown_migration_version_fails`
   - 手工插入当前代码不存在的 version，例如 999。
   - 调用 `open_and_migrate` 应返回错误。

7. `test_migration_version_gap_fails`
   - 手工创建 `schema_migrations` 记录 1 和 3，缺少 2。
   - 调用 `open_and_migrate` 应返回错误。

8. `test_invalid_migration_status_fails`
   - 先创建正常库。
   - 手工把某条 status 改成 `failed`。
   - 再次调用 `open_and_migrate` 应返回错误。

9. `test_failed_migration_rolls_back_record`
   - 使用测试专用 helper 运行一个会失败的 migration。
   - 验证失败 migration 没有记录为 `applied`。
   - 再用成功 SQL 重跑同版本 migration，验证可以成功应用。

测试 helper 允许只在 `#[cfg(test)]` 内暴露，例如：

```rust
#[cfg(test)]
fn run_migrations_for_test(conn: &mut Connection, migrations: &[Migration]) -> AppResult<()> {
    run_migrations(conn, migrations)
}
```

为支持 transaction，`run_migrations` 可以改为接收 `&mut Connection`。`open_and_migrate` 创建连接后将其声明为 mutable。

## 11. 验证命令

实现完成后至少运行：

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

如迁移错误影响 Tauri 启动，还应运行：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri build --debug
```

## 12. 风险与后续

### 12.1 仍存在的风险

- 事务能保证 migration SQL 和 migration 记录的一致性，但如果某些 SQL 语句本身在 SQLite 中触发隐式提交，需要通过测试确认实际行为。本项目当前 1-8 迁移主要是 `CREATE TABLE IF NOT EXISTS` 和 `CREATE INDEX IF NOT EXISTS`，适合事务化。
- 远期如果出现不可从 Markdown 重建的数据，校验失败后的恢复 UX 需要更完整的用户流程。

### 12.2 后续建议

- 增加“重建索引数据库”用户操作，用于 SQLite 索引损坏时从 Markdown 重建可推导数据。
- 增加数据库备份/恢复策略，与 `.mynote/backups/database` 目录联动。
- 下一个 P2 风险继续处理搜索 fallback 性能。

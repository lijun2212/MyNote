# AI Secret Save Verification Implementation Plan

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-15 | v1.0 | 初版，聚焦 Windows 下 AI API Key 保存时的写后校验误判修复。 |

## 目录

1. 目标
2. 架构
3. 技术栈
4. 任务拆解

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许 AI API Key 在系统密钥存储写入成功但暂时无法立即读回时仍然保存成功，避免 Windows 上的误报阻断配置保存。

**Architecture:** 保持系统密钥存储为唯一持久化后端，不新增数据库明文或可逆密文保存。修复点集中在 Tauri 的 `set_ai_profile_secret_in_conn`：写入成功后直接建立进程内缓存，不再以同步读回作为保存成功的前置条件；其余读取、测试和缺失密钥判定链路保持不变。

**Tech Stack:** Rust, Tauri, keyring, rusqlite, cargo test.

---

### Task 1: 锁定失败场景

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`
- Test: `src-tauri/src/commands/ai.rs`

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn set_ai_profile_secret_allows_write_only_secret_store() {
    let temp = tempdir().unwrap();
    let conn = open_and_migrate(&temp.path().join("test.sqlite")).unwrap();
    let secret_store = WriteOnlySecretStore;
    let kb_root = Path::new("/tmp/kb-a");
    let secret_key = build_secret_store_key(kb_root, "profile-1");

    insert_profile(&conn, "profile-1", AiProviderKind::OpenAiCompatible);

    set_ai_profile_secret_in_conn(&conn, &secret_store, &secret_key, "profile-1", "sk-demo")
        .unwrap();

    assert_eq!(load_profile_secret(&secret_store, kb_root, "profile-1").unwrap(), "sk-demo");
}
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `cd src-tauri && cargo test set_ai_profile_secret_allows_write_only_secret_store -- --exact`
Expected: FAIL，错误来自“无法验证已保存到系统密钥链的 AI 配置密钥”。

### Task 2: 最小实现修复

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`
- Test: `src-tauri/src/commands/ai.rs`

- [ ] **Step 1: 改为写成功即缓存成功**

```rust
secret_store.set_profile_secret(secret_key, &normalized_api_key)?;
cache_profile_secret(secret_key, &normalized_api_key);
Ok(())
```

- [ ] **Step 2: 保留现有读取链路**

```rust
match load_profile_secret(secret_store, kb_root, &normalized_profile_id) {
    Ok(_) => Ok(true),
    Err(AppError::NotFound(_)) => Ok(false),
    Err(error) => Err(error),
}
```

- [ ] **Step 3: 更新旧测试断言**

```rust
#[test]
fn set_ai_profile_secret_primes_session_cache_for_later_reads() {
    // keep existing cache behavior assertions unchanged
}
```

### Task 3: 回归验证

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`
- Test: `src-tauri/src/commands/ai.rs`

- [ ] **Step 1: 运行定向 Rust 测试**

Run: `cd src-tauri && cargo test set_ai_profile_secret_ -- --nocapture`
Expected: PASS，至少覆盖写入、缓存、空 profile 校验相关用例。

- [ ] **Step 2: 运行 AI 命令文件测试**

Run: `cd src-tauri && cargo test commands::ai -- --nocapture`
Expected: PASS，无新增失败。
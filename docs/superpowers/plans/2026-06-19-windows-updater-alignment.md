# Windows Updater Alignment Implementation Plan

## 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 0.1 | 2026-06-19 | 首版计划，覆盖 Windows updater target 修正、回归测试与发布文档补充。 |

## 目录

1. [目标](#goal)
2. [架构](#architecture)
3. [技术栈](#tech-stack)
4. [任务 1：补 Windows 回归测试](#task-1)
5. [任务 2：修正 Windows updater target](#task-2)
6. [任务 3：补发布文档](#task-3)
7. [验证](#verification)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 Windows updater 发布链路中的 target 命名错误，并把 Windows 手动更新涉及的产物与安装行为写入发布文档。

**Architecture:** 变更只落在 updater 发布计划生成层与文档层，不改动前端检查更新入口。测试先从 scripts 层锁定 Windows target 和资产选择行为，再做最小实现修复，最后把文档中的平台差异写清楚。

**Tech Stack:** Node.js ESM、Vitest、Tauri 2 updater、Markdown 文档。

---

## 目标 {#goal}

修正 Windows 上生成 latest.json 时平台键错误的问题，并补充 Windows updater 资产与安装行为说明。

## 架构 {#architecture}

发布链路继续保持“构建当前平台 bundle -> 读取签名产物 -> 生成 latest.json -> 上传 GitHub Release”的模式。Windows 仅需要在计划生成阶段把 Node 平台名 `win32` 规范化为 Tauri 需要的 `windows`，并在文档中明确 updater 资产会复用签名后的 `.exe` 或 `.msi`，安装时应用会自动退出。

## 技术栈 {#tech-stack}

Node.js、Vitest、Tauri updater 静态 manifest、GitHub Releases、Markdown。

### 任务 1：补 Windows 回归测试 {#task-1}

**Files:**
- Modify: `scripts/lib/updaterReleasePlan.test.mjs`

- [ ] **Step 1: Write the failing test**

为 `buildGitHubUpdaterPlan` 增加一个 Windows 场景：在临时 bundle 目录下放置带 `.sig` 的 `nsis` `.exe` 和 `msi` `.msi`，mock `os.platform()` 返回 `win32`、`os.arch()` 返回 `x64`，断言生成的 `manifestPlatforms[0].target` 为 `windows-x86_64`，并且 release 资产包含 `.exe` 与 `.msi`。

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run scripts/lib/updaterReleasePlan.test.mjs`
Expected: FAIL，报错显示 `Unsupported updater target 'win32-x86_64'` 或等价错误。

### 任务 2：修正 Windows updater target {#task-2}

**Files:**
- Modify: `scripts/lib/updaterReleasePlan.mjs`
- Test: `scripts/lib/updaterReleasePlan.test.mjs`

- [ ] **Step 3: Write minimal implementation**

在 `getCurrentTarget()` 内把 `os.platform()` 的 `win32` 规范化为 `windows`，保持其余平台不变。不要改动现有 bundle 搜索与 supplemental 资产逻辑。

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run scripts/lib/updaterReleasePlan.test.mjs`
Expected: PASS，Windows 新增测试与现有 macOS 测试同时通过。

### 任务 3：补发布文档 {#task-3}

**Files:**
- Modify: `docs/packaging-and-release.md`

- [ ] **Step 5: Update documentation**

补三类信息：
1. 修订记录新增一条，说明本次补充 Windows updater 产物与 target 对齐。
2. Windows 打包章节补充：`release:build` 在 Windows 下会读取签名后的 `.exe` 或 `.msi` 生成 `latest.json`，正式发布应优先在 Windows runner 上完成。
3. GitHub 托管与发布校验章节补充：不同平台的 updater 核心资产分别是 macOS `.app.tar.gz`、Windows `.exe` 或 `.msi`、Linux `.AppImage`；Windows 安装更新时应用会自动退出。

- [ ] **Step 6: Run focused verification**

Run: `corepack pnpm vitest run scripts/lib/updaterReleasePlan.test.mjs`
Expected: PASS。

## 验证 {#verification}

1. `corepack pnpm vitest run scripts/lib/updaterReleasePlan.test.mjs`
2. 如需要额外看变更面，再执行 `git diff -- scripts/lib/updaterReleasePlan.mjs scripts/lib/updaterReleasePlan.test.mjs docs/packaging-and-release.md`
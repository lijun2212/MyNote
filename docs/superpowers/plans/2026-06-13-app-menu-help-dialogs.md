# App Menu And Help Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the top-level app menu around a MyNote menu, add knowledge-base open/close actions, move AI controls into a nested submenu, and implement complete Shortcuts/About dialogs under Help.

**Architecture:** Extend the shared menu schema and menu builder to support nested submenus and separators, then wire new knowledge-base and help-dialog actions through AppShell and dedicated lightweight dialog components. Keep existing AI settings behavior intact by reusing the current store actions and event patterns.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri menu API, Vitest, Testing Library

---

## File Map

- Modify: `src/menu/menuIds.ts`
  - Define the new top-level menu ids and new action ids for knowledge-base open/close.
- Modify: `src/menu/menuSchema.ts`
  - Reshape the app menu to `MyNote / 编辑 / 视图 / 笔记 / 帮助`, add nested AI submenu support, and represent separators explicitly.
- Modify: `src/menu/useAppMenu.ts`
  - Make submenu creation recursive and support separator items when building the native Tauri menu.
- Modify: `src/menu/menuActionRunner.ts`
  - Add action handlers for opening and closing a knowledge base.
- Modify: `src/components/AppShell.tsx`
  - Wire the new menu actions, local dialog state, and close-knowledge-base state clearing.
- Create: `src/components/Help/ShortcutsDialog.tsx`
  - Render the complete shortcuts dialog.
- Create: `src/components/Help/AboutDialog.tsx`
  - Render the complete about dialog and surface package version.
- Modify: `src/components/AppShell.test.tsx`
  - Cover menu-triggered knowledge-base close behavior and help dialog opening.
- Modify: `src/menu/menuSchema.test.ts`
  - Cover top-level order, submenu nesting, separators, and enablement.
- Modify: `src/menu/useAppMenu.test.tsx`
  - Cover recursive submenu construction and separator handling.
- Modify: `src/menu/menuActionRunner.test.ts`
  - Cover the new knowledge-base actions.
- Create: `src/components/Help/ShortcutsDialog.test.tsx`
  - Verify dialog rendering and close behavior.
- Create: `src/components/Help/AboutDialog.test.tsx`
  - Verify dialog rendering and close behavior.

## Task 1: Extend Menu Identifiers And Schema Types

**Files:**
- Modify: `src/menu/menuIds.ts`
- Modify: `src/menu/menuSchema.ts`
- Test: `src/menu/menuSchema.test.ts`

- [ ] **Step 1: Write the failing menu schema tests for the new top-level order and MyNote structure**

Add assertions in `src/menu/menuSchema.test.ts` for:
- top-level order equals `mynote / edit / view / note / help`
- MyNote children are `file.newNote`, `file.newNotebook`, `kb.open`, `kb.close`, `file.importNote`, separator, `mynote.ai`
- `mynote.ai` contains `ai.settings`, `ai.testConnection`, `ai.toggleAutoSummaryAgent`
- Help still contains `help.shortcuts`, `help.about`

- [ ] **Step 2: Run the targeted schema test to verify it fails**

Run: `corepack pnpm vitest run src/menu/menuSchema.test.ts`
Expected: FAIL because the current schema still exposes `file` and `ai` as top-level menus and has no `kb.open`, `kb.close`, or separator support.

- [ ] **Step 3: Add the new menu ids and separator schema support**

Update `src/menu/menuIds.ts` to:
- change `APP_MENU_IDS` to `mynote`, `edit`, `view`, `note`, `help`
- add `kb.open` and `kb.close` to `MENU_ACTION_IDS`
- add a separator schema id type, for example `separator`

Update `src/menu/menuSchema.ts` to:
- support a menu schema item variant for separators
- build the MyNote menu in the confirmed order
- embed the AI submenu as a child menu item
- keep Help as a top-level menu with shortcuts and about

- [ ] **Step 4: Run the targeted schema test to verify it passes**

Run: `corepack pnpm vitest run src/menu/menuSchema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/menu/menuIds.ts src/menu/menuSchema.ts src/menu/menuSchema.test.ts
git commit -m "feat: reshape app menu schema"
```

## Task 2: Extend Native Menu Builder For Nested Submenus And Separators

**Files:**
- Modify: `src/menu/useAppMenu.ts`
- Modify: `src/menu/useAppMenu.test.tsx`
- Test: `src/menu/useAppMenu.test.tsx`

- [ ] **Step 1: Write failing tests for recursive submenu and separator support**

Add tests in `src/menu/useAppMenu.test.tsx` that render a menu tree containing:
- a top-level `mynote` submenu
- a nested `mynote.ai` submenu with `ai.settings`
- a separator item between import and nested submenu

Assert that:
- the nested submenu is created as a submenu rather than a leaf item
- the separator becomes a native separator item without an action

- [ ] **Step 2: Run the targeted menu builder test to verify it fails**

Run: `corepack pnpm vitest run src/menu/useAppMenu.test.tsx`
Expected: FAIL because the current builder assumes every child is a leaf and has no separator path.

- [ ] **Step 3: Implement recursive submenu and separator construction**

Update `src/menu/useAppMenu.ts` to:
- recursively create submenu children when an item contains `children`
- create a Tauri separator item for separator schema nodes
- preserve checked leaf item behavior and disabled action behavior

- [ ] **Step 4: Run the targeted menu builder test to verify it passes**

Run: `corepack pnpm vitest run src/menu/useAppMenu.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/menu/useAppMenu.ts src/menu/useAppMenu.test.tsx
git commit -m "feat: support nested app menus"
```

## Task 3: Add Knowledge-Base Menu Actions To The Action Runner

**Files:**
- Modify: `src/menu/menuActionRunner.ts`
- Modify: `src/menu/menuActionRunner.test.ts`
- Test: `src/menu/menuActionRunner.test.ts`

- [ ] **Step 1: Write failing tests for `kb.open` and `kb.close`**

Add tests in `src/menu/menuActionRunner.test.ts` asserting that:
- `runner.run("kb.open")` calls a new `openKnowledgeBase` handler
- `runner.run("kb.close")` calls a new `closeKnowledgeBase` handler

- [ ] **Step 2: Run the targeted action runner test to verify it fails**

Run: `corepack pnpm vitest run src/menu/menuActionRunner.test.ts`
Expected: FAIL because those action ids and handlers do not exist yet.

- [ ] **Step 3: Implement the new action ids in the action runner**

Update `src/menu/menuActionRunner.ts` to:
- add `openKnowledgeBase?: () => MaybePromise`
- add `closeKnowledgeBase?: () => MaybePromise`
- route `kb.open` and `kb.close` through `requireHandler`

- [ ] **Step 4: Run the targeted action runner test to verify it passes**

Run: `corepack pnpm vitest run src/menu/menuActionRunner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/menu/menuActionRunner.ts src/menu/menuActionRunner.test.ts
git commit -m "feat: add knowledge base menu actions"
```

## Task 4: Implement Shortcuts And About Dialog Components

**Files:**
- Create: `src/components/Help/ShortcutsDialog.tsx`
- Create: `src/components/Help/AboutDialog.tsx`
- Create: `src/components/Help/ShortcutsDialog.test.tsx`
- Create: `src/components/Help/AboutDialog.test.tsx`
- Test: `src/components/Help/ShortcutsDialog.test.tsx`
- Test: `src/components/Help/AboutDialog.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Create tests that verify:
- `ShortcutsDialog` renders the three sections and closes via close button, overlay click, and `Escape`
- `AboutDialog` renders app name, version, stack text, and closes via the same paths

- [ ] **Step 2: Run the targeted dialog tests to verify they fail**

Run: `corepack pnpm vitest run src/components/Help/ShortcutsDialog.test.tsx src/components/Help/AboutDialog.test.tsx`
Expected: FAIL because the files do not exist.

- [ ] **Step 3: Implement minimal dialog components**

Create `src/components/Help/ShortcutsDialog.tsx` with:
- props `{ open: boolean; onClose: () => void }`
- modal markup using `role="dialog"` and `aria-modal="true"`
- sections for 全局, 编辑与布局, 搜索
- `useEffect` escape listener only when open
- overlay click to close and panel click stop propagation

Create `src/components/Help/AboutDialog.tsx` with:
- props `{ open: boolean; onClose: () => void }`
- same modal mechanics
- content for app name, version `0.1.0`, product summary, and stack summary

- [ ] **Step 4: Run the targeted dialog tests to verify they pass**

Run: `corepack pnpm vitest run src/components/Help/ShortcutsDialog.test.tsx src/components/Help/AboutDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Help/ShortcutsDialog.tsx src/components/Help/AboutDialog.tsx src/components/Help/ShortcutsDialog.test.tsx src/components/Help/AboutDialog.test.tsx
git commit -m "feat: add help dialogs"
```

## Task 5: Wire AppShell To Menu Actions, Knowledge-Base Open/Close, And Help Dialogs

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Test: `src/components/AppShell.test.tsx`

- [ ] **Step 1: Write failing AppShell tests for menu action wiring**

Add tests in `src/components/AppShell.test.tsx` asserting that:
- invoking `kb.close` clears `kb` and editor current note state
- invoking `help.shortcuts` renders the shortcuts dialog
- invoking `help.about` renders the about dialog
- the menu passed to `useAppMenu` has `mynote` as the first top-level id and no top-level `ai`

- [ ] **Step 2: Run the targeted AppShell test to verify it fails**

Run: `corepack pnpm vitest run src/components/AppShell.test.tsx`
Expected: FAIL because AppShell does not yet support these actions or dialogs.

- [ ] **Step 3: Implement minimal AppShell wiring**

Update `src/components/AppShell.tsx` to:
- import and render the two help dialog components
- hold local `shortcutsOpen` and `aboutOpen` state
- add an `openKnowledgeBase` handler that uses `@tauri-apps/plugin-dialog` `open({ directory: true, multiple: false })`, then calls `api.openKnowledgeBase(selected)` and `refreshNoteTree()`
- add a `closeKnowledgeBase` handler that clears `useAppStore` and `useEditorStore` state back to the welcome-screen baseline
- map menu handlers `openKnowledgeBase`, `closeKnowledgeBase`, `openShortcuts`, and `openAbout`

- [ ] **Step 4: Run the targeted AppShell test to verify it passes**

Run: `corepack pnpm vitest run src/components/AppShell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.test.tsx
git commit -m "feat: wire mynote menu actions"
```

## Task 6: Run Focused Regression For The Whole Slice

**Files:**
- Modify: none
- Test: `src/menu/menuSchema.test.ts`
- Test: `src/menu/useAppMenu.test.tsx`
- Test: `src/menu/menuActionRunner.test.ts`
- Test: `src/components/AppShell.test.tsx`
- Test: `src/components/Help/ShortcutsDialog.test.tsx`
- Test: `src/components/Help/AboutDialog.test.tsx`

- [ ] **Step 1: Run the full focused regression suite**

Run: `corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/useAppMenu.test.tsx src/menu/menuActionRunner.test.ts src/components/AppShell.test.tsx src/components/Help/ShortcutsDialog.test.tsx src/components/Help/AboutDialog.test.tsx`
Expected: PASS

- [ ] **Step 2: If a test fails, fix only the touched slice and rerun the same suite**

Do not widen scope. Repair only menu structure, AppShell wiring, or help dialog behavior until the suite is green.

- [ ] **Step 3: Commit the verified slice**

```bash
git add src/menu/menuIds.ts src/menu/menuSchema.ts src/menu/useAppMenu.ts src/menu/menuActionRunner.ts src/components/AppShell.tsx src/components/Help/ShortcutsDialog.tsx src/components/Help/AboutDialog.tsx src/menu/menuSchema.test.ts src/menu/useAppMenu.test.tsx src/menu/menuActionRunner.test.ts src/components/AppShell.test.tsx src/components/Help/ShortcutsDialog.test.tsx src/components/Help/AboutDialog.test.tsx
git commit -m "feat: rebuild app menu and help dialogs"
```

## Self-Review

- Spec coverage: covered menu restructuring, AI submenu nesting, open/close knowledge base actions, help dialog implementation, and focused regression.
- Placeholder scan: no TBD, TODO, or vague "add tests" steps remain.
- Type consistency: plan uses `kb.open`, `kb.close`, `mynote` top-level id, `mynote.ai` nested submenu, and the same handler names across schema, runner, and AppShell tasks.

# Notebook Delete Confirmation Compact Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the inline notebook delete confirmation actions into compact icon-plus-short-label buttons while preserving the confirmation text, danger emphasis, accessibility, and existing success/failure behavior.

**Architecture:** Keep the existing inline confirmation flow in the file tree and only restyle the right-side action controls. The implementation stays local to the file tree component and its tests so the behavior contract remains unchanged while the visual weight of the confirmation strip is reduced.

**Tech Stack:** React 19, TypeScript, inline style objects, Vitest, Testing Library

---

## File Structure

- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
  - Replace the large text action buttons in the notebook delete confirmation strip with compact icon-plus-label buttons.
  - Reuse the existing inline visual language and keep current `aria-label` values stable.
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`
  - Add regression assertions for the new compact button text and preserve existing delete success/failure coverage.
- Reference: `docs/superpowers/specs/2026-06-16-notebook-delete-confirmation-compact-actions-design.md`
  - Source of truth for the approved UI scope.

### Task 1: Lock the expected confirmation UI in tests

**Files:**
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`
- Test: `src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders compact delete confirmation actions with short labels", async () => {
  const user = userEvent.setup();

  render(<FileTreePanel />);

  await user.hover(screen.getByRole("button", { name: "空笔记本" }));
  const deleteNotebookButton = screen.getByRole("button", { name: "删除笔记本 空笔记本" });
  await waitFor(() => expect(deleteNotebookButton).toBeVisible());
  fireEvent.click(deleteNotebookButton);

  const confirmButton = screen.getByRole("button", { name: "确认删除笔记本 空笔记本" });
  const cancelButton = screen.getByRole("button", { name: "取消删除笔记本 空笔记本" });

  expect(confirmButton).toHaveTextContent("删");
  expect(cancelButton).toHaveTextContent("取消");
  expect(confirmButton).not.toHaveTextContent("删除");
  expect(screen.getByText("确认删除该笔记本？")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx -t "renders compact delete confirmation actions with short labels"`
Expected: FAIL because the current confirm button still renders the full text `删除` instead of the short label `删`.

- [ ] **Step 3: Commit**

```bash
git add src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "test: pin compact notebook delete confirmation actions"
```

### Task 2: Implement compact icon-plus-label confirmation actions

**Files:**
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Test: `src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Write minimal implementation**

Update the confirmation strip to use compact controls and short labels. Keep the existing `aria-label` strings intact.

```tsx
notebookDeleteConfirmation={(
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: "6px 8px",
      borderRadius: 8,
      border: "1px solid #fecaca",
      background: "#fff5f5",
    }}
  >
    <span style={{ fontSize: 12, color: "#7a271a", lineHeight: 1.4 }}>确认删除该笔记本？</span>
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <button
        type="button"
        aria-label={`确认删除笔记本 ${node.name}`}
        onClick={() => void handleDeleteNotebook(node.path)}
        style={{
          height: 20,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "0 6px",
          borderRadius: 999,
          border: "1px solid #f5c2c7",
          background: "#fee2e2",
          color: "#b42318",
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        <DeleteNotebookIcon />
        <span>删</span>
      </button>
      <button
        type="button"
        aria-label={`取消删除笔记本 ${node.name}`}
        onClick={() => toggleNotebookDeleteConfirmation(node.path)}
        style={{
          height: 20,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "0 6px",
          borderRadius: 999,
          border: "1px solid #d0d7de",
          background: "#fff",
          color: "#667085",
          fontSize: 11,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true">×</span>
        <span>取消</span>
      </button>
    </div>
  </div>
)}
```

If the close glyph needs consistent stroke styling, add a small `CloseIcon` component near the existing inline icons instead of using the multiplication character.

- [ ] **Step 2: Run the focused test to verify it passes**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx -t "renders compact delete confirmation actions with short labels"`
Expected: PASS

- [ ] **Step 3: Run adjacent confirmation tests**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx -t "creates a lightweight inline confirmation when deleting an empty notebook|shows a lightweight delete confirmation inline and keeps it open on delete failure|extracts a readable message when notebook deletion rejects with an error object"`
Expected: PASS, proving the visual change did not break delete success/failure behavior.

- [ ] **Step 4: Commit**

```bash
git add src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "feat: compact notebook delete confirmation actions"
```

### Task 3: Validate the touched slice and hand off safely

**Files:**
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Run the full FileTreePanel test file**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx`
Expected: PASS with all file-tree panel tests green.

- [ ] **Step 2: Run the front-end build**

Run: `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm build`
Expected: PASS with `tsc && vite build` succeeding.

- [ ] **Step 3: Review the final diff for scope control**

Run: `git --no-pager diff -- src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx`
Expected: only the notebook delete confirmation strip UI and its tests changed.

- [ ] **Step 4: Commit**

```bash
git add src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "chore: verify compact notebook delete confirmation"
```

## Self-Review

- Spec coverage: the plan covers compact icon-plus-label buttons, preserved prompt text, preserved danger emphasis, preserved accessibility labels, preserved delete success/failure behavior, and scoped validation.
- Placeholder scan: no `TBD`, `TODO`, or unnamed “appropriate handling” steps remain.
- Type consistency: the plan only reuses existing `DeleteNotebookIcon`, `handleDeleteNotebook`, and `toggleNotebookDeleteConfirmation` identifiers already present in the component.

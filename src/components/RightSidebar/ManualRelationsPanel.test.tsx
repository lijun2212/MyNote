import { StrictMode, act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualRelationsPanel } from "./ManualRelationsPanel";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import { useAppStore } from "../../store/useAppStore";
import { makeKnowledgeBase, makeSearchResult } from "../../test/testData";
import type { NoteRelations, RelationItem } from "../../types";

const hookMocks = vi.hoisted(() => ({
  openNote: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

const apiMocks = vi.hoisted(() => ({
  listRelations: vi.fn(),
  searchNotes: vi.fn(),
  createRelation: vi.fn(),
  deleteRelation: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({ openNote: hookMocks.openNote }),
}));

function makeRelationItem(overrides: Partial<RelationItem> = {}): RelationItem {
  return {
    id: "rel-1",
    relation_type: "related",
    description: null,
    note_id: "note-2",
    note_title: "目标笔记",
    note_path: "notes/target.md",
    created_at: "2026-05-31T00:00:00Z",
    updated_at: "2026-05-31T00:00:00Z",
    ...overrides,
  };
}

function makeRelations(overrides: Partial<NoteRelations> = {}): NoteRelations {
  return {
    outgoing: [],
    incoming: [],
    ...overrides,
  };
}

function renderPanel(noteId: string | null = "note-1") {
  return render(<ManualRelationsPanel noteId={noteId} />);
}

function renderWithContextMenu(noteId: string | null = "note-1") {
  return render(
    <ContextMenuProvider>
      <ManualRelationsPanel noteId={noteId} />
      <ContextMenuHost />
    </ContextMenuProvider>,
  );
}

function renderPanelInStrictMode(noteId: string | null = "note-1") {
  return render(
    <StrictMode>
      <ManualRelationsPanel noteId={noteId} />
    </StrictMode>,
  );
}

beforeEach(() => {
  apiMocks.listRelations.mockReset();
  apiMocks.searchNotes.mockReset();
  apiMocks.createRelation.mockReset();
  apiMocks.deleteRelation.mockReset();
  hookMocks.openNote.mockReset();
  hookMocks.openNote.mockResolvedValue(undefined);

  useAppStore.setState({ kb: makeKnowledgeBase({ id: "kb-1" }) });
});

describe("ManualRelationsPanel", () => {
  it("shows an empty state when no note is selected", () => {
    renderPanel(null);

    expect(screen.getByText("选择笔记以管理关联")).toBeInTheDocument();
    expect(apiMocks.listRelations).not.toHaveBeenCalled();
  });

  it("loads relations and shows a no-relations empty state", async () => {
    apiMocks.listRelations.mockResolvedValue(makeRelations());
    renderPanel();

    expect(screen.getByText("加载中...")).toBeInTheDocument();

    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledWith("note-1"));
    expect(await screen.findByText("暂无手动关系")).toBeInTheDocument();
  });

  it("creates a relation successfully and reloads the list", async () => {
    const user = userEvent.setup();
    apiMocks.listRelations
      .mockResolvedValueOnce(makeRelations())
      .mockResolvedValueOnce(makeRelations({
        outgoing: [
          makeRelationItem({
            id: "rel-2",
            relation_type: "supports",
            description: "补充说明",
            note_id: "note-2",
            note_title: "第二篇笔记",
          }),
        ],
      }));
    apiMocks.searchNotes.mockResolvedValue([
      makeSearchResult({ note_id: "note-1", title: "当前笔记" }),
      makeSearchResult({ note_id: "note-2", title: "第二篇笔记", path: "notes/two.md" }),
    ]);
    apiMocks.createRelation.mockResolvedValue({ id: "rel-2" });

    renderPanel();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "第二");

    await waitFor(() => expect(apiMocks.searchNotes).toHaveBeenCalledWith("第二", "kb-1"));
    expect(screen.queryByText("当前笔记")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "第二篇笔记" }));
    await user.selectOptions(screen.getByLabelText("关系类型"), "supports");
    await user.type(screen.getByLabelText("说明"), "补充说明");
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    await waitFor(() => {
      expect(apiMocks.createRelation).toHaveBeenCalledWith("note-1", "note-2", "supports", "补充说明");
    });
    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("第二篇笔记")).toBeInTheDocument();
    expect(screen.getByText("补充说明")).toBeInTheDocument();
  });

  it("shows a duplicate-relation error when create fails with duplicate", async () => {
    const user = userEvent.setup();
    apiMocks.listRelations.mockResolvedValue(makeRelations());
    apiMocks.searchNotes.mockResolvedValue([
      makeSearchResult({ note_id: "note-2", title: "第二篇笔记", path: "notes/two.md" }),
    ]);
    apiMocks.createRelation.mockRejectedValue(new Error("duplicate relation"));

    renderPanel();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "第二");
    await screen.findByRole("button", { name: "第二篇笔记" });
    await user.click(screen.getByRole("button", { name: "第二篇笔记" }));
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    expect(await screen.findByText("该关系已存在")).toBeInTheDocument();
    expect(apiMocks.listRelations).toHaveBeenCalledTimes(1);
  });

  it("shows a duplicate-relation error when create fails with a serialized backend payload", async () => {
    const user = userEvent.setup();
    apiMocks.listRelations.mockResolvedValue(makeRelations());
    apiMocks.searchNotes.mockResolvedValue([
      makeSearchResult({ note_id: "note-2", title: "第二篇笔记", path: "notes/two.md" }),
    ]);
    apiMocks.createRelation.mockRejectedValue({
      kind: "AlreadyExists",
      error: "manual relation already exists",
    });

    renderPanel();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "第二");
    await screen.findByRole("button", { name: "第二篇笔记" });
    await user.click(screen.getByRole("button", { name: "第二篇笔记" }));
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    expect(await screen.findByText("该关系已存在")).toBeInTheDocument();
    expect(apiMocks.listRelations).toHaveBeenCalledTimes(1);
  });

  it("deletes an outgoing relation and reloads", async () => {
    const user = userEvent.setup();
    apiMocks.listRelations
      .mockResolvedValueOnce(makeRelations({
        outgoing: [
          makeRelationItem({
            id: "rel-3",
            relation_type: "extension",
            note_title: "扩展笔记",
          }),
        ],
        incoming: [
          makeRelationItem({
            id: "rel-4",
            relation_type: "supports",
            note_id: "note-5",
            note_title: "引用它的笔记",
          }),
        ],
      }))
      .mockResolvedValueOnce(makeRelations());
    apiMocks.deleteRelation.mockResolvedValue(undefined);

    renderPanel();

    const outgoingSection = await screen.findByTestId("manual-relations-outgoing");
    expect(within(outgoingSection).getByText("扩展笔记")).toBeInTheDocument();
    expect(screen.getByText("引用它的笔记")).toBeInTheDocument();

    await user.click(within(outgoingSection).getByRole("button", { name: "删除关系 扩展笔记" }));

    await waitFor(() => expect(apiMocks.deleteRelation).toHaveBeenCalledWith("rel-3"));
    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("暂无手动关系")).toBeInTheDocument();
  });

  it("clears form state when noteId switches to another note", async () => {
    const user = userEvent.setup();
    apiMocks.listRelations.mockResolvedValue(makeRelations());
    apiMocks.searchNotes.mockResolvedValue([
      makeSearchResult({ note_id: "note-2", title: "第二篇笔记", path: "notes/two.md" }),
    ]);

    const view = renderPanel();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "第二");
    await screen.findByRole("button", { name: "第二篇笔记" });
    await user.click(screen.getByRole("button", { name: "第二篇笔记" }));
    await user.selectOptions(screen.getByLabelText("关系类型"), "supports");
    await user.type(screen.getByLabelText("说明"), "切换前说明");

    expect(screen.getByDisplayValue("第二")).toBeInTheDocument();
    expect(screen.getByText("已选择：第二篇笔记")).toBeInTheDocument();
    expect(screen.getByDisplayValue("切换前说明")).toBeInTheDocument();

    view.rerender(<ManualRelationsPanel noteId="note-9" />);

    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenLastCalledWith("note-9"));
    expect(screen.queryByPlaceholderText("搜索目标笔记")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加关系" }));

    expect(screen.getByPlaceholderText("搜索目标笔记")).toHaveValue("");
    expect(screen.getByLabelText("关系类型")).toHaveValue("related");
    expect(screen.getByLabelText("说明")).toHaveValue("");
    expect(screen.queryByText("已选择：第二篇笔记")).not.toBeInTheDocument();
  });

  it("ignores stale listRelations results after rerender to a new noteId", async () => {
    const oldRelationsRequest = createDeferred<NoteRelations>();
    const newRelationsRequest = createDeferred<NoteRelations>();

    apiMocks.listRelations
      .mockReturnValueOnce(oldRelationsRequest.promise)
      .mockReturnValueOnce(newRelationsRequest.promise);

    const view = renderPanel();

    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenNthCalledWith(1, "note-1"));

    view.rerender(<ManualRelationsPanel noteId="note-9" />);

    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenNthCalledWith(2, "note-9"));

    newRelationsRequest.resolve(makeRelations({
      outgoing: [
        makeRelationItem({
          id: "rel-new",
          note_id: "note-10",
          note_title: "新笔记关系",
        }),
      ],
    }));

    expect(await screen.findByText("新笔记关系")).toBeInTheDocument();

    oldRelationsRequest.resolve(makeRelations({
      outgoing: [
        makeRelationItem({
          id: "rel-old",
          note_id: "note-2",
          note_title: "旧笔记关系",
        }),
      ],
    }));

    await waitFor(() => {
      expect(screen.queryByText("旧笔记关系")).not.toBeInTheDocument();
    });
    expect(screen.getByText("新笔记关系")).toBeInTheDocument();
  });

  it("ignores stale search results after noteId changes", async () => {
    const user = userEvent.setup();
    const oldSearchRequest = createDeferred<ReturnType<typeof makeSearchResult>[]>();

    apiMocks.listRelations.mockResolvedValue(makeRelations());
    apiMocks.searchNotes.mockImplementation((query: string) => {
      if (query === "旧") {
        return oldSearchRequest.promise;
      }

      if (query === "新") {
        return Promise.resolve([]);
      }

      return Promise.resolve([]);
    });

    const view = renderPanel();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "旧");

    await waitFor(() => expect(apiMocks.searchNotes).toHaveBeenNthCalledWith(1, "旧", "kb-1"));

    view.rerender(<ManualRelationsPanel noteId="note-9" />);

    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenLastCalledWith("note-9"));

    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "新");

    await waitFor(() => expect(apiMocks.searchNotes).toHaveBeenCalledWith("新", "kb-1"));
    expect(await screen.findByText("未找到匹配笔记")).toBeInTheDocument();

    oldSearchRequest.resolve([
      makeSearchResult({ note_id: "note-2", title: "旧搜索结果", path: "notes/old.md" }),
    ]);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "旧搜索结果" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("未找到匹配笔记")).toBeInTheDocument();
  });

  it("ignores stale search results after the form is closed", async () => {
    const user = userEvent.setup();
    const oldSearchRequest = createDeferred<ReturnType<typeof makeSearchResult>[]>();

    apiMocks.listRelations.mockResolvedValue(makeRelations());
    apiMocks.searchNotes
      .mockReturnValueOnce(oldSearchRequest.promise)
      .mockResolvedValueOnce([]);

    renderPanel();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "旧");

    await waitFor(() => expect(apiMocks.searchNotes).toHaveBeenNthCalledWith(1, "旧", "kb-1"));

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByPlaceholderText("搜索目标笔记")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "新");

    await waitFor(() => expect(apiMocks.searchNotes).toHaveBeenNthCalledWith(2, "新", "kb-1"));
    expect(await screen.findByText("未找到匹配笔记")).toBeInTheDocument();

    oldSearchRequest.resolve([
      makeSearchResult({ note_id: "note-3", title: "已关闭表单的旧结果", path: "notes/closed.md" }),
    ]);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "已关闭表单的旧结果" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("未找到匹配笔记")).toBeInTheDocument();
  });

  it("does not start a stale create reload after rerender to a new noteId", async () => {
    const user = userEvent.setup();
    const createRelationRequest = createDeferred<{ id: string }>();

    apiMocks.listRelations
      .mockResolvedValueOnce(makeRelations())
      .mockResolvedValueOnce(makeRelations({
        outgoing: [
          makeRelationItem({
            id: "rel-new",
            note_id: "note-10",
            note_title: "新笔记关系",
          }),
        ],
      }));
    apiMocks.searchNotes.mockResolvedValue([
      makeSearchResult({ note_id: "note-2", title: "第二篇笔记", path: "notes/two.md" }),
    ]);
    apiMocks.createRelation.mockReturnValue(createRelationRequest.promise);

    const view = renderPanel();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "第二");
    await screen.findByRole("button", { name: "第二篇笔记" });
    await user.click(screen.getByRole("button", { name: "第二篇笔记" }));
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    await waitFor(() => expect(apiMocks.createRelation).toHaveBeenCalledWith("note-1", "note-2", "related", undefined));

    view.rerender(<ManualRelationsPanel noteId="note-9" />);

    expect(await screen.findByText("新笔记关系")).toBeInTheDocument();

    createRelationRequest.resolve({ id: "rel-old" });

    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(apiMocks.createRelation).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("旧笔记关系")).not.toBeInTheDocument();
    expect(screen.getByText("新笔记关系")).toBeInTheDocument();
  });

  it("does not reload relations after unmount when create completes", async () => {
    const user = userEvent.setup();
    const createRelationRequest = createDeferred<{ id: string }>();

    apiMocks.listRelations.mockResolvedValue(makeRelations());
    apiMocks.searchNotes.mockResolvedValue([
      makeSearchResult({ note_id: "note-2", title: "第二篇笔记", path: "notes/two.md" }),
    ]);
    apiMocks.createRelation.mockReturnValue(createRelationRequest.promise);

    const view = renderPanel();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "第二");
    await screen.findByRole("button", { name: "第二篇笔记" });
    await user.click(screen.getByRole("button", { name: "第二篇笔记" }));
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    await waitFor(() => expect(apiMocks.createRelation).toHaveBeenCalledWith("note-1", "note-2", "related", undefined));

    view.unmount();

    await act(async () => {
      createRelationRequest.resolve({ id: "rel-2" });
      await Promise.resolve();
    });

    expect(apiMocks.listRelations).toHaveBeenCalledTimes(1);
  });

  it("reloads relations after create completes in StrictMode", async () => {
    const user = userEvent.setup();
    const createRelationRequest = createDeferred<{ id: string }>();

    apiMocks.listRelations
      .mockResolvedValueOnce(makeRelations())
      .mockResolvedValueOnce(makeRelations())
      .mockResolvedValueOnce(makeRelations({
        outgoing: [
          makeRelationItem({
            id: "rel-strict",
            note_id: "note-2",
            note_title: "StrictMode 新关系",
          }),
        ],
      }));
    apiMocks.searchNotes.mockResolvedValue([
      makeSearchResult({ note_id: "note-2", title: "第二篇笔记", path: "notes/two.md" }),
    ]);
    apiMocks.createRelation.mockReturnValue(createRelationRequest.promise);

    renderPanelInStrictMode();

    await screen.findByText("暂无手动关系");
    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "第二");
    await screen.findByRole("button", { name: "第二篇笔记" });
    await user.click(screen.getByRole("button", { name: "第二篇笔记" }));
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    await waitFor(() => expect(apiMocks.createRelation).toHaveBeenCalledWith("note-1", "note-2", "related", undefined));

    await act(async () => {
      createRelationRequest.resolve({ id: "rel-strict" });
      await Promise.resolve();
    });

    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("StrictMode 新关系")).toBeInTheDocument();
  });

  it("opens the relation-blank context menu and can open the add-relation form", async () => {
    const user = userEvent.setup();
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    renderWithContextMenu();

    await screen.findByText("暂无手动关系");

    fireEvent.contextMenu(screen.getByTestId("manual-relations-surface"), {
      clientX: 56,
      clientY: 80,
    });

    expect(await screen.findByRole("menuitem", { name: "创建关系" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "刷新关系" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "显示侧栏" })).toHaveAttribute("aria-disabled", "false");

    await user.click(screen.getByRole("menuitem", { name: "创建关系" }));

    expect(await screen.findByPlaceholderText("搜索目标笔记")).toBeInTheDocument();
  });

  it("deletes a relation from the relation-item context menu through the shared host", async () => {
    const user = userEvent.setup();
    apiMocks.listRelations
      .mockResolvedValueOnce(makeRelations({
        outgoing: [
          makeRelationItem({
            id: "rel-context-delete",
            note_title: "待删除关系",
          }),
        ],
      }))
      .mockResolvedValueOnce(makeRelations());
    apiMocks.deleteRelation.mockResolvedValue(undefined);

    renderWithContextMenu();

    const relationItem = (await screen.findByText("待删除关系")).closest("[data-relation-item='true']") as HTMLElement | null;
    expect(relationItem).not.toBeNull();

    fireEvent.contextMenu(relationItem as HTMLElement, {
      clientX: 32,
      clientY: 48,
    });

    expect(await screen.findByRole("menuitem", { name: "删除关系" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "查看目标笔记" })).toHaveAttribute("aria-disabled", "false");

    await user.click(screen.getByRole("menuitem", { name: "删除关系" }));

    await waitFor(() => expect(apiMocks.deleteRelation).toHaveBeenCalledWith("rel-context-delete"));
    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledTimes(2));
  });

  it("disables view-target-note in the relation-item context menu when notePath is missing", async () => {
    apiMocks.listRelations.mockResolvedValue(makeRelations({
      outgoing: [
        makeRelationItem({
          id: "rel-missing-path",
          note_title: "缺少路径关系",
          note_path: "",
        }),
      ],
    }));

    renderWithContextMenu();

    const relationItem = (await screen.findByText("缺少路径关系")).closest("[data-relation-item='true']") as HTMLElement | null;
    expect(relationItem).not.toBeNull();

    fireEvent.contextMenu(relationItem as HTMLElement, {
      clientX: 40,
      clientY: 64,
    });

    expect(await screen.findByRole("menuitem", { name: "查看目标笔记" })).toHaveAttribute("aria-disabled", "true");
  });
});
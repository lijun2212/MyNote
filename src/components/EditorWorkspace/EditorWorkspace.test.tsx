import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorWorkspace } from "./EditorWorkspace";
import { useEditorStore } from "../../store/useEditorStore";
import { useProjectionStore } from "../../store/useProjectionStore";
import { useSearchSessionStore } from "../../store/useSearchSessionStore";
import { deferred, makeNote, makeSearchResult } from "../../test/testData";

const projectionWindowApiMocks = vi.hoisted(() => ({
  openProjectionWindow: vi.fn(),
  closeProjectionWindow: vi.fn().mockResolvedValue(undefined),
  emitProjectionState: vi.fn().mockResolvedValue(undefined),
  getProjectionWindowCapabilities: vi.fn(() => ({
    supportsExternalMonitorPlacement: false,
    supportsFullscreenProjection: true,
  })),
}));

const capturedProps = vi.hoisted(() => ({
  editor: null as Record<string, unknown> | null,
  preview: null as Record<string, unknown> | null,
}));

const lookbackSummaryState = vi.hoisted(() => ({
  candidate: "候选摘要",
  savedSummary: "已保存摘要",
  hasSummary: true,
  isGenerating: false,
  isSaving: false,
  error: null as string | null,
  generationStatus: null as string | null,
  generateCandidate: vi.fn(),
  saveCandidate: vi.fn(),
  clearSummary: vi.fn(),
  setCandidate: vi.fn(),
}));

const openNoteMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>());
const beginOpenNoteMock = vi.hoisted(() => vi.fn(() => 301));
const isOpenNoteRequestCurrentMock = vi.hoisted(() => vi.fn<(requestId?: unknown) => boolean>(() => true));

vi.mock("../../hooks/useAutoSave", () => ({
  useAutoSave: () => undefined,
}));

vi.mock("../../hooks/useEditorSplitResize", () => ({
  useEditorSplitResize: () => ({
    editorRatio: 50,
    isResizing: false,
    minRatio: 20,
    maxRatio: 80,
    startResize: vi.fn(),
    resize: vi.fn(),
    stopResize: vi.fn(),
  }),
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({
    openNote: openNoteMock,
    beginOpenNote: beginOpenNoteMock,
    isOpenNoteRequestCurrent: isOpenNoteRequestCurrentMock,
  }),
}));

vi.mock("../../hooks/useLookbackSummary", () => ({
  useLookbackSummary: () => lookbackSummaryState,
}));

vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: (props: Record<string, unknown>) => {
    capturedProps.editor = props;
    return <div data-testid="mock-editor" />;
  },
}));

vi.mock("./MarkdownPreview", () => ({
  MarkdownPreview: (props: Record<string, unknown>) => {
    capturedProps.preview = props;
    return <div data-testid="mock-preview" />;
  },
}));

vi.mock("../../projection/windowApi", () => ({
  openProjectionWindow: projectionWindowApiMocks.openProjectionWindow,
  closeProjectionWindow: projectionWindowApiMocks.closeProjectionWindow,
  emitProjectionState: projectionWindowApiMocks.emitProjectionState,
  getProjectionWindowCapabilities: projectionWindowApiMocks.getProjectionWindowCapabilities,
}));

describe("EditorWorkspace", () => {
  beforeEach(() => {
    capturedProps.editor = null;
    capturedProps.preview = null;
    openNoteMock.mockReset();
    beginOpenNoteMock.mockClear();
    isOpenNoteRequestCurrentMock.mockClear();
    lookbackSummaryState.hasSummary = true;
    lookbackSummaryState.candidate = "候选摘要";
    lookbackSummaryState.savedSummary = "已保存摘要";
    lookbackSummaryState.isGenerating = false;
    lookbackSummaryState.isSaving = false;
    lookbackSummaryState.error = null;
    lookbackSummaryState.generationStatus = null;
    lookbackSummaryState.generateCandidate.mockReset();
    lookbackSummaryState.saveCandidate.mockReset();
    lookbackSummaryState.clearSummary.mockReset();
    lookbackSummaryState.setCandidate.mockReset();
    useSearchSessionStore.getState().resetForTest();
    useProjectionStore.getState().resetForTest();
    projectionWindowApiMocks.openProjectionWindow.mockReset();
    projectionWindowApiMocks.closeProjectionWindow.mockReset();
    projectionWindowApiMocks.closeProjectionWindow.mockResolvedValue(undefined);
    projectionWindowApiMocks.emitProjectionState.mockReset();
    projectionWindowApiMocks.emitProjectionState.mockResolvedValue(undefined);
    projectionWindowApiMocks.getProjectionWindowCapabilities.mockReset();
    projectionWindowApiMocks.getProjectionWindowCapabilities.mockReturnValue({
      supportsExternalMonitorPlacement: false,
      supportsFullscreenProjection: true,
    });
    useEditorStore.setState({
      currentNote: makeNote({ path: "notes/demo.md", title: "Demo" }),
      content: "# Demo\n\nBody",
      isOpeningNote: false,
      openingNotePath: null,
      isComposing: false,
      isDirty: false,
      isSaving: false,
      saveError: null,
      saveStatus: "saved",
      showPreview: true,
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    });
  });

  it("renders editor and preview below the title bar for the open note", () => {
    render(<EditorWorkspace />);

    const title = screen.getByText("Demo");
    const editor = screen.getByTestId("mock-editor");

    expect(title.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows opening hint when no note is loaded yet", () => {
    useEditorStore.setState({
      currentNote: null,
      content: "",
      isOpeningNote: true,
      openingNotePath: "notes/slow.md",
    });

    render(<EditorWorkspace />);

    expect(screen.getByText("正在加载笔记...")).toBeInTheDocument();
  });

  it("triggers summary candidate actions without auto-saving", async () => {
    const user = userEvent.setup();
    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "展开摘要" }));
    await user.click(screen.getByRole("button", { name: "重新生成" }));
    await user.click(screen.getByRole("button", { name: "保存摘要" }));
    await user.click(screen.getByRole("button", { name: "删除摘要" }));

    expect(lookbackSummaryState.generateCandidate).toHaveBeenCalledTimes(1);
    expect(lookbackSummaryState.saveCandidate).toHaveBeenCalledTimes(1);
    expect(lookbackSummaryState.clearSummary).toHaveBeenCalledTimes(1);
  });

  it("keeps the summary region hidden by default and expands it from the top toolbar", async () => {
    const user = userEvent.setup();
    render(<EditorWorkspace />);

    expect(screen.queryByLabelText("回看摘要")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开摘要" }));

    expect(screen.getByLabelText("回看摘要")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除摘要" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "隐藏摘要" })).toBeInTheDocument();
  });

  it("hides the summary region again from the top toolbar", async () => {
    const user = userEvent.setup();
    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "展开摘要" }));
    await user.click(screen.getByRole("button", { name: "隐藏摘要" }));

    expect(screen.queryByLabelText("回看摘要")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开摘要" })).toBeInTheDocument();
  });

  it("collapses the summary region after deleting a saved summary", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "展开摘要" }));
    await user.click(screen.getByRole("button", { name: "删除摘要" }));

    lookbackSummaryState.hasSummary = false;
    lookbackSummaryState.savedSummary = null;

    rerender(<EditorWorkspace />);

    expect(screen.queryByLabelText("回看摘要")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开摘要" })).toBeInTheDocument();
  });

  it("shows an open-projection button and toggles to close when enabled", () => {
    useProjectionStore.getState().resetForTest();
    const { rerender } = render(<EditorWorkspace />);

    expect(screen.getByRole("button", { name: "开启投影" })).toBeInTheDocument();

    useProjectionStore.getState().beginSession();
    rerender(<EditorWorkspace />);

    expect(screen.getByRole("button", { name: "关闭投影" })).toBeInTheDocument();
  });

  it("opens and closes the projection window from the toolbar button", async () => {
    const user = userEvent.setup();
    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "开启投影" }));

    expect(projectionWindowApiMocks.openProjectionWindow).toHaveBeenCalledTimes(1);
    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionRequested: true,
      projectionEnabled: true,
      projectionWindowReady: false,
    });

    await user.click(screen.getByRole("button", { name: "关闭投影" }));

    expect(projectionWindowApiMocks.closeProjectionWindow).toHaveBeenCalledTimes(1);
    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionRequested: false,
      projectionEnabled: false,
      projectionWindowReady: false,
    });
  });

  it("shows a manual placement hint after enabling projection when automatic external monitor placement is unavailable", async () => {
    const user = userEvent.setup();
    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "开启投影" }));

    expect(screen.getByText("请将投影窗口手动拖到副屏后再全屏展示")).toBeInTheDocument();
  });

  it("rolls back projection state when opening the projection window fails", async () => {
    const user = userEvent.setup();
    projectionWindowApiMocks.openProjectionWindow.mockRejectedValue(new Error("窗口创建失败"));

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "开启投影" }));

    expect(projectionWindowApiMocks.openProjectionWindow).toHaveBeenCalledTimes(1);
    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionRequested: false,
      projectionEnabled: false,
      projectionWindowReady: false,
      projectionLastError: "窗口创建失败",
    });
    expect(screen.getByRole("button", { name: "开启投影" })).toBeInTheDocument();
    expect(screen.getByText("窗口创建失败")).toBeInTheDocument();
  });

  it("passes only the latest navigation target to editor and preview", () => {
    useEditorStore.setState({
      searchNavigationTarget: {
        note_id: "note-1",
        note_path: "notes/demo.md",
        note_title: "Demo",
        line_start: 9,
        line_end: 9,
        occurrence_order: 1,
        match_text: "alpha",
        context_snippet: "alpha hit",
        source: "body",
        revision: 2,
      },
      tagNavigationTarget: {
        note_id: "note-1",
        note_path: "notes/demo.md",
        note_title: "Demo",
        note_updated_at: "2026-06-01T00:00:00Z",
        source: "inline",
        occurrence_order: 1,
        line_start: 3,
        line_end: 3,
        heading_context: null,
        context_snippet: "Body #阶段一",
        tag_name: "阶段一",
        revision: 1,
      },
    });

    render(<EditorWorkspace />);

    expect(capturedProps.editor?.searchNavigationTarget).toMatchObject({ revision: 2, line_start: 9 });
    expect(capturedProps.editor?.tagNavigationTarget).toBeNull();
    expect(capturedProps.preview?.searchNavigationTarget).toMatchObject({ revision: 2, line_start: 9 });
    expect(capturedProps.preview?.tagNavigationTarget).toBeNull();
  });

  it("renders the search session bar when the session is active", () => {
    useSearchSessionStore.getState().startSession({
      query: "alpha",
      results: [makeSearchResult({ title: "Demo", path: "notes/demo.md" })],
      currentIndex: 0,
    });

    render(<EditorWorkspace />);

    expect(screen.getByText("搜索会话：alpha")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一个命中" })).toBeInTheDocument();
  });

  it("navigates to the next session result across notes and updates the target", async () => {
    const user = userEvent.setup();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12345);
    openNoteMock.mockImplementation(async (path: unknown) => {
      useEditorStore.getState().setCurrentNote(makeNote({ path: path as string, title: "Next Note" }));
    });

    useSearchSessionStore.getState().startSession({
      query: "alpha",
      results: [
        makeSearchResult({
          note_id: "note-1",
          title: "Demo",
          path: "notes/demo.md",
          line_start: 3,
          line_end: 3,
          occurrence_order: 1,
        }),
        makeSearchResult({
          note_id: "note-2",
          title: "Next Note",
          path: "notes/next.md",
          line_start: 11,
          line_end: 11,
          occurrence_order: 2,
          match_text: "alpha",
          snippet: "Another <mark>alpha</mark> hit",
        }),
      ],
      currentIndex: 0,
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "下一个命中" }));

    await waitFor(() => {
      expect(openNoteMock).toHaveBeenCalledWith("notes/next.md", 301);
      expect(useSearchSessionStore.getState().session?.currentIndex).toBe(1);
      expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
        note_id: "note-2",
        note_path: "notes/next.md",
        note_title: "Next Note",
        line_start: 11,
        line_end: 11,
        occurrence_order: 2,
        context_snippet: "Another <mark>alpha</mark> hit",
        revision: 12345,
      });
    });

    nowSpy.mockRestore();
  });

  it("clears the search session and target when exiting the session bar", async () => {
    const user = userEvent.setup();

    useSearchSessionStore.getState().startSession({
      query: "alpha",
      results: [makeSearchResult({ title: "Demo", path: "notes/demo.md" })],
      currentIndex: 0,
    });
    useEditorStore.getState().setSearchNavigationTarget({
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 3,
      line_end: 3,
      occurrence_order: 1,
      match_text: "alpha",
      source: "body",
      context_snippet: "alpha hit",
      revision: 9,
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "退出搜索会话" }));

    expect(useSearchSessionStore.getState().session).toBeNull();
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();
  });

  it("does not write back search navigation after exiting during an in-flight note change", async () => {
    const user = userEvent.setup();
    const pendingOpen = deferred<void>();

    openNoteMock.mockImplementation(() => pendingOpen.promise);

    useSearchSessionStore.getState().startSession({
      query: "alpha",
      results: [
        makeSearchResult({
          note_id: "note-1",
          title: "Demo",
          path: "notes/demo.md",
          line_start: 3,
          line_end: 3,
          occurrence_order: 1,
        }),
        makeSearchResult({
          note_id: "note-2",
          title: "Next Note",
          path: "notes/next.md",
          line_start: 11,
          line_end: 11,
          occurrence_order: 2,
          match_text: "alpha",
          snippet: "Another <mark>alpha</mark> hit",
        }),
      ],
      currentIndex: 0,
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "下一个命中" }));
    await user.click(screen.getByRole("button", { name: "退出搜索会话" }));

    expect(useSearchSessionStore.getState().session).toBeNull();
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();

    pendingOpen.resolve();
    await waitFor(() => expect(openNoteMock).toHaveBeenCalledWith("notes/next.md", 301));

    expect(useSearchSessionStore.getState().session).toBeNull();
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();
  });

  it("does not write back search navigation for a stale open-note request", async () => {
    const user = userEvent.setup();
    const firstOpen = deferred<void>();
    const secondOpen = deferred<void>();

    beginOpenNoteMock
      .mockReturnValueOnce(301)
      .mockReturnValueOnce(302);
    isOpenNoteRequestCurrentMock.mockImplementation((requestId: unknown) => requestId === 302);
    openNoteMock
      .mockImplementationOnce(async (path: unknown) => {
        await firstOpen.promise;
        useEditorStore.getState().setCurrentNote(makeNote({ path: path as string, title: "Next Note" }));
      })
      .mockImplementationOnce(async (path: unknown) => {
        await secondOpen.promise;
        useEditorStore.getState().setCurrentNote(makeNote({ path: path as string, title: "Next Note" }));
      });

    useSearchSessionStore.getState().startSession({
      query: "alpha",
      results: [
        makeSearchResult({
          note_id: "note-1",
          title: "Demo",
          path: "notes/demo.md",
          line_start: 3,
          line_end: 3,
          occurrence_order: 1,
        }),
        makeSearchResult({
          note_id: "note-2",
          title: "Next Note",
          path: "notes/next.md",
          line_start: 11,
          line_end: 11,
          occurrence_order: 2,
          match_text: "alpha",
          snippet: "Another <mark>alpha</mark> hit",
        }),
      ],
      currentIndex: 0,
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "下一个命中" }));
    await user.click(screen.getByRole("button", { name: "下一个命中" }));

    firstOpen.resolve();
    await waitFor(() => expect(openNoteMock).toHaveBeenCalledTimes(2));

    expect(useSearchSessionStore.getState().session?.currentIndex).toBe(0);
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();

    secondOpen.resolve();
    await waitFor(() => {
      expect(useSearchSessionStore.getState().session?.currentIndex).toBe(1);
      expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
        note_id: "note-2",
        note_path: "notes/next.md",
        line_start: 11,
        occurrence_order: 2,
      });
    });
  });

  it("does not write back search navigation after the session is replaced", async () => {
    const user = userEvent.setup();
    const pendingOpen = deferred<void>();

    openNoteMock.mockImplementation(async (path: unknown) => {
      await pendingOpen.promise;
      useEditorStore.getState().setCurrentNote(makeNote({ path: path as string, title: "Next Note" }));
    });

    useSearchSessionStore.getState().startSession({
      query: "alpha",
      results: [
        makeSearchResult({
          note_id: "note-1",
          title: "Demo",
          path: "notes/demo.md",
          line_start: 3,
          line_end: 3,
          occurrence_order: 1,
        }),
        makeSearchResult({
          note_id: "note-2",
          title: "Next Note",
          path: "notes/next.md",
          line_start: 11,
          line_end: 11,
          occurrence_order: 2,
          match_text: "alpha",
          snippet: "Another <mark>alpha</mark> hit",
        }),
      ],
      currentIndex: 0,
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "下一个命中" }));

    act(() => {
      useSearchSessionStore.getState().startSession({
        query: "beta",
        results: [makeSearchResult({ note_id: "note-3", title: "Beta", path: "notes/beta.md" })],
        currentIndex: 0,
      });
    });

    act(() => {
      pendingOpen.resolve();
    });
    await waitFor(() => expect(openNoteMock).toHaveBeenCalledWith("notes/next.md", 301));

    expect(useSearchSessionStore.getState().session).toMatchObject({
      query: "beta",
      currentIndex: 0,
    });
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();
  });

  it("handles N, B, and Escape while the search session is active", async () => {
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/demo.md", title: "Demo" }));
    useSearchSessionStore.getState().startSession({
      query: "nacos",
      results: [
        makeSearchResult({ note_id: "note-1", path: "notes/demo.md", title: "Demo", line_start: 3, occurrence_order: 1 }),
        makeSearchResult({ note_id: "note-1", path: "notes/demo.md", title: "Demo", line_start: 8, occurrence_order: 2 }),
      ],
      currentIndex: 0,
    });

    render(<EditorWorkspace />);

    fireEvent.keyDown(window, { key: "n" });
    await waitFor(() => {
      expect(useSearchSessionStore.getState().session?.currentIndex).toBe(1);
    });

    fireEvent.keyDown(window, { key: "b" });
    await waitFor(() => {
      expect(useSearchSessionStore.getState().session?.currentIndex).toBe(0);
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSearchSessionStore.getState().session).toBeNull();
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();
  });
});
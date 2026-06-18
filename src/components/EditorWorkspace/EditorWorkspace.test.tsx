import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorWorkspace } from "./EditorWorkspace";
import { useEditorStore } from "../../store/useEditorStore";
import { useProjectionStore } from "../../store/useProjectionStore";
import { useSearchSessionStore } from "../../store/useSearchSessionStore";
import { deferred, makeNote, makeSearchResult } from "../../test/testData";

const apiMocks = vi.hoisted(() => ({
  beautifyMarkdown: vi.fn(),
  beautifyMarkdownStream: vi.fn(),
  mapMarkdownBeautifyStreamEvent: vi.fn((event: unknown) => event),
}));

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
  listener: null as ((event: { payload: unknown }) => void) | null,
}));

const projectionWindowApiMocks = vi.hoisted(() => ({
  openProjectionWindow: vi.fn(),
  closeProjectionWindow: vi.fn().mockResolvedValue(undefined),
  emitProjectionState: vi.fn().mockResolvedValue(undefined),
  setProjectionWindowTitle: vi.fn().mockResolvedValue(undefined),
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
const splitResizeState = vi.hoisted(() => ({
  editorRatio: 50,
  isResizing: false,
  minRatio: 20,
  maxRatio: 80,
  startResize: vi.fn(),
  resize: vi.fn(),
  stopResize: vi.fn(),
}));

function mockBeautifyStreamResult(result: Record<string, unknown>) {
  apiMocks.beautifyMarkdownStream.mockImplementation((_request: unknown, requestId: string) => {
    queueMicrotask(() => {
      eventMocks.listener?.({
        payload: {
          requestId,
          type: "rule_result",
          chunk: null,
          result,
          error: null,
        },
      });
      eventMocks.listener?.({
        payload: {
          requestId,
          type: "completed",
          chunk: null,
          result,
          error: null,
        },
      });
    });
    return Promise.resolve(requestId);
  });
}

function mockBeautifyStreamWithDelta(ruleResult: Record<string, unknown>, finalResult: Record<string, unknown>, delta: string) {
  apiMocks.beautifyMarkdownStream.mockImplementation((_request: unknown, requestId: string) => {
    queueMicrotask(() => {
      eventMocks.listener?.({
        payload: {
          requestId,
          type: "rule_result",
          chunk: null,
          result: ruleResult,
          error: null,
        },
      });
      eventMocks.listener?.({
        payload: {
          requestId,
          type: "ai_delta",
          chunk: delta,
          result: null,
          error: null,
        },
      });
    });
    return Promise.resolve(requestId);
  });

  return () => {
    const call = apiMocks.beautifyMarkdownStream.mock.calls[0];
    const requestId = call?.[1] as string | undefined;
    if (!requestId) {
      throw new Error("beautify stream was not started");
    }
    eventMocks.listener?.({
      payload: {
        requestId,
        type: "completed",
        chunk: null,
        result: finalResult,
        error: null,
      },
    });
  };
}

vi.mock("../../hooks/useAutoSave", () => ({
  useAutoSave: () => undefined,
}));

vi.mock("../../hooks/useEditorSplitResize", () => ({
  useEditorSplitResize: () => ({
    editorRatio: splitResizeState.editorRatio,
    isResizing: splitResizeState.isResizing,
    minRatio: splitResizeState.minRatio,
    maxRatio: splitResizeState.maxRatio,
    startResize: splitResizeState.startResize,
    resize: splitResizeState.resize,
    stopResize: splitResizeState.stopResize,
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

vi.mock("../../api/commands", () => ({
  api: apiMocks,
  mapMarkdownBeautifyStreamEvent: apiMocks.mapMarkdownBeautifyStreamEvent,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

vi.mock("../../projection/windowApi", () => ({
  openProjectionWindow: projectionWindowApiMocks.openProjectionWindow,
  closeProjectionWindow: projectionWindowApiMocks.closeProjectionWindow,
  emitProjectionState: projectionWindowApiMocks.emitProjectionState,
  setProjectionWindowTitle: projectionWindowApiMocks.setProjectionWindowTitle,
  getProjectionWindowCapabilities: projectionWindowApiMocks.getProjectionWindowCapabilities,
}));

describe("EditorWorkspace", () => {
  beforeEach(() => {
    capturedProps.editor = null;
    capturedProps.preview = null;
    apiMocks.beautifyMarkdown.mockReset();
    apiMocks.beautifyMarkdownStream.mockReset();
    apiMocks.mapMarkdownBeautifyStreamEvent.mockClear();
    eventMocks.listener = null;
    eventMocks.listen.mockReset();
    eventMocks.listen.mockImplementation((_eventName: string, callback: (event: { payload: unknown }) => void) => {
      eventMocks.listener = callback;
      return Promise.resolve(vi.fn());
    });
    openNoteMock.mockReset();
    beginOpenNoteMock.mockClear();
    isOpenNoteRequestCurrentMock.mockClear();
    splitResizeState.editorRatio = 50;
    splitResizeState.isResizing = false;
    splitResizeState.minRatio = 20;
    splitResizeState.maxRatio = 80;
    splitResizeState.startResize.mockReset();
    splitResizeState.resize.mockReset();
    splitResizeState.stopResize.mockReset();
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
    projectionWindowApiMocks.setProjectionWindowTitle.mockReset();
    projectionWindowApiMocks.setProjectionWindowTitle.mockResolvedValue(undefined);
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
      viewMode: "split",
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

  it("renders split mode with editor, preview, separator, and the read-mode button", () => {
    useEditorStore.getState().setViewMode("split");

    render(<EditorWorkspace />);

    expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    expect(screen.getByTestId("mock-preview")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "阅读模式" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回双列模式" })).not.toBeInTheDocument();
  });

  it("renders preview mode with only preview and a return-to-split icon button", () => {
    useEditorStore.getState().setViewMode("preview");

    render(<EditorWorkspace />);

    expect(screen.queryByTestId("mock-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-preview")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "写作模式" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回双列模式" })).toBeInTheDocument();
  });

  it("renders editor mode with only editor and a return-to-split icon button", () => {
    useEditorStore.getState().setViewMode("editor");

    render(<EditorWorkspace />);

    expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "阅读模式" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回双列模式" })).toBeInTheDocument();
  });

  it("cycles the primary mode button from split to preview and preview to editor", async () => {
    const user = userEvent.setup();
    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "阅读模式" }));

    expect(useEditorStore.getState().viewMode).toBe("preview");
    expect(screen.getByRole("button", { name: "写作模式" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "写作模式" }));

    expect(useEditorStore.getState().viewMode).toBe("editor");
    expect(screen.getByRole("button", { name: "阅读模式" })).toBeInTheDocument();
  });

  it("returns to split mode from the icon button", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().setViewMode("preview");

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "返回双列模式" }));

    expect(useEditorStore.getState().viewMode).toBe("split");
    expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    expect(screen.getByTestId("mock-preview")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("restores the existing split ratio after switching through single-column modes", async () => {
    const user = userEvent.setup();
    splitResizeState.editorRatio = 37;
    render(<EditorWorkspace />);

    expect(screen.getByTestId("mock-editor").parentElement).toHaveStyle({ width: "37%" });
    expect(screen.getByTestId("mock-preview").parentElement).toHaveStyle({ width: "63%" });

    await user.click(screen.getByRole("button", { name: "阅读模式" }));
    await user.click(screen.getByRole("button", { name: "写作模式" }));
    await user.click(screen.getByRole("button", { name: "返回双列模式" }));

    expect(screen.getByTestId("mock-editor").parentElement).toHaveStyle({ width: "37%" });
    expect(screen.getByTestId("mock-preview").parentElement).toHaveStyle({ width: "63%" });
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("constrains long note titles so the split toolbar can keep shrinking", () => {
    useEditorStore.setState({
      currentNote: makeNote({
        path: "notes/long.md",
        title: "解决大厂量化交易的秘籍：选股因子分析（五）这是一个非常长而且不应撑破布局的标题",
      }),
    });

    render(<EditorWorkspace />);

    const title = screen.getByText(/解决大厂量化交易的秘籍/);

    expect(title).toHaveStyle({
      minWidth: "0",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
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
    lookbackSummaryState.savedSummary = "";

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

    expect(screen.getByRole("button", { name: "关闭投影" })).toHaveStyle({
      background: "#eff6ff",
      border: "1px solid #93c5fd",
      color: "#0969da",
    });

    expect(projectionWindowApiMocks.openProjectionWindow).toHaveBeenCalledWith("Demo");
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

  it("highlights toolbar buttons on hover and restores them on mouse leave", async () => {
    const user = userEvent.setup();
    render(<EditorWorkspace />);

    const projectionButton = screen.getByRole("button", { name: "开启投影" });

    expect(projectionButton).toHaveStyle({
      background: "#f8fafc",
      border: "1px solid #d9e0e8",
      color: "#475467",
    });

    await user.hover(projectionButton);

    expect(projectionButton).toHaveStyle({
      background: "#eff6ff",
      border: "1px solid #93c5fd",
      color: "#0969da",
    });

    await user.unhover(projectionButton);

    expect(projectionButton).toHaveStyle({
      background: "#f8fafc",
      border: "1px solid #d9e0e8",
      color: "#475467",
    });
  });

  it("applies the shared hover style to reading-mode buttons", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().setViewMode("preview");
    render(<EditorWorkspace />);

    const cycleButton = screen.getByRole("button", { name: "写作模式" });
    const returnSplitButton = screen.getByRole("button", { name: "返回双列模式" });

    await user.hover(cycleButton);
    expect(cycleButton).toHaveStyle({
      background: "#eff6ff",
      border: "1px solid #93c5fd",
      color: "#0969da",
    });
    await user.unhover(cycleButton);

    await user.hover(returnSplitButton);
    expect(returnSplitButton).toHaveStyle({
      background: "#eff6ff",
      border: "1px solid #93c5fd",
      color: "#0969da",
    });
  });

  it("runs markdown beautify in the existing preview pane and applies the reviewed result", async () => {
    const user = userEvent.setup();
    mockBeautifyStreamResult({
      originalHash: "hash-1",
      beautifiedContent: "# Demo\n\n## 目录\n\nBody",
      appliedAi: false,
      aiStatus: "not_requested",
      aiStatusDetail: null,
      diagnostics: [
        {
          id: "toc-missing",
          severity: "warning",
          kind: "toc_missing",
          message: "缺少目录",
          lineStart: 1,
          lineEnd: 1,
          autoFixable: true,
          aiEligible: false,
        },
      ],
      summary: {
        errorCount: 0,
        warningCount: 1,
        autoFixableCount: 1,
      },
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "美化 Markdown" }));
    await user.click(screen.getByRole("button", { name: "确认美化" }));

    await waitFor(() => {
      expect(apiMocks.beautifyMarkdownStream).toHaveBeenCalledWith(
        {
          notePath: "notes/demo.md",
          content: "# Demo\n\nBody",
          options: {
            fixSyntax: true,
            refreshToc: true,
            normalizeHeadings: true,
            normalizeCodeBlocks: true,
            normalizeSpacing: true,
            useAiAssist: false,
          },
        },
        expect.stringMatching(/^beautify-/),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "应用美化结果" })).toBeInTheDocument();
      expect(screen.queryAllByTestId("mock-preview")).toHaveLength(1);
      expect(useEditorStore.getState().beautifyReview?.beautifiedContent).toBe("# Demo\n\n## 目录\n\nBody");
      expect(useEditorStore.getState().beautifyReview?.aiStatus).toBe("not_requested");
    });
    expect(useEditorStore.getState().content).toBe("# Demo\n\nBody");

    await user.click(screen.getByRole("button", { name: "应用美化结果" }));

    expect(useEditorStore.getState().content).toBe("# Demo\n\n## 目录\n\nBody");
    expect(useEditorStore.getState().beautifyReview).toBeNull();
  });

  it("shows streaming AI beautify progress without reporting AI failure", async () => {
    const user = userEvent.setup();
    const ruleResult = {
      originalHash: "hash-1",
      beautifiedContent: "# Rule Result",
      appliedAi: false,
      aiStatus: "not_requested",
      aiStatusDetail: null,
      diagnostics: [],
      summary: {
        errorCount: 0,
        warningCount: 1,
        autoFixableCount: 0,
      },
    };
    const finalResult = {
      ...ruleResult,
      beautifiedContent: "# AI Final",
      appliedAi: true,
      aiStatus: "applied",
    };
    const completeStream = mockBeautifyStreamWithDelta(ruleResult, finalResult, "# AI Streaming");

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "美化 Markdown" }));
    await user.click(screen.getByRole("button", { name: "确认美化" }));

    await waitFor(() => {
      expect(useEditorStore.getState().beautifyReview?.beautifiedContent).toBe("# AI Streaming");
      expect(screen.getAllByText(/AI 正在流式美化|AI 美化中/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/AI 未生效/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "等待 AI 完成" })).toBeDisabled();
    });

    act(() => completeStream());

    await waitFor(() => {
      expect(useEditorStore.getState().beautifyReview?.beautifiedContent).toBe("# AI Final");
      expect(screen.getByRole("button", { name: "应用美化结果" })).toBeEnabled();
    });
  });

  it("switches the existing preview pane into beautify diff mode when view diff is clicked", async () => {
    const user = userEvent.setup();
    mockBeautifyStreamResult({
      originalHash: "hash-1",
      beautifiedContent: "# Demo\n\n## 目录\n\nBody",
      appliedAi: false,
      aiStatus: "candidate_rejected",
      aiStatusDetail: "AI beautify candidate appears to be missing trailing document content",
      diagnostics: [],
      summary: {
        errorCount: 0,
        warningCount: 0,
        autoFixableCount: 0,
      },
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "美化 Markdown" }));
    await user.click(screen.getByRole("button", { name: "确认美化" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "查看改动" })).toBeInTheDocument();
      expect(screen.getAllByText(/AI 未生效：候选结果未通过校验（AI 返回的内容不完整，缺少文档后半部分）/).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("button", { name: "查看改动" }));

    expect(useEditorStore.getState().beautifyReview?.diffMode).toBe(true);
    expect(screen.queryAllByTestId("mock-preview")).toHaveLength(1);
    expect(capturedProps.preview).toMatchObject({
      content: "# Demo\n\n## 目录\n\nBody",
      beautifyReview: expect.objectContaining({
        originalContent: "# Demo\n\nBody",
        beautifiedContent: "# Demo\n\n## 目录\n\nBody",
        diffMode: true,
      }),
    });
  });

  it("shows unavailable AI detail without letting the review toolbar buttons collapse", async () => {
    const user = userEvent.setup();
    mockBeautifyStreamResult({
      originalHash: "hash-1",
      beautifiedContent: "# Demo\n\n## 目录\n\nBody",
      appliedAi: false,
      aiStatus: "unavailable",
      aiStatusDetail: "AI provider request failed with status 401 Unauthorized: bad api key",
      diagnostics: [],
      summary: {
        errorCount: 0,
        warningCount: 1,
        autoFixableCount: 0,
      },
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "美化 Markdown" }));
    await user.click(screen.getByRole("button", { name: "确认美化" }));

    await screen.findByText(/AI 未生效：未获取到可用候选结果/);
    const toolbarStatus = screen.getByText("美化审阅中", {
      selector: "span[title]",
    });

    expect(toolbarStatus).toHaveAttribute(
      "title",
      "美化审阅中 · 1 条提示 · AI 未生效：未获取到可用候选结果（AI 服务认证失败，请检查 API Key 或服务商配置）",
    );
    expect(toolbarStatus).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    expect(screen.getByRole("button", { name: "查看改动" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放弃美化结果" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用美化结果" })).toBeInTheDocument();
  });

  it("discards beautify review and returns the existing preview pane to normal preview mode", async () => {
    const user = userEvent.setup();
    mockBeautifyStreamResult({
      originalHash: "hash-1",
      beautifiedContent: "# Demo\n\n## 目录\n\nBody",
      appliedAi: false,
      diagnostics: [],
      summary: {
        errorCount: 0,
        warningCount: 0,
        autoFixableCount: 0,
      },
    });

    render(<EditorWorkspace />);

    await user.click(screen.getByRole("button", { name: "美化 Markdown" }));
    await user.click(screen.getByRole("button", { name: "确认美化" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "放弃美化结果" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "查看改动" }));
    await user.click(screen.getByRole("button", { name: "放弃美化结果" }));

    expect(useEditorStore.getState().beautifyReview).toBeNull();
    expect(screen.queryByRole("button", { name: "应用美化结果" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看改动" })).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("mock-preview")).toHaveLength(1);
    expect(capturedProps.preview).toMatchObject({
      content: "# Demo\n\nBody",
      beautifyReview: null,
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
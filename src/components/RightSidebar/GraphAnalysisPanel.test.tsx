import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphAnalysisPanel } from "./GraphAnalysisPanel";
import { useEditorStore } from "../../store/useEditorStore";
import type { GraphCandidateRelation, GraphNodeRef, Note, NoteGraphAnalysis } from "../../types";

const apiMocks = vi.hoisted(() => ({
  getNoteGraphAnalysis: vi.fn(),
  getNoteGraphCandidates: vi.fn(),
  generateNoteGraphCandidates: vi.fn(),
  acceptGraphCandidate: vi.fn(),
  ignoreGraphCandidate: vi.fn(),
}));

const hookMocks = vi.hoisted(() => ({
  beginOpenNote: vi.fn(),
  isOpenNoteRequestCurrent: vi.fn(),
  openNote: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({
    beginOpenNote: hookMocks.beginOpenNote,
    isOpenNoteRequestCurrent: hookMocks.isOpenNoteRequestCurrent,
    openNote: hookMocks.openNote,
  }),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    path: "notes/current.md",
    title: "当前笔记",
    summary: null,
    content_hash: "hash-1",
    word_count: 128,
    created_at: "2026-06-07T00:00:00Z",
    updated_at: "2026-06-07T00:00:00Z",
    indexed_at: "2026-06-07T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeNode(overrides: Partial<GraphNodeRef> = {}): GraphNodeRef {
  return {
    noteId: "note-2",
    noteTitle: "关联笔记",
    notePath: "notes/related.md",
    headingId: null,
    headingText: null,
    lineStart: 8,
    lineEnd: 10,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<NoteGraphAnalysis> = {}): NoteGraphAnalysis {
  return {
    noteId: "note-1",
    overview: {
      confirmedRelations: [
        {
          relationId: "rel-1",
          relationType: "supports",
          direction: "outgoing",
          note: makeNode(),
          rationale: "支持主论点",
        },
      ],
      factualRelations: [
        {
          linkId: "link-1",
          direction: "incoming",
          note: makeNode({ noteId: "note-3", noteTitle: "事实来源", notePath: "notes/fact.md" }),
          linkText: "证据链接",
          linkType: "wiki",
          targetAnchor: null,
        },
      ],
    },
    logicPaths: [
      {
        id: "path-1",
        label: "论证链路",
        steps: [
          {
            node: makeNode({ noteId: "note-1", noteTitle: "当前笔记", notePath: "notes/current.md", lineStart: 3, lineEnd: 5 }),
            relationType: null,
            rationale: null,
          },
          {
            node: makeNode({ noteId: "note-4", noteTitle: "结论笔记", notePath: "notes/conclusion.md", lineStart: 22, lineEnd: 24 }),
            relationType: "conclusion",
            rationale: "推出结论",
          },
        ],
      },
    ],
    conflicts: [
      {
        relationId: "conflict-1",
        relationType: "opposes",
        direction: "incoming",
        counterparty: makeNode({ noteId: "note-5", noteTitle: "冲突笔记", notePath: "notes/conflict.md" }),
        rationale: "与当前结论相反",
      },
    ],
    missingPremises: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<GraphCandidateRelation> = {}): GraphCandidateRelation {
  return {
    id: "candidate-1",
    sourceNoteId: "note-1",
    sourceHeadingId: null,
    targetNoteId: "note-6",
    targetHeadingId: null,
    relationType: "example",
    rationale: "可作为示例关系",
    evidenceExcerpt: "这段文字展示了一个具体例子。",
    candidateStatus: "pending",
    providerName: "mock-provider",
    createdAt: "2026-06-07T00:00:00Z",
    updatedAt: "2026-06-07T00:00:00Z",
    acceptedRelationId: null,
    ...overrides,
  };
}

describe("GraphAnalysisPanel", () => {
  beforeEach(() => {
    apiMocks.getNoteGraphAnalysis.mockReset();
    apiMocks.getNoteGraphCandidates.mockReset();
    apiMocks.generateNoteGraphCandidates.mockReset();
    apiMocks.acceptGraphCandidate.mockReset();
    apiMocks.ignoreGraphCandidate.mockReset();
    hookMocks.beginOpenNote.mockReset();
    hookMocks.isOpenNoteRequestCurrent.mockReset();
    hookMocks.openNote.mockReset();
    hookMocks.beginOpenNote.mockReturnValue(1);
    hookMocks.isOpenNoteRequestCurrent.mockReturnValue(true);
    hookMocks.openNote.mockResolvedValue(undefined);

    useEditorStore.setState({
      currentNote: null,
      searchNavigationTarget: null,
    });
  });

  it("shows the empty state when there is no current note", () => {
    render(<GraphAnalysisPanel />);

    expect(screen.getByText("打开笔记后显示图谱分析")).toBeInTheDocument();
    expect(apiMocks.getNoteGraphAnalysis).not.toHaveBeenCalled();
    expect(apiMocks.getNoteGraphCandidates).not.toHaveBeenCalled();
  });

  it("loads graph analysis and renders the core sections", async () => {
    apiMocks.getNoteGraphAnalysis.mockResolvedValue(makeAnalysis());
    apiMocks.getNoteGraphCandidates.mockResolvedValue([makeCandidate()]);
    useEditorStore.setState({ currentNote: makeNote() });

    render(<GraphAnalysisPanel />);

    await waitFor(() => expect(apiMocks.getNoteGraphAnalysis).toHaveBeenCalledWith("note-1"));
    await waitFor(() => expect(apiMocks.getNoteGraphCandidates).toHaveBeenCalledWith("note-1"));

    expect(await screen.findByText("已确认关系")).toBeInTheDocument();
    expect(screen.getByText("事实关系")).toBeInTheDocument();
    expect(screen.getByText("逻辑路径")).toBeInTheDocument();
    expect(screen.getByText("冲突")).toBeInTheDocument();
    expect(screen.getByText("候选关系")).toBeInTheDocument();
    expect(screen.getByText("关联笔记")).toBeInTheDocument();
    expect(screen.getByText("事实来源")).toBeInTheDocument();
    expect(screen.getByText("论证链路")).toBeInTheDocument();
    expect(screen.getByText("冲突笔记")).toBeInTheDocument();
    expect(screen.getByText("可作为示例关系")).toBeInTheDocument();
  });

  it("accepts a candidate and refreshes both analysis and candidates", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteGraphAnalysis
      .mockResolvedValueOnce(makeAnalysis())
      .mockResolvedValueOnce(makeAnalysis({
        overview: {
          confirmedRelations: [
            {
              relationId: "rel-accepted",
              relationType: "example",
              direction: "outgoing",
              note: makeNode({ noteId: "note-6", noteTitle: "候选目标", notePath: "notes/candidate-target.md" }),
              rationale: "已采纳候选",
            },
          ],
          factualRelations: [],
        },
      }));
    apiMocks.getNoteGraphCandidates
      .mockResolvedValueOnce([makeCandidate()])
      .mockResolvedValueOnce([]);
    apiMocks.acceptGraphCandidate.mockResolvedValue({ id: "rel-accepted" });
    useEditorStore.setState({ currentNote: makeNote() });

    render(<GraphAnalysisPanel />);

    await user.click(await screen.findByRole("button", { name: "采纳候选关系" }));

    await waitFor(() => expect(apiMocks.acceptGraphCandidate).toHaveBeenCalledWith("candidate-1", undefined, undefined));
    await waitFor(() => expect(apiMocks.getNoteGraphAnalysis).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(apiMocks.getNoteGraphCandidates).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("已采纳候选")).toBeInTheDocument();
    expect(screen.queryByText("可作为示例关系")).not.toBeInTheDocument();
  });

  it("triggers AI candidate generation and refreshes the candidate list", async () => {
    const user = userEvent.setup();

    apiMocks.getNoteGraphAnalysis
      .mockResolvedValueOnce(makeAnalysis())
      .mockResolvedValueOnce(makeAnalysis());
    apiMocks.getNoteGraphCandidates
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeCandidate({ id: "candidate-2", rationale: "AI 新建议" })]);
    apiMocks.generateNoteGraphCandidates.mockResolvedValue([
      makeCandidate({ id: "candidate-2", rationale: "AI 新建议" }),
    ]);
    useEditorStore.setState({ currentNote: makeNote() });

    render(<GraphAnalysisPanel />);

    await user.click(await screen.findByRole("button", { name: "AI 生成候选关系" }));

    await waitFor(() => expect(apiMocks.generateNoteGraphCandidates).toHaveBeenCalledWith("note-1"));
    expect(await screen.findByText("AI 新建议")).toBeInTheDocument();
  });

  it("supports editing a candidate before acceptance", async () => {
    const user = userEvent.setup();

    apiMocks.getNoteGraphAnalysis
      .mockResolvedValueOnce(makeAnalysis())
      .mockResolvedValueOnce(makeAnalysis({
        overview: {
          confirmedRelations: [],
          factualRelations: [],
        },
        logicPaths: [],
        conflicts: [],
      }));
    apiMocks.getNoteGraphCandidates
      .mockResolvedValueOnce([makeCandidate()])
      .mockResolvedValueOnce([]);
    apiMocks.acceptGraphCandidate.mockResolvedValue({ id: "rel-edited" });
    useEditorStore.setState({ currentNote: makeNote() });

    render(<GraphAnalysisPanel />);

    await user.click(await screen.findByRole("button", { name: "编辑后采纳候选关系" }));
    await user.selectOptions(screen.getByLabelText("编辑候选关系类型 candidate-1"), "supports");
    await user.clear(screen.getByLabelText("编辑候选说明 candidate-1"));
    await user.type(screen.getByLabelText("编辑候选说明 candidate-1"), "人工修正后的说明");
    await user.click(screen.getByRole("button", { name: "编辑后采纳候选关系" }));

    await waitFor(() => expect(apiMocks.acceptGraphCandidate).toHaveBeenCalledWith(
      "candidate-1",
      "supports",
      "人工修正后的说明",
    ));
  });

  it("does not trigger a stale refresh when the note switches during candidate acceptance", async () => {
    const user = userEvent.setup();
    const acceptRequest = createDeferred<void>();

    apiMocks.getNoteGraphAnalysis
      .mockResolvedValueOnce(makeAnalysis())
      .mockResolvedValueOnce(makeAnalysis({
        noteId: "note-2",
        overview: {
          confirmedRelations: [
            {
              relationId: "rel-note-2",
              relationType: "supports",
              direction: "outgoing",
              note: makeNode({ noteId: "note-7", noteTitle: "第二篇关联", notePath: "notes/second-related.md" }),
              rationale: "第二篇笔记的关系",
            },
          ],
          factualRelations: [],
        },
        logicPaths: [],
        conflicts: [],
      }));
    apiMocks.getNoteGraphCandidates
      .mockResolvedValueOnce([makeCandidate()])
      .mockResolvedValueOnce([]);
    apiMocks.acceptGraphCandidate.mockReturnValueOnce(acceptRequest.promise);

    useEditorStore.setState({ currentNote: makeNote() });

    render(<GraphAnalysisPanel />);

    await user.click(await screen.findByRole("button", { name: "采纳候选关系" }));

    act(() => {
      useEditorStore.setState({
        currentNote: makeNote({ id: "note-2", path: "notes/second.md", title: "第二篇笔记" }),
      });
    });

    expect(await screen.findByText("第二篇关联")).toBeInTheDocument();

    await act(async () => {
      acceptRequest.resolve(undefined);
      await acceptRequest.promise;
    });

    await waitFor(() => expect(apiMocks.acceptGraphCandidate).toHaveBeenCalledWith("candidate-1", undefined, undefined));
    await waitFor(() => expect(apiMocks.getNoteGraphAnalysis).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(apiMocks.getNoteGraphCandidates).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("图谱分析加载中...")).not.toBeInTheDocument();
    expect(screen.getByText("第二篇关联")).toBeInTheDocument();
  });

  it("does not write a navigation target when opening another note does not complete", async () => {
    const user = userEvent.setup();

    apiMocks.getNoteGraphAnalysis.mockResolvedValue(makeAnalysis());
    apiMocks.getNoteGraphCandidates.mockResolvedValue([]);
    hookMocks.beginOpenNote.mockReturnValue(7);
    hookMocks.isOpenNoteRequestCurrent.mockReturnValue(true);
    hookMocks.openNote.mockResolvedValue(undefined);
    useEditorStore.setState({ currentNote: makeNote(), searchNavigationTarget: null });

    render(<GraphAnalysisPanel />);

    await user.click(await screen.findByRole("button", { name: "关联笔记" }));

    await waitFor(() => expect(hookMocks.openNote).toHaveBeenCalledWith("notes/related.md", 7));
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();
  });
});
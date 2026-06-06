import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLookbackSummary } from "./useLookbackSummary";
import { api } from "../api/commands";
import { useAiSettingsStore } from "../store/useAiSettingsStore";
import { useEditorStore } from "../store/useEditorStore";
import { useLookbackSummaryStore } from "../store/useLookbackSummaryStore";
import { deferred, makeNote, makeNoteDetail, makeNoteWithSummary } from "../test/testData";

const apiMocks = vi.hoisted(() => ({
  generateSummaryCandidate: vi.fn(),
  generateSummaryCandidateWithAi: vi.fn(),
  saveNoteSummary: vi.fn(),
  getNoteByPath: vi.fn(),
  getNoteLinks: vi.fn(),
}));

vi.mock("../api/commands", () => ({
  api: apiMocks,
}));

describe("useLookbackSummary", () => {
  beforeEach(() => {
    apiMocks.generateSummaryCandidate.mockReset();
    apiMocks.generateSummaryCandidateWithAi.mockReset();
    apiMocks.saveNoteSummary.mockReset();
    apiMocks.getNoteByPath.mockReset();
    apiMocks.getNoteLinks.mockReset();
    apiMocks.getNoteLinks.mockResolvedValue({ outgoing: [], incoming: [] });
    useAiSettingsStore.getState().resetForTest();
    useLookbackSummaryStore.getState().resetForTest();
    useEditorStore.setState({
      currentNote: makeNote({ path: "notes/demo.md", summary: null, word_count: 420 }),
      content: "",
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

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("generates a candidate only when explicitly requested", async () => {
    apiMocks.generateSummaryCandidate.mockResolvedValue("候选摘要");

    const { result } = renderHook(() => useLookbackSummary());

    expect(result.current.candidate).toBe("");
    expect(result.current.savedSummary).toBeNull();
    expect(result.current.hasSummary).toBe(false);
    expect(api.generateSummaryCandidate).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.generateCandidate();
    });

    expect(api.generateSummaryCandidate).toHaveBeenCalledWith("notes/demo.md");
    expect(result.current.candidate).toBe("候选摘要");
    expect(result.current.savedSummary).toBeNull();
    expect(result.current.hasSummary).toBe(false);
    expect(useEditorStore.getState().currentNote?.summary).toBeNull();
  });

  it("saves a candidate only when explicitly requested and syncs the editor baseline", async () => {
    const savedNote = makeNoteWithSummary("更新后的摘要", { path: "notes/demo.md", content_hash: "stale-hash" });
    const refreshedDetail = makeNoteDetail({
      note: makeNoteWithSummary("更新后的摘要", { path: "notes/demo.md", content_hash: "fresh-hash" }),
      content: "---\nsummary: 更新后的摘要\n---\n\n# Demo\n\nBody",
    });
    apiMocks.saveNoteSummary.mockResolvedValue(savedNote);
    apiMocks.getNoteByPath.mockResolvedValue(refreshedDetail);

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      useEditorStore.getState().setContent("# Demo\n\nOld body");
      useEditorStore.getState().markDirty();
    });

    expect(api.saveNoteSummary).not.toHaveBeenCalled();

    act(() => {
      result.current.setCandidate("更新后的摘要");
    });

    expect(api.saveNoteSummary).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.saveCandidate();
    });

    expect(api.saveNoteSummary).toHaveBeenCalledWith("notes/demo.md", "更新后的摘要");
    expect(api.getNoteByPath).toHaveBeenCalledWith("notes/demo.md");
    expect(result.current.candidate).toBe("更新后的摘要");
    expect(result.current.savedSummary).toBe("更新后的摘要");
    expect(result.current.hasSummary).toBe(true);
    expect(useEditorStore.getState().currentNote).toEqual(refreshedDetail.note);
    expect(useEditorStore.getState().content).toBe(refreshedDetail.content);
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().saveStatus).toBe("saved");
  });

  it("keeps editor content aligned with the saved summary when detail refresh fails after save", async () => {
    const savedNote = makeNoteWithSummary("更新后的摘要", { path: "notes/demo.md", content_hash: "saved-hash" });
    apiMocks.saveNoteSummary.mockResolvedValue(savedNote);
    apiMocks.getNoteByPath.mockRejectedValueOnce(new Error("刷新失败"));

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      useEditorStore.getState().setContent("# Demo\n\nOld body");
      result.current.setCandidate("更新后的摘要");
    });

    await act(async () => {
      await result.current.saveCandidate();
    });

    expect(api.saveNoteSummary).toHaveBeenCalledWith("notes/demo.md", "更新后的摘要");
    expect(api.getNoteByPath).toHaveBeenCalledWith("notes/demo.md");
    expect(result.current.error).toBeNull();
    expect(result.current.candidate).toBe("更新后的摘要");
    expect(result.current.savedSummary).toBe("更新后的摘要");
    expect(result.current.hasSummary).toBe(true);
    expect(useEditorStore.getState().currentNote).toEqual(savedNote);
    expect(useEditorStore.getState().content).toBe("# Demo\n\n> 摘要：更新后的摘要\n\nOld body");
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().saveStatus).toBe("saved");
  });

  it("removes a front matter summary when save succeeds but detail refresh fails", async () => {
    const savedNote = makeNoteWithSummary("更新后的摘要", { path: "notes/demo.md", content_hash: "saved-hash" });
    apiMocks.saveNoteSummary.mockResolvedValue(savedNote);
    apiMocks.getNoteByPath.mockRejectedValueOnce(new Error("刷新失败"));
    useEditorStore.setState({
      currentNote: makeNote({ path: "notes/demo.md", summary: null, word_count: 420 }),
      content: "---\nsummary: 旧摘要\ntitle: Demo\n---\n\n# Demo\n\nBody",
    });

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      result.current.setCandidate("更新后的摘要");
    });

    await act(async () => {
      await result.current.saveCandidate();
    });

    expect(useEditorStore.getState().content).toBe("---\ntitle: Demo\n---\n\n# Demo\n\n> 摘要：更新后的摘要\n\nBody");
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().saveStatus).toBe("saved");
  });

  it("keeps editor content aligned when clearing the summary and detail refresh fails", async () => {
    const clearedNote = makeNote({ path: "notes/demo.md", summary: null, word_count: 420, content_hash: "saved-hash" });
    apiMocks.saveNoteSummary.mockResolvedValue(clearedNote);
    apiMocks.getNoteByPath.mockRejectedValueOnce(new Error("刷新失败"));
    useEditorStore.setState({
      currentNote: makeNoteWithSummary("旧摘要", { path: "notes/demo.md", word_count: 420 }),
      content: "# Demo\n\n> 摘要：旧摘要\n\nBody",
    });

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.clearSummary();
    });

    expect(useEditorStore.getState().currentNote).toEqual(clearedNote);
    expect(useEditorStore.getState().content).toBe("# Demo\n\nBody");
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().saveStatus).toBe("saved");
  });

  it("removes a front matter summary when clearing and detail refresh fails", async () => {
    const clearedNote = makeNote({ path: "notes/demo.md", summary: null, word_count: 420, content_hash: "saved-hash" });
    apiMocks.saveNoteSummary.mockResolvedValue(clearedNote);
    apiMocks.getNoteByPath.mockRejectedValueOnce(new Error("刷新失败"));
    useEditorStore.setState({
      currentNote: makeNoteWithSummary("旧摘要", { path: "notes/demo.md", word_count: 420 }),
      content: "---\nsummary: 旧摘要\ntitle: Demo\n---\n\n# Demo\n\nBody",
    });

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.clearSummary();
    });

    expect(useEditorStore.getState().content).toBe("---\ntitle: Demo\n---\n\n# Demo\n\nBody");
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().saveStatus).toBe("saved");
  });

  it("keeps the editor unsaved when the note body was already dirty and detail refresh fails", async () => {
    const savedNote = makeNoteWithSummary("更新后的摘要", { path: "notes/demo.md", content_hash: "saved-hash" });
    apiMocks.saveNoteSummary.mockResolvedValue(savedNote);
    apiMocks.getNoteByPath.mockRejectedValueOnce(new Error("刷新失败"));

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      useEditorStore.getState().setContent("# Demo\n\nDirty body");
      useEditorStore.getState().markDirty();
      result.current.setCandidate("更新后的摘要");
    });

    await act(async () => {
      await result.current.saveCandidate();
    });

    expect(useEditorStore.getState().currentNote).toEqual(savedNote);
    expect(useEditorStore.getState().content).toBe("# Demo\n\n> 摘要：更新后的摘要\n\nDirty body");
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().saveStatus).toBe("unsaved");
  });

  it("ignores a late generate response after the current note changes", async () => {
    const pendingGenerate = deferred<string>();
    apiMocks.generateSummaryCandidate.mockReturnValueOnce(pendingGenerate.promise);

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      void result.current.generateCandidate();
    });

    expect(result.current.isGenerating).toBe(true);

    act(() => {
      useEditorStore.getState().setCurrentNote(makeNoteWithSummary("第二篇摘要", { id: "note2", path: "notes/other.md" }));
    });

    expect(result.current.candidate).toBe("第二篇摘要");
    expect(result.current.savedSummary).toBe("第二篇摘要");

    await act(async () => {
      pendingGenerate.resolve("过期候选摘要");
      await Promise.resolve();
    });

    expect(result.current.candidate).toBe("第二篇摘要");
    expect(result.current.savedSummary).toBe("第二篇摘要");
    expect(result.current.error).toBeNull();
    expect(result.current.isGenerating).toBe(false);
    expect(useEditorStore.getState().currentNote?.path).toBe("notes/other.md");
  });

  it("ignores a late save response after the current note changes", async () => {
    const pendingSave = deferred<ReturnType<typeof makeNote>>();
    apiMocks.saveNoteSummary.mockReturnValueOnce(pendingSave.promise);

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      result.current.setCandidate("第一篇的新摘要");
    });

    act(() => {
      void result.current.saveCandidate();
    });

    expect(result.current.isSaving).toBe(true);

    act(() => {
      useEditorStore.getState().setCurrentNote(makeNoteWithSummary("第二篇摘要", { id: "note2", path: "notes/other.md" }));
    });

    await act(async () => {
      pendingSave.resolve(makeNoteWithSummary("过期保存结果", { path: "notes/demo.md" }));
      await Promise.resolve();
    });

    expect(api.saveNoteSummary).toHaveBeenCalledWith("notes/demo.md", "第一篇的新摘要");
    expect(result.current.candidate).toBe("第二篇摘要");
    expect(result.current.savedSummary).toBe("第二篇摘要");
    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).toBeNull();
    expect(useEditorStore.getState().currentNote?.path).toBe("notes/other.md");
    expect(useEditorStore.getState().currentNote?.summary).toBe("第二篇摘要");
  });

  it("ignores a late generate response after the same note summary is saved", async () => {
    const pendingGenerate = deferred<string>();
    const savedNote = makeNoteWithSummary("已保存的新摘要", { path: "notes/demo.md" });
    const refreshedDetail = makeNoteDetail({
      note: savedNote,
      content: "---\nsummary: 已保存的新摘要\n---\n\n# Demo\n\nBody",
    });
    apiMocks.generateSummaryCandidate.mockReturnValueOnce(pendingGenerate.promise);
    apiMocks.saveNoteSummary.mockResolvedValueOnce(savedNote);
    apiMocks.getNoteByPath.mockResolvedValueOnce(refreshedDetail);

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      void result.current.generateCandidate();
    });

    expect(result.current.isGenerating).toBe(true);

    act(() => {
      result.current.setCandidate("已保存的新摘要");
    });

    await act(async () => {
      await result.current.saveCandidate();
    });

    expect(result.current.candidate).toBe("已保存的新摘要");
    expect(result.current.savedSummary).toBe("已保存的新摘要");
    expect(useEditorStore.getState().currentNote?.summary).toBe("已保存的新摘要");

    await act(async () => {
      pendingGenerate.resolve("过期候选摘要");
      await Promise.resolve();
    });

    expect(api.saveNoteSummary).toHaveBeenCalledWith("notes/demo.md", "已保存的新摘要");
    expect(result.current.candidate).toBe("已保存的新摘要");
    expect(result.current.savedSummary).toBe("已保存的新摘要");
    expect(result.current.error).toBeNull();
    expect(result.current.isGenerating).toBe(false);
    expect(useEditorStore.getState().currentNote?.path).toBe("notes/demo.md");
    expect(useEditorStore.getState().currentNote?.summary).toBe("已保存的新摘要");
  });

  it("saves blank input so an existing summary can be cleared", async () => {
    const clearedNote = makeNote({ path: "notes/demo.md", summary: null, word_count: 420 });
    const refreshedDetail = makeNoteDetail({
      note: clearedNote,
      content: "# Demo\n\nBody without summary",
    });
    apiMocks.saveNoteSummary.mockResolvedValue(clearedNote);
    apiMocks.getNoteByPath.mockResolvedValue(refreshedDetail);
    useEditorStore.setState({
      currentNote: makeNoteWithSummary("旧摘要", { path: "notes/demo.md", word_count: 420 }),
    });

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      result.current.setCandidate("   ");
    });

    await act(async () => {
      await result.current.saveCandidate();
    });

    expect(api.saveNoteSummary).toHaveBeenCalledWith("notes/demo.md", "");
    expect(api.getNoteByPath).toHaveBeenCalledWith("notes/demo.md");
    expect(result.current.candidate).toBe("");
    expect(result.current.savedSummary).toBeNull();
    expect(result.current.hasSummary).toBe(false);
    expect(useEditorStore.getState().currentNote?.summary).toBeNull();
  });

  it("suppresses immediate re-suggestion after explicitly clearing an existing summary", async () => {
    const clearedNote = makeNote({ path: "notes/demo.md", summary: null, word_count: 420, content_hash: "fresh-hash" });
    apiMocks.saveNoteSummary.mockResolvedValue(clearedNote);
    apiMocks.getNoteByPath.mockResolvedValue(makeNoteDetail({
      note: clearedNote,
      content: "# Demo\n\nBody without summary",
    }));
    useEditorStore.setState({
      currentNote: makeNoteWithSummary("旧摘要", { path: "notes/demo.md", word_count: 420 }),
      content: "---\nsummary: 旧摘要\n---\n\n# Demo\n\nBody",
    });

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      result.current.setCandidate("   ");
    });

    await act(async () => {
      await result.current.saveCandidate();
    });

    expect(result.current.savedSummary).toBeNull();
    expect(result.current.shouldSuggest).toBe(false);
    expect(useLookbackSummaryStore.getState().shouldPrompt("notes/demo.md", {
      wordCount: 420,
      recentViews: 0,
      backlinks: 0,
    })).toBe(false);
  });

  it("surfaces generate failures and resets generating state", async () => {
    apiMocks.generateSummaryCandidate.mockRejectedValueOnce(new Error("生成失败"));

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.generateCandidate();
    });

    expect(result.current.error).toBe("生成失败");
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.candidate).toBe("");
  });

  it("prefers AI generation when AI summary is enabled", async () => {
    useAiSettingsStore.setState({
      settings: {
        enabled: true,
        default_profile_id: "profile-1",
        profiles: [{
          id: "profile-1",
          name: "Default",
          provider: "anthropic",
          model: "claude-sonnet",
          base_url: null,
          max_tokens: 1024,
          temperature: 0.4,
          enabled: true,
        }],
      },
      defaultProfile: {
        id: "profile-1",
        name: "Default",
        provider: "anthropic",
        model: "claude-sonnet",
        base_url: null,
        max_tokens: 1024,
        temperature: 0.4,
        enabled: true,
      },
    });
    apiMocks.generateSummaryCandidateWithAi.mockResolvedValue({
      summary: "AI 候选摘要",
      used_fallback: false,
      provider_trace: null,
    });

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.generateCandidate();
    });

    expect(api.generateSummaryCandidateWithAi).toHaveBeenCalledWith("notes/demo.md", "profile-1");
    expect(api.generateSummaryCandidate).not.toHaveBeenCalled();
    expect(result.current.candidate).toBe("AI 候选摘要");
  });

  it("falls back to rule-based generation after AI errors and exposes fallback status", async () => {
    useAiSettingsStore.setState({
      settings: {
        enabled: true,
        default_profile_id: "profile-1",
        profiles: [{
          id: "profile-1",
          name: "Default",
          provider: "anthropic",
          model: "claude-sonnet",
          base_url: null,
          max_tokens: 1024,
          temperature: 0.4,
          enabled: true,
        }],
      },
      defaultProfile: {
        id: "profile-1",
        name: "Default",
        provider: "anthropic",
        model: "claude-sonnet",
        base_url: null,
        max_tokens: 1024,
        temperature: 0.4,
        enabled: true,
      },
    });
    apiMocks.generateSummaryCandidateWithAi.mockRejectedValueOnce(new Error("provider unavailable"));
    apiMocks.generateSummaryCandidate.mockResolvedValue("规则摘要");

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.generateCandidate();
    });

    expect(api.generateSummaryCandidateWithAi).toHaveBeenCalledWith("notes/demo.md", "profile-1");
    expect(api.generateSummaryCandidate).toHaveBeenCalledWith("notes/demo.md");
    expect(result.current.candidate).toBe("规则摘要");
    expect(result.current.generationStatus).toBe("AI 摘要失败，已回退到规则摘要：provider unavailable");
  });

  it("reports when the AI command already used a fallback summary", async () => {
    useAiSettingsStore.setState({
      settings: {
        enabled: true,
        default_profile_id: "profile-1",
        profiles: [{
          id: "profile-1",
          name: "Default",
          provider: "anthropic",
          model: "claude-sonnet",
          base_url: null,
          max_tokens: 1024,
          temperature: 0.4,
          enabled: true,
        }],
      },
      defaultProfile: {
        id: "profile-1",
        name: "Default",
        provider: "anthropic",
        model: "claude-sonnet",
        base_url: null,
        max_tokens: 1024,
        temperature: 0.4,
        enabled: true,
      },
    });
    apiMocks.generateSummaryCandidateWithAi.mockResolvedValue({
      summary: "后端回退摘要",
      used_fallback: true,
      provider_trace: null,
    });

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.generateCandidate();
    });

    expect(result.current.candidate).toBe("后端回退摘要");
    expect(result.current.generationStatus).toBe("AI 服务已回退到规则摘要。");
  });

  it("surfaces the fallback reason when the AI summary endpoint returns provider trace details", async () => {
    useAiSettingsStore.setState({
      settings: {
        enabled: true,
        default_profile_id: "profile-1",
        profiles: [{
          id: "profile-1",
          name: "Default",
          provider: "anthropic",
          model: "claude-sonnet",
          base_url: null,
          max_tokens: 1024,
          temperature: 0.4,
          enabled: true,
        }],
      },
      defaultProfile: {
        id: "profile-1",
        name: "Default",
        provider: "anthropic",
        model: "claude-sonnet",
        base_url: null,
        max_tokens: 1024,
        temperature: 0.4,
        enabled: true,
      },
    });
    apiMocks.generateSummaryCandidateWithAi.mockResolvedValue({
      summary: "后端回退摘要",
      used_fallback: true,
      provider_trace: {
        error: "AI profile secret not found: kb-hash:profile-1",
      },
    });

    const { result } = renderHook(() => useLookbackSummary());

    await act(async () => {
      await result.current.generateCandidate();
    });

    expect(result.current.candidate).toBe("后端回退摘要");
    expect(result.current.generationStatus).toBe("AI 服务已回退到规则摘要：默认 profile 未找到已保存的 API Key；如果刚测试过新配置，请先保存设置。");
  });

  it("surfaces save failures and keeps the current note unchanged", async () => {
    apiMocks.saveNoteSummary.mockRejectedValueOnce(new Error("保存失败"));

    const { result } = renderHook(() => useLookbackSummary());

    act(() => {
      result.current.setCandidate("准备保存的摘要");
    });

    await act(async () => {
      await result.current.saveCandidate();
    });

    expect(result.current.error).toBe("保存失败");
    expect(result.current.isSaving).toBe(false);
    expect(result.current.candidate).toBe("准备保存的摘要");
    expect(useEditorStore.getState().currentNote?.path).toBe("notes/demo.md");
    expect(useEditorStore.getState().currentNote?.summary).toBeNull();
  });

  it("does not actively suggest for low-value notes by default", async () => {
    useEditorStore.setState({
      currentNote: makeNote({ path: "notes/demo.md", summary: null, word_count: 80 }),
    });
    useLookbackSummaryStore.getState().recordOpen("notes/demo.md");

    const { result } = renderHook(() => useLookbackSummary());

    await waitFor(() => {
      expect(api.getNoteLinks).toHaveBeenCalledWith("note1");
    });

    expect(result.current.shouldSuggest).toBe(false);
  });

  it("suggests a summary when backlink signals indicate the note is worth revisiting", async () => {
    useEditorStore.setState({
      currentNote: makeNote({ path: "notes/demo.md", summary: null, word_count: 120 }),
    });
    apiMocks.getNoteLinks.mockResolvedValue({
      outgoing: [],
      incoming: [{ id: "incoming-1" }],
    });

    const { result } = renderHook(() => useLookbackSummary());

    expect(result.current.shouldSuggest).toBe(false);

    await waitFor(() => {
      expect(result.current.shouldSuggest).toBe(true);
    });
  });

  it("keeps the current suggestion visible but suppresses repeated prompts within 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T12:00:00Z"));
    useEditorStore.setState({
      currentNote: makeNote({ path: "notes/demo.md", summary: null, word_count: 420 }),
    });

    const first = renderHook(() => useLookbackSummary());

    expect(first.result.current.shouldSuggest).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    first.unmount();

    const second = renderHook(() => useLookbackSummary());

    expect(second.result.current.shouldSuggest).toBe(false);
  });
});
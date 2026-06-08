import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BacklinksPanel } from "./BacklinksPanel";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import { tauriMocks } from "../../test/setup";
import { deferred, makeKnowledgeBase } from "../../test/testData";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import type { LinkItem, NoteLinks, NoteRelations, RelationItem } from "../../types";

const apiMocks = vi.hoisted(() => ({
  getNoteLinks: vi.fn(),
  listRelations: vi.fn(),
  searchNotes: vi.fn(),
  createRelation: vi.fn(),
  deleteRelation: vi.fn(),
}));

const hookMocks = vi.hoisted(() => ({
  openNote: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  writeText: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({ openNote: hookMocks.openNote }),
}));

function renderWithContextMenu(noteId: string | null = "note-1") {
  return render(
    <ContextMenuProvider>
      <BacklinksPanel noteId={noteId} />
      <ContextMenuHost />
    </ContextMenuProvider>,
  );
}

function makeLink(overrides: Partial<LinkItem> = {}): LinkItem {
  return {
    id: "link-1",
    note_id: "note-2",
    note_title: "关联笔记",
    note_path: "notes/related.md",
    source_note_id: "note-1",
    source_note_title: "当前笔记",
    source_note_path: "notes/current.md",
    source_line_start: 8,
    source_line_end: 8,
    link_text: "关联笔记",
    link_url: "notes/related.md",
    link_type: "wiki",
    resolved: true,
    ...overrides,
  };
}

function makeLinks(overrides: Partial<NoteLinks> = {}): NoteLinks {
  return {
    outgoing: [],
    incoming: [],
    ...overrides,
  };
}

function makeRelation(overrides: Partial<RelationItem> = {}): RelationItem {
  return {
    id: "rel-1",
    relation_type: "related",
    relation_origin: "manual",
    description: null,
    accepted_candidate_id: null,
    note_id: "note-2",
    note_title: "手动关系笔记",
    note_path: "notes/manual.md",
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

beforeEach(() => {
  apiMocks.getNoteLinks.mockReset();
  apiMocks.listRelations.mockReset();
  apiMocks.searchNotes.mockReset();
  apiMocks.createRelation.mockReset();
  apiMocks.deleteRelation.mockReset();
  hookMocks.openNote.mockReset();
  hookMocks.openNote.mockResolvedValue(undefined);
  browserMocks.writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: browserMocks.writeText },
  });

  useAppStore.setState({ kb: makeKnowledgeBase({ id: "kb-1" }) });
});

describe("BacklinksPanel", () => {
  it("keeps manual relations visible while auto links are loading", async () => {
    apiMocks.getNoteLinks.mockImplementation(
      () => new Promise<NoteLinks>(() => undefined),
    );
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    await waitFor(() => expect(apiMocks.getNoteLinks).toHaveBeenCalledWith("note-1"));
    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledWith("note-1"));

    expect(screen.getByText("提及了谁")).toBeInTheDocument();
    expect(screen.getByText("谁提及我")).toBeInTheDocument();
    expect(screen.getByText("关系")).toBeInTheDocument();
    expect(screen.getAllByText("加载中...")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "添加关系" })).toBeInTheDocument();
    expect(screen.getByText("暂无手动关系")).toBeInTheDocument();
  });

  it("renders auto-link sections and real manual relations together", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "link-out-1",
          note_title: "传出笔记",
          link_text: "传出笔记",
          note_path: "notes/outgoing.md",
          link_url: "notes/outgoing.md",
        }),
      ],
      incoming: [
        makeLink({
          id: "link-in-1",
          note_id: "note-3",
          note_title: "反链笔记",
          link_text: "反链笔记",
          note_path: "notes/incoming.md",
          link_url: "notes/incoming.md",
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations({
      outgoing: [
        makeRelation({
          id: "rel-out-1",
          relation_type: "supports",
          relation_origin: "candidate_accepted",
          accepted_candidate_id: "candidate-7",
          note_id: "note-4",
          note_title: "手动传出关系",
          note_path: "notes/manual-outgoing.md",
          description: "传出关系说明",
        }),
      ],
      incoming: [
        makeRelation({
          id: "rel-in-1",
          relation_type: "similar",
          note_id: "note-5",
          note_title: "手动传入关系",
          note_path: "notes/manual-incoming.md",
          description: "传入关系说明",
        }),
      ],
    }));

    render(<BacklinksPanel noteId="note-1" />);

    await waitFor(() => expect(apiMocks.getNoteLinks).toHaveBeenCalledWith("note-1"));
    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledWith("note-1"));

    expect(await screen.findByText("提及了谁")).toBeInTheDocument();
    expect(screen.getByText("谁提及我")).toBeInTheDocument();
    expect(screen.getByText("关系")).toBeInTheDocument();
    expect(screen.getByText("传出笔记")).toBeInTheDocument();
    expect(screen.queryByText("反链笔记")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加关系" })).toBeInTheDocument();
    expect(screen.getByText("我关联到")).toBeInTheDocument();
    expect(screen.getByText("关联到我")).toBeInTheDocument();
    expect(screen.getByText("手动传出关系")).toBeInTheDocument();
    expect(screen.getByText("手动传入关系")).toBeInTheDocument();
    expect(screen.getByText("传出关系说明")).toBeInTheDocument();
    expect(screen.getByText("传入关系说明")).toBeInTheDocument();
    expect(screen.getByText(/来源:\s*AI 原样采纳/)).toBeInTheDocument();
    expect(screen.getByText(/来源候选:\s*candidate-7/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /谁提及我/ }));
    expect(await screen.findByText("反链笔记")).toBeInTheDocument();
  });

  it("navigates outgoing links to their source context while keeping external-link behavior intact", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "link-note",
          note_title: "内部笔记",
          link_text: "内部笔记",
          note_path: "notes/internal.md",
          source_note_path: "notes/current.md",
          source_line_start: 18,
          source_line_end: 18,
          link_url: "notes/internal.md",
          link_type: "wiki",
        }),
        makeLink({
          id: "link-external",
          note_id: "note-external",
          note_title: "外部链接",
          link_text: "外部链接",
          note_path: "",
          link_url: "https://example.com",
          link_type: "external",
          resolved: false,
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    await screen.findByText("内部笔记");
    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledWith("note-1"));
    expect(screen.getByRole("button", { name: "添加关系" })).toBeInTheDocument();

    await user.click(screen.getByText("内部笔记"));
    await user.click(screen.getByText("外部链接"));

    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/current.md");
    expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
      note_path: "notes/current.md",
      line_start: 18,
      line_end: 18,
      match_text: "内部笔记",
      source: "body",
    });
    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("navigates anchored internal links to the target line after opening the note", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "link-anchor",
          note_title: "章节链接",
          link_text: "章节链接",
          note_path: "notes/internal.md",
          source_note_path: "notes/current.md",
          source_line_start: 12,
          source_line_end: 12,
          link_url: "notes/internal.md#执行摘要",
          link_type: "markdown",
          target_anchor: "执行摘要",
          target_line_start: 24,
          target_line_end: 24,
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    await screen.findByText("章节链接");
    await user.click(screen.getByText("章节链接"));

    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/current.md");
    expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
      note_path: "notes/current.md",
      line_start: 12,
      line_end: 12,
      match_text: "章节链接",
      source: "body",
    });
  });

  it("opens the source note and locates the source context for incoming links", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [],
      incoming: [
        makeLink({
          id: "incoming-source-link",
          note_id: "note-source",
          note_title: "来源笔记",
          note_path: "notes/source.md",
          source_note_id: "note-source",
          source_note_title: "来源笔记",
          source_note_path: "notes/source.md",
          source_line_start: 26,
          source_line_end: 26,
          link_text: "当前笔记",
          link_url: "notes/current.md#执行摘要",
          target_anchor: "执行摘要",
          target_line_start: 48,
          target_line_end: 48,
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    await user.click(await screen.findByRole("button", { name: /谁提及我/ }));
    await user.click(await screen.findByText("来源笔记"));

    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/source.md");
    expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
      note_path: "notes/source.md",
      line_start: 26,
      line_end: 26,
      match_text: "当前笔记",
      source: "body",
    });
  });

  it("renders each auto-link section as an independently scrollable list", async () => {
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: Array.from({ length: 8 }, (_, index) => makeLink({
        id: `out-${index}`,
        note_id: `note-out-${index}`,
        note_title: `传出链接 ${index + 1}`,
        link_text: `传出链接 ${index + 1}`,
        note_path: `notes/out-${index}.md`,
        link_url: `notes/out-${index}.md`,
      })),
      incoming: Array.from({ length: 8 }, (_, index) => makeLink({
        id: `in-${index}`,
        note_id: `note-in-${index}`,
        note_title: `传入链接 ${index + 1}`,
        link_text: `传入链接 ${index + 1}`,
        note_path: `notes/in-${index}.md`,
        link_url: `notes/in-${index}.md`,
      })),
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    const user = userEvent.setup();
    const outgoingToggle = await screen.findByRole("button", { name: /提及了谁/ });
    const incomingToggle = await screen.findByRole("button", { name: /谁提及我/ });
    const outgoingList = outgoingToggle.nextElementSibling as HTMLElement;

    await user.click(incomingToggle);
    const incomingList = incomingToggle.nextElementSibling as HTMLElement;

    expect(outgoingList.style.maxHeight).not.toBe("");
    expect(outgoingList.style.overflowY).toBe("auto");
    expect(incomingList.style.maxHeight).not.toBe("");
    expect(incomingList.style.overflowY).toBe("auto");
  });

  it("keeps outgoing expanded and incoming collapsed by default", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "out-default",
          note_title: "默认展开链接",
          link_text: "默认展开链接",
          note_path: "notes/default-open.md",
          link_url: "notes/default-open.md",
        }),
      ],
      incoming: [
        makeLink({
          id: "in-default",
          note_id: "note-in-default",
          note_title: "默认收起链接",
          link_text: "默认收起链接",
          note_path: "notes/default-closed.md",
          link_url: "notes/default-closed.md",
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    const outgoingToggle = await screen.findByRole("button", { name: /提及了谁/ });
    const incomingToggle = await screen.findByRole("button", { name: /谁提及我/ });

    expect(outgoingToggle).toHaveAttribute("aria-expanded", "true");
    expect(incomingToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("默认展开链接")).toBeInTheDocument();
    expect(screen.queryByText("默认收起链接")).not.toBeInTheDocument();

    await user.click(incomingToggle);
    expect(incomingToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("默认收起链接")).toBeInTheDocument();
  });

  it("pins the empty incoming section to the bottom while outgoing takes the main space", async () => {
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: Array.from({ length: 5 }, (_, index) => makeLink({
        id: `out-grow-${index}`,
        note_id: `note-grow-${index}`,
        note_title: `主要链接 ${index + 1}`,
        link_text: `主要链接 ${index + 1}`,
        note_path: `notes/grow-${index}.md`,
        link_url: `notes/grow-${index}.md`,
      })),
      incoming: [],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    const outgoingSection = (await screen.findByRole("button", { name: /提及了谁/ })).parentElement as HTMLElement;
    const incomingSection = screen.getByRole("button", { name: /谁提及我/ }).parentElement as HTMLElement;

    expect(outgoingSection.style.flex).toBe("1 1 0%");
    expect(incomingSection.style.marginTop).toBe("auto");
    expect(screen.queryByText("暂无链接")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /谁提及我/ }));
    expect(await screen.findByText("暂无链接")).toBeInTheDocument();
  });

  it("lets the primary expanded auto-link list use the remaining height", async () => {
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: Array.from({ length: 12 }, (_, index) => makeLink({
        id: `out-fill-${index}`,
        note_id: `note-fill-${index}`,
        note_title: `占满区域链接 ${index + 1}`,
        link_text: `占满区域链接 ${index + 1}`,
        note_path: `notes/fill-${index}.md`,
        link_url: `notes/fill-${index}.md`,
      })),
      incoming: [],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    const outgoingToggle = await screen.findByRole("button", { name: /提及了谁/ });
    const outgoingList = outgoingToggle.nextElementSibling as HTMLElement;

    expect(outgoingList.style.flex).toBe("1 1 auto");
    expect(outgoingList.style.maxHeight).toBe("none");
    expect(outgoingList.style.overflowY).toBe("auto");
  });

  it("truncates long auto-link titles with ellipsis instead of overflowing the sidebar", async () => {
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "link-long-title",
          note_title: "这是一个非常非常非常长的关联标题用于验证右侧面板里的文本会被省略而不是继续溢出遮挡",
          link_text: "这是一个非常非常非常长的关联标题用于验证右侧面板里的文本会被省略而不是继续溢出遮挡",
          note_path: "notes/long-title.md",
          link_url: "notes/long-title.md",
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    const longTitle = await screen.findByText("这是一个非常非常非常长的关联标题用于验证右侧面板里的文本会被省略而不是继续溢出遮挡");

    expect(longTitle).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });

  it("renders a readable tail label when the link only has a long raw path", async () => {
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "link-raw-path",
          note_title: "",
          link_text: "",
          note_path: "",
          link_url: "/Users/lijun/minisara/zroa/employee/views/settings.py:45-187",
          link_type: "markdown",
          resolved: false,
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    expect(await screen.findByRole("button", { name: "views/settings.py:45-187" })).toBeInTheDocument();
    expect(screen.queryByText("/Users/lijun/minisara/zroa/employee/views/settings.py:45-187")).not.toBeInTheDocument();
  });

  it("renders a readable tail label when the link text itself is path-like", async () => {
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "link-path-text",
          note_title: "",
          link_text: "MiniSara/settings.py:45-187",
          note_path: "",
          link_url: "/Users/lijun/minisara/zroa/employee/views/settings.py:45-187",
          link_type: "markdown",
          resolved: false,
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    render(<BacklinksPanel noteId="note-1" />);

    expect(await screen.findByRole("button", { name: "settings.py:45-187" })).toBeInTheDocument();
    expect(screen.queryByText("MiniSara/settings.py:45-187")).not.toBeInTheDocument();
  });

  it("opens the links-blank context menu and refreshes links through the shared host", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteLinks
      .mockResolvedValueOnce(makeLinks())
      .mockResolvedValueOnce(makeLinks({
        outgoing: [
          makeLink({
            id: "link-refreshed",
            note_title: "刷新后的链接",
            link_text: "刷新后的链接",
            note_path: "notes/refreshed.md",
            link_url: "notes/refreshed.md",
          }),
        ],
      }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    renderWithContextMenu();

    await waitFor(() => expect(screen.getAllByText("暂无链接")).toHaveLength(1));

    fireEvent.contextMenu(screen.getByTestId("backlinks-links-surface"), {
      clientX: 48,
      clientY: 72,
    });

    expect(await screen.findByRole("menuitem", { name: "刷新链接" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "显示侧栏" })).toHaveAttribute("aria-disabled", "false");

    await user.click(screen.getByRole("menuitem", { name: "刷新链接" }));

    await waitFor(() => expect(apiMocks.getNoteLinks).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("刷新后的链接")).toBeInTheDocument();
  });

  it("ignores stale refresh results after switching notes", async () => {
    const user = userEvent.setup();
    const refreshRequest = deferred<NoteLinks>();

    apiMocks.getNoteLinks
      .mockResolvedValueOnce(makeLinks({
        outgoing: [
          makeLink({
            id: "note-1-link",
            note_title: "笔记一链接",
            link_text: "笔记一链接",
            note_path: "notes/note-1.md",
            link_url: "notes/note-1.md",
          }),
        ],
      }))
      .mockImplementationOnce(() => refreshRequest.promise)
      .mockResolvedValueOnce(makeLinks({
        outgoing: [
          makeLink({
            id: "note-2-link",
            note_title: "笔记二链接",
            link_text: "笔记二链接",
            note_path: "notes/note-2.md",
            link_url: "notes/note-2.md",
          }),
        ],
      }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    const view = render(
      <ContextMenuProvider>
        <BacklinksPanel noteId="note-1" />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    expect(await screen.findByText("笔记一链接")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("backlinks-links-surface"), {
      clientX: 48,
      clientY: 72,
    });
    await user.click(await screen.findByRole("menuitem", { name: "刷新链接" }));

    await waitFor(() => expect(apiMocks.getNoteLinks).toHaveBeenCalledTimes(2));

    view.rerender(
      <ContextMenuProvider>
        <BacklinksPanel noteId="note-2" />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    expect(await screen.findByText("笔记二链接")).toBeInTheDocument();

    refreshRequest.resolve(makeLinks({
      outgoing: [
        makeLink({
          id: "stale-link",
          note_title: "过期链接",
          link_text: "过期链接",
          note_path: "notes/stale.md",
          link_url: "notes/stale.md",
        }),
      ],
    }));

    await waitFor(() => {
      expect(screen.getByText("笔记二链接")).toBeInTheDocument();
      expect(screen.queryByText("过期链接")).not.toBeInTheDocument();
    });
  });

  it("shows different link-item context menu enablement for internal and external links", async () => {
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "link-internal",
          note_title: "内部链接",
          link_text: "内部链接",
          note_path: "notes/internal.md",
          link_url: "notes/internal.md",
          link_type: "wiki",
        }),
        makeLink({
          id: "link-external",
          note_id: "note-external",
          note_title: "外部链接",
          link_text: "外部链接",
          note_path: "",
          link_url: "https://example.com",
          link_type: "external",
          resolved: false,
        }),
      ],
    }));
    apiMocks.listRelations.mockResolvedValue(makeRelations());

    renderWithContextMenu();

    fireEvent.contextMenu(await screen.findByText("内部链接"), { clientX: 20, clientY: 24 });
    expect(await screen.findByRole("menuitem", { name: "打开目标笔记" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "打开链接" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "复制链接地址" })).toHaveAttribute("aria-disabled", "false");

    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.contextMenu(screen.getByText("外部链接"), { clientX: 28, clientY: 32 });
    expect(await screen.findByRole("menuitem", { name: "打开目标笔记" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "打开链接" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "复制链接地址" })).toHaveAttribute("aria-disabled", "false");
  });
});
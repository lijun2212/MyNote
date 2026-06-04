import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BacklinksPanel } from "./BacklinksPanel";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import { tauriMocks } from "../../test/setup";
import { deferred, makeKnowledgeBase } from "../../test/testData";
import { useAppStore } from "../../store/useAppStore";
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
    description: null,
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

    expect(screen.getByText("传出链接")).toBeInTheDocument();
    expect(screen.getByText("反向链接 (backlinks)")).toBeInTheDocument();
    expect(screen.getAllByText("加载中...")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "添加关系" })).toBeInTheDocument();
    expect(screen.getByText("暂无手动关系")).toBeInTheDocument();
  });

  it("renders auto-link sections and real manual relations together", async () => {
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

    expect(await screen.findByText("传出链接")).toBeInTheDocument();
    expect(screen.getByText("反向链接 (backlinks)")).toBeInTheDocument();
    expect(screen.getByText("传出笔记")).toBeInTheDocument();
    expect(screen.getByText("反链笔记")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加关系" })).toBeInTheDocument();
    expect(screen.getByText("传出关系")).toBeInTheDocument();
    expect(screen.getByText("传入关系")).toBeInTheDocument();
    expect(screen.getByText("手动传出关系")).toBeInTheDocument();
    expect(screen.getByText("手动传入关系")).toBeInTheDocument();
    expect(screen.getByText("传出关系说明")).toBeInTheDocument();
    expect(screen.getByText("传入关系说明")).toBeInTheDocument();
  });

  it("keeps open-note and external-link behavior intact", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteLinks.mockResolvedValue(makeLinks({
      outgoing: [
        makeLink({
          id: "link-note",
          note_title: "内部笔记",
          link_text: "内部笔记",
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

    render(<BacklinksPanel noteId="note-1" />);

    await screen.findByText("内部笔记");
    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledWith("note-1"));
    expect(screen.getByRole("button", { name: "添加关系" })).toBeInTheDocument();

    await user.click(screen.getByText("内部笔记"));
    await user.click(screen.getByText("外部链接"));

    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/internal.md");
    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://example.com");
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

    await waitFor(() => expect(screen.getAllByText("暂无链接")).toHaveLength(2));

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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BacklinksPanel } from "./BacklinksPanel";
import { tauriMocks } from "../../test/setup";
import { makeKnowledgeBase } from "../../test/testData";
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

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({ openNote: hookMocks.openNote }),
}));

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
});
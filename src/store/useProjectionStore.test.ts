import { beforeEach, describe, expect, it } from "vitest";
import type {
  ProjectionStateSyncPayload,
} from "../projection/events";
import type { SearchNavigationTarget, TagNavigationTarget } from "../types";
import { useProjectionStore } from "./useProjectionStore";

function makeSearchNavigationTarget(
  overrides: Partial<SearchNavigationTarget> = {},
): SearchNavigationTarget {
  return {
    note_id: "search-note-1",
    note_path: "notes/search.md",
    note_title: "Search Note",
    line_start: 12,
    line_end: 12,
    occurrence_order: 0,
    match_text: "keyword",
    source: "body",
    context_snippet: "keyword context",
    revision: 1,
    ...overrides,
  };
}

function makeTagNavigationTarget(
  overrides: Partial<TagNavigationTarget> = {},
): TagNavigationTarget {
  return {
    note_id: "tag-note-1",
    note_path: "notes/tag.md",
    note_title: "Tag Note",
    note_updated_at: "2026-06-13T00:00:00.000Z",
    source: "inline",
    occurrence_order: 0,
    line_start: 4,
    line_end: 4,
    heading_context: "Section",
    context_snippet: "#tag context",
    tag_name: "tag",
    revision: 1,
    ...overrides,
  };
}

function makeStateSyncPayload(
  overrides: Partial<ProjectionStateSyncPayload> = {},
): ProjectionStateSyncPayload {
  return {
    sessionId: 1,
    revision: 1,
    notePath: "notes/current.md",
    noteTitle: "Current Note",
    kbRootPath: null,
    content: "# Current Note\n\nBody",
    searchNavigationTarget: makeSearchNavigationTarget(),
    tagNavigationTarget: makeTagNavigationTarget(),
    ...overrides,
  };
}

describe("useProjectionStore", () => {
  beforeEach(() => {
    useProjectionStore.getState().resetForTest();
  });

  it("applies newer revision state over an existing older snapshot", () => {
    const store = useProjectionStore.getState();

    store.applyStateSync(makeStateSyncPayload({
      revision: 1,
      notePath: "notes/older.md",
      noteTitle: "Older Note",
      content: "older content",
      searchNavigationTarget: makeSearchNavigationTarget({
        note_id: "search-older",
        note_path: "notes/older-search.md",
        revision: 1,
      }),
      tagNavigationTarget: makeTagNavigationTarget({
        note_id: "tag-older",
        note_path: "notes/older-tag.md",
        revision: 1,
      }),
    }));

    store.applyStateSync(makeStateSyncPayload({
      revision: 2,
      notePath: "notes/newer.md",
      noteTitle: "Newer Note",
      content: "newer content",
      searchNavigationTarget: makeSearchNavigationTarget({
        note_id: "search-newer",
        note_path: "notes/newer-search.md",
        revision: 2,
      }),
      tagNavigationTarget: makeTagNavigationTarget({
        note_id: "tag-newer",
        note_path: "notes/newer-tag.md",
        revision: 2,
      }),
    }));

    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionId: 1,
      notePath: "notes/newer.md",
      noteTitle: "Newer Note",
      content: "newer content",
      lastRevision: 2,
    });
    expect(useProjectionStore.getState().searchNavigationTarget).toMatchObject({
      note_id: "search-newer",
      note_path: "notes/newer-search.md",
      revision: 2,
    });
    expect(useProjectionStore.getState().tagNavigationTarget).toMatchObject({
      note_id: "tag-newer",
      note_path: "notes/newer-tag.md",
      revision: 2,
    });
  });

  it("ignores older revision payloads after a newer snapshot is applied", () => {
    const store = useProjectionStore.getState();

    store.applyStateSync(makeStateSyncPayload({
      revision: 2,
      notePath: "notes/newer.md",
      noteTitle: "Newer Note",
      content: "newer content",
      searchNavigationTarget: makeSearchNavigationTarget({
        note_id: "search-newer",
        note_path: "notes/newer-search.md",
        revision: 2,
      }),
      tagNavigationTarget: makeTagNavigationTarget({
        note_id: "tag-newer",
        note_path: "notes/newer-tag.md",
        revision: 2,
      }),
    }));

    store.applyStateSync(makeStateSyncPayload({
      revision: 1,
      notePath: "notes/older.md",
      noteTitle: "Older Note",
      content: "older content",
      searchNavigationTarget: makeSearchNavigationTarget({
        note_id: "search-older",
        note_path: "notes/older-search.md",
        revision: 1,
      }),
      tagNavigationTarget: makeTagNavigationTarget({
        note_id: "tag-older",
        note_path: "notes/older-tag.md",
        revision: 1,
      }),
    }));

    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionId: 1,
      notePath: "notes/newer.md",
      noteTitle: "Newer Note",
      content: "newer content",
      lastRevision: 2,
    });
    expect(useProjectionStore.getState().searchNavigationTarget).toMatchObject({
      note_id: "search-newer",
      note_path: "notes/newer-search.md",
      revision: 2,
    });
    expect(useProjectionStore.getState().tagNavigationTarget).toMatchObject({
      note_id: "tag-newer",
      note_path: "notes/newer-tag.md",
      revision: 2,
    });
  });

  it("accepts a lower revision snapshot after the projection session is closed", () => {
    const store = useProjectionStore.getState();

    store.applyStateSync(makeStateSyncPayload({
      revision: 5,
      notePath: "notes/previous-session.md",
      noteTitle: "Previous Session",
      content: "previous session content",
      searchNavigationTarget: makeSearchNavigationTarget({
        note_id: "search-previous",
        note_path: "notes/previous-search.md",
        revision: 5,
      }),
      tagNavigationTarget: makeTagNavigationTarget({
        note_id: "tag-previous",
        note_path: "notes/previous-tag.md",
        revision: 5,
      }),
    }));

    store.markClosed();

    store.applyStateSync(makeStateSyncPayload({
      revision: 1,
      notePath: "notes/new-session.md",
      noteTitle: "New Session",
      content: "new session content",
      searchNavigationTarget: makeSearchNavigationTarget({
        note_id: "search-new-session",
        note_path: "notes/new-session-search.md",
        revision: 1,
      }),
      tagNavigationTarget: makeTagNavigationTarget({
        note_id: "tag-new-session",
        note_path: "notes/new-session-tag.md",
        revision: 1,
      }),
    }));

    expect(useProjectionStore.getState()).toMatchObject({
      notePath: "notes/new-session.md",
      noteTitle: "New Session",
      content: "new session content",
      lastRevision: 1,
    });
    expect(useProjectionStore.getState().searchNavigationTarget).toMatchObject({
      note_id: "search-new-session",
      note_path: "notes/new-session-search.md",
      revision: 1,
    });
    expect(useProjectionStore.getState().tagNavigationTarget).toMatchObject({
      note_id: "tag-new-session",
      note_path: "notes/new-session-tag.md",
      revision: 1,
    });
  });

  it("toggles follow scroll and markClosed resets enabled and ready", () => {
    const store = useProjectionStore.getState();

    const sessionId = store.beginSession();
    store.setReady(true);
    store.setFollowScroll(false);

    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionRequested: true,
      projectionSessionId: sessionId,
      projectionEnabled: true,
      projectionWindowReady: true,
      projectionFollowScroll: false,
    });

    store.markClosed();

    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionRequested: false,
      projectionSessionId: sessionId,
      projectionEnabled: false,
      projectionWindowReady: false,
      projectionFollowScroll: false,
    });
    expect(useProjectionStore.getState()).toMatchObject({
      notePath: null,
      noteTitle: null,
      content: "",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
      lastRevision: 0,
    });
  });
});
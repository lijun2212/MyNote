import type {
  KnowledgeBase,
  Note,
  NoteDetail,
  SaveNoteResult,
  SearchHistoryHitItem,
  SearchResult,
} from "../types";

export function makeKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb1",
    name: "Test KB",
    root_path: "/tmp/test-kb",
    created_at: "2026-05-30T00:00:00Z",
    updated_at: "2026-05-30T00:00:00Z",
    ...overrides,
  };
}

export function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note1",
    path: "notes/note1.md",
    title: "Note 1",
    summary: null,
    content_hash: "hash1",
    word_count: 2,
    created_at: "2026-05-30T00:00:00Z",
    updated_at: "2026-05-30T00:00:00Z",
    indexed_at: "2026-05-30T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

export function makeNoteDetail(overrides: Partial<NoteDetail> = {}): NoteDetail {
  const note = overrides.note ?? makeNote();
  return { note, content: "# Note 1\n\nBody", ...overrides };
}

export function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    note_id: "note1",
    title: "Note 1",
    path: "notes/note1.md",
    snippet: "A <mark>note</mark> result",
    line_start: 3,
    line_end: 3,
    occurrence_order: 1,
    match_text: "note",
    source: "body",
    score: -1.2,
    ...overrides,
  };
}

export function makeSearchHistoryHit(overrides: Partial<SearchHistoryHitItem> = {}): SearchHistoryHitItem {
  return {
    query: "nacos",
    note_id: "note-1",
    note_title: "Search Hit",
    note_path: "notes/search-hit.md",
    line_start: 3,
    line_end: 3,
    occurrence_order: 1,
    snippet: "A <mark>nacos</mark> result",
    source: "body",
    ...overrides,
  };
}

export function makeSaveNoteResult(overrides: Partial<SaveNoteResult> = {}): SaveNoteResult {
  return { note: makeNote({ content_hash: "hash2" }), conflict: false, ...overrides };
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
import { useEffect, useRef, useState } from "react";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { SourceLineSyncSignal } from "./sourceLineSync";
import { findInlineTagMatches } from "./inlineTags";
import { clearActiveDraggedTagName, getActiveDraggedTagName } from "./tagDragState";
import type { SearchNavigationTarget, TagNavigationTarget } from "../../types";
import type { SearchResult } from "../../types";
import { api } from "../../api/commands";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { useContextMenu } from "../ContextMenu/useContextMenu";

interface Props {
  initialContent: string;
  onChange: (content: string) => void;
  searchNavigationTarget?: SearchNavigationTarget | null;
  tagNavigationTarget?: TagNavigationTarget | null;
  sourceLineSyncSignal?: SourceLineSyncSignal | null;
  onTopVisibleLineChange?: (line: number) => void;
}

type InsertTagDetail = {
  tagName: string;
  source?: string;
};

type SelectionSnapshot = {
  from: number;
  to: number;
  text: string;
};

type LinkInsertMode = "markdown" | "wiki";

const INSERT_TAG_EVENT = "mynote:insert-tag";
const DRAGGED_TAG_MIME = "application/x-mynote-tag";
const TAG_DRAG_DEBUG_PREFIX = "[mynote:tag-drag]";
const EDITOR_DROP_TARGET_SELECTOR = "[data-mynote-editor-drop-target]";

function logTagDrag(event: string, details: Record<string, unknown>) {
  console.info(TAG_DRAG_DEBUG_PREFIX, event, details);
}

const inlineTagDecoration = Decoration.mark({ class: "cm-inline-tag-token" });
const inlineTagNavigationDecoration = Decoration.mark({ class: "cm-inline-tag-token cm-inline-tag-navigation-target" });
const searchNavigationDecoration = Decoration.mark({ class: "cm-search-navigation-target" });

const setTagNavigationTargetEffect = StateEffect.define<TagNavigationTarget | null>();
const setSearchNavigationTargetEffect = StateEffect.define<SearchNavigationTarget | null>();

const tagNavigationTargetField = StateField.define<TagNavigationTarget | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTagNavigationTargetEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const searchNavigationTargetField = StateField.define<SearchNavigationTarget | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchNavigationTargetEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

class SearchNavigationPluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate) {
    const navigationTargetChanged = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(setSearchNavigationTargetEffect)),
    );
    if (update.docChanged || update.viewportChanged || navigationTargetChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const searchNavigationTarget = view.state.field(searchNavigationTargetField, false);
    if (!searchNavigationTarget) {
      return builder.finish();
    }

    const targetLines: Array<{ from: number; to: number; text: string }> = [];
    const startLine = Math.max(1, searchNavigationTarget.line_start);
    const endLine = Math.min(view.state.doc.lines, searchNavigationTarget.line_end);

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      targetLines.push({ from: line.from, to: line.to, text: line.text });
    }

    const matchText = searchNavigationTarget.match_text.trim();
    if (matchText) {
      let occurrenceOrder = 0;
      for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber);
        const matchIndexes = findMatchIndexes(line.text, matchText);
        for (const matchIndex of matchIndexes) {
          occurrenceOrder += 1;
          if (
            occurrenceOrder === searchNavigationTarget.occurrence_order
            && lineNumber >= startLine
            && lineNumber <= endLine
          ) {
            builder.add(
              line.from + matchIndex,
              line.from + matchIndex + matchText.length,
              searchNavigationDecoration,
            );
            return builder.finish();
          }
        }
      }

      for (const line of targetLines) {
        const matchIndexes = findMatchIndexes(line.text, matchText);
        if (matchIndexes.length === 0) {
          continue;
        }
        const matchIndex = matchIndexes[0];
        builder.add(
          line.from + matchIndex,
          line.from + matchIndex + matchText.length,
          searchNavigationDecoration,
        );
        return builder.finish();
      }
    }

    for (const line of targetLines) {
      builder.add(line.from, line.to, searchNavigationDecoration);
    }

    return builder.finish();
  }
}

const searchNavigationPlugin = ViewPlugin.fromClass(SearchNavigationPluginValue, {
  decorations: (plugin) => plugin.decorations,
});

class InlineTagPluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate) {
    const navigationTargetChanged = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(setTagNavigationTargetEffect)),
    );
    if (update.docChanged || update.viewportChanged || navigationTargetChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const tagNavigationTarget = view.state.field(tagNavigationTargetField, false);
    let occurrenceOrder = 0;

    for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      for (const match of findInlineTagMatches(line.text)) {
        occurrenceOrder += 1;
        const matchFrom = line.from + match.start;
        const decoration = tagNavigationTarget
          && tagNavigationTarget.line_start === lineNumber
          && tagNavigationTarget.tag_name === match.name
          && tagNavigationTarget.occurrence_order === occurrenceOrder
          ? inlineTagNavigationDecoration
          : inlineTagDecoration;
        builder.add(matchFrom, line.from + match.end, decoration);
      }
    }

    return builder.finish();
  }
}

const inlineTagPlugin = ViewPlugin.fromClass(InlineTagPluginValue, {
  decorations: (plugin) => plugin.decorations,
});

function getEditorTopVisibleLine(view: EditorView): number | null {
  const topBlock = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  const lineNumber = view.state.doc.lineAt(topBlock.from).number;
  const offsetRatio = topBlock.height > 0
    ? Math.min(0.99, Math.max(0, (view.scrollDOM.scrollTop - topBlock.top) / topBlock.height))
    : 0;
  return lineNumber + offsetRatio;
}

function scrollEditorToSourceLine(view: EditorView, sourceLine: number) {
  const lineNumber = Math.min(view.state.doc.lines, Math.max(1, Math.floor(sourceLine)));
  const line = view.state.doc.line(lineNumber);
  const block = view.lineBlockAt(line.from);
  const lineProgress = Math.min(0.99, Math.max(0, sourceLine - lineNumber));
  view.scrollDOM.scrollTop = block.top + block.height * lineProgress;
}

function findMatchIndexes(text: string, matchText: string): number[] {
  if (!matchText) {
    return [];
  }

  const haystack = text.toLocaleLowerCase();
  const needle = matchText.toLocaleLowerCase();
  const indexes: number[] = [];
  let searchFrom = 0;
  while (searchFrom <= haystack.length - needle.length) {
    const matchIndex = haystack.indexOf(needle, searchFrom);
    if (matchIndex === -1) {
      break;
    }
    indexes.push(matchIndex);
    searchFrom = matchIndex + needle.length;
  }
  return indexes;
}

function buildTagInsertText(tagName: string): string {
  return `#${tagName} `;
}

function buildImageInsertText(markdownPath: string): string {
  return `![图片](${markdownPath})`;
}

function canReadClipboard() {
  return typeof navigator !== "undefined"
    && !!navigator.clipboard
    && (typeof navigator.clipboard.read === "function" || typeof navigator.clipboard.readText === "function");
}

function canWriteClipboard() {
  return typeof navigator !== "undefined"
    && !!navigator.clipboard
    && typeof navigator.clipboard.writeText === "function";
}

function getSelectedEditorText(view: EditorView) {
  const selection = view.state.selection.main;
  if (selection.empty) {
    return "";
  }
  return view.state.sliceDoc(selection.from, selection.to);
}

function writeSelectionToClipboardData(view: EditorView, clipboardData: DataTransfer | null) {
  const selectedText = getSelectedEditorText(view);
  if (!selectedText || typeof clipboardData?.setData !== "function") {
    return false;
  }

  clipboardData.setData("text/plain", selectedText);
  return true;
}

async function mirrorSelectionToClipboard(view: EditorView) {
  const selectedText = getSelectedEditorText(view);
  if (!selectedText || !canWriteClipboard()) {
    return false;
  }

  await navigator.clipboard.writeText(selectedText);
  return true;
}


async function readClipboardText(): Promise<string | null> {
  if (!canReadClipboard()) {
    return null;
  }

  try {
    if (typeof navigator.clipboard.readText === "function") {
      const text = await navigator.clipboard.readText();
      return text || null;
    }
  } catch {
    return null;
  }

  return null;
}


async function readClipboardTextForPaste(notePath?: string): Promise<string | null> {
  if (notePath) {
    try {
      const text = await api.readClipboardTextForPaste(notePath);
      if (text) {
        return text;
      }
    } catch {
      // Fall back to the browser clipboard APIs below.
    }
  }

  return await readClipboardText();
}


async function readPasteInsertText(notePath?: string): Promise<string | null> {
  const text = await readClipboardTextForPaste(notePath);
  if (text) {
    return text;
  }

  if (notePath) {
    try {
      const nativeImageResult = await api.insertPastedImageFromClipboardForNote(notePath);
      if (nativeImageResult) {
        return buildImageInsertText(nativeImageResult.markdownPath);
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function pasteIntoSelectionSnapshot(
  view: EditorView,
  snapshot: SelectionSnapshot,
  notePath?: string,
  onBeforeNativeImageRead?: () => void,
) {
  let insert = await readClipboardTextForPaste(notePath);
  if (!insert && notePath) {
    onBeforeNativeImageRead?.();
    try {
      const nativeImageResult = await api.insertPastedImageFromClipboardForNote(notePath);
      if (nativeImageResult) {
        insert = buildImageInsertText(nativeImageResult.markdownPath);
      }
    } catch {
      insert = null;
    }
  }
  if (!insert) {
    return;
  }

  replaceSelectionSnapshot(view, snapshot, () => ({ insert, anchor: insert.length }));
}

async function pasteIntoCursor(view: EditorView, notePath?: string, at?: number | null) {
  const insert = await readPasteInsertText(notePath);
  if (!insert) {
    return;
  }
  insertTextIntoView(view, insert, at);
}

function readClipboardImageItem(dataTransfer: DataTransfer | null) {
  const items = Array.from(dataTransfer?.items ?? []);
  return items.find((item) => item.kind === "file" && /^image\/(png|jpe?g|gif|webp)$/i.test(item.type)) ?? null;
}

function convertPastedHtmlToText(html: string) {
  if (!html || typeof DOMParser === "undefined") {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const blockTags = new Set(["P", "DIV", "SECTION", "ARTICLE", "LI", "UL", "OL", "TABLE", "TR", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6"]);

  function serializeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (!(node instanceof HTMLElement)) {
      return "";
    }

    if (node.tagName === "BR") {
      return "\n";
    }

    if (node.tagName === "IMG") {
      const src = node.getAttribute("src")?.trim();
      return src ? `\n<img src="${src}">\n` : "";
    }

    const content = Array.from(node.childNodes).map(serializeNode).join("");
    if (blockTags.has(node.tagName)) {
      return `${content}\n`;
    }

    return content;
  }

  const serialized = Array.from(doc.body.childNodes).map(serializeNode).join("");
  const normalized = serialized
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return normalized || null;
}

async function readPasteInsertTextFromClipboardData(dataTransfer: DataTransfer | null, notePath?: string): Promise<string | null> {
  const imageItem = readClipboardImageItem(dataTransfer);
  if (imageItem) {
    if (!notePath) {
      return null;
    }
    const imageFile = imageItem.getAsFile();
    if (!imageFile) {
      return null;
    }
    const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
    if (imageBytes.byteLength === 0) {
      return null;
    }
    const result = await api.insertPastedImageForNote(notePath, imageItem.type, imageBytes);
    return buildImageInsertText(result.markdownPath);
  }

  const text = dataTransfer?.getData("text/plain") ?? "";
  if (text) {
    return notePath ? await api.rewritePastedRemoteImages(notePath, text) : text;
  }

  const html = dataTransfer?.getData("text/html") ?? "";
  const htmlText = convertPastedHtmlToText(html);
  if (!htmlText) {
    return null;
  }

  return notePath ? await api.rewritePastedRemoteImages(notePath, htmlText) : htmlText;
}

async function pasteClipboardDataIntoCurrentSelection(
  view: EditorView,
  dataTransfer: DataTransfer | null,
  notePath?: string,
  onPendingChange?: (pending: boolean) => void,
) {
  const selection = view.state.selection.main;
  const snapshot: SelectionSnapshot = {
    from: selection.from,
    to: selection.to,
    text: view.state.sliceDoc(selection.from, selection.to),
  };
  onPendingChange?.(true);
  let insert: string | null = null;
  try {
    insert = await readPasteInsertTextFromClipboardData(dataTransfer, notePath);
  } finally {
    onPendingChange?.(false);
  }
  if (!insert) {
    return;
  }
  replaceSelectionSnapshot(view, snapshot, () => ({ insert, anchor: insert.length }));
}

async function pasteNativeClipboardImageIntoCurrentSelection(view: EditorView, notePath?: string) {
  if (!notePath) {
    return;
  }

  const selection = view.state.selection.main;
  const snapshot: SelectionSnapshot = {
    from: selection.from,
    to: selection.to,
    text: view.state.sliceDoc(selection.from, selection.to),
  };
  const result = await api.insertPastedImageFromClipboardForNote(notePath);
  if (!result) {
    return;
  }
  const insert = buildImageInsertText(result.markdownPath);
  replaceSelectionSnapshot(view, snapshot, () => ({ insert, anchor: insert.length }));
}

async function requestImageInsert(notePath: string) {
  try {
    return await api.insertImageForNote(notePath);
  } catch {
    return null;
  }
}

function insertTagIntoView(view: EditorView, tagName: string, at?: number | null) {
  const text = buildTagInsertText(tagName);
  insertTextIntoView(view, text, at);
}

function insertTextIntoView(view: EditorView, text: string, at?: number | null) {
  const fallbackPosition = view.hasFocus ? view.state.selection.main.head : view.state.doc.length;
  const from = Math.max(0, Math.min(view.state.doc.length, at ?? fallbackPosition));
  view.dispatch({
    changes: { from, to: from, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

function dedupeSearchResultsByNote(results: SearchResult[]) {
  const seenNoteIds = new Set<string>();
  return results.filter((result) => {
    if (seenNoteIds.has(result.note_id)) {
      return false;
    }
    seenNoteIds.add(result.note_id);
    return true;
  });
}

function replaceSelectionSnapshot(
  view: EditorView,
  snapshot: SelectionSnapshot,
  transform: (selectedText: string) => { insert: string; anchor: number },
) {
  const currentText = view.state.sliceDoc(snapshot.from, snapshot.to);
  if (currentText !== snapshot.text) {
    return;
  }

  const { insert, anchor } = transform(snapshot.text);
  view.dispatch({
    changes: { from: snapshot.from, to: snapshot.to, insert },
    selection: { anchor: snapshot.from + anchor },
    scrollIntoView: true,
  });
  view.focus();
}

function readDraggedTagName(dataTransfer: DataTransfer | null): string {
  const customTag = dataTransfer?.getData(DRAGGED_TAG_MIME)?.trim();
  if (customTag) {
    logTagDrag("read-payload", { source: DRAGGED_TAG_MIME, tagName: customTag });
    return customTag;
  }

  const plainText = dataTransfer?.getData("text/plain")?.trim() ?? "";
  if (plainText) {
    const tagName = plainText.startsWith("#") ? plainText.slice(1).trim() : plainText;
    logTagDrag("read-payload", { source: "text/plain", plainText, tagName });
    return tagName;
  }

  const fallbackTagName = getActiveDraggedTagName() ?? "";
  logTagDrag("read-payload", { source: "activeDraggedTagName", tagName: fallbackTagName });
  return fallbackTagName;
}

function getDropPosition(view: EditorView, x: number, y: number): number | null {
  try {
    return view.posAtCoords({ x, y });
  } catch {
    return null;
  }
}

const KEYBOARD_PASTE_FALLBACK_DELAY_MS = 1200;

export function MarkdownEditor({
  initialContent,
  onChange,
  searchNavigationTarget,
  tagNavigationTarget,
  sourceLineSyncSignal,
  onTopVisibleLineChange,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { openContextMenu, closeContextMenu } = useContextMenu();
  const suppressContextMenuRef = useRef(false);
  const suppressContextMenuTimerRef = useRef<number | null>(null);
  const keyboardPasteFallbackTimerRef = useRef<number | null>(null);
  const suppressEditorContextMenu = () => {
    suppressContextMenuRef.current = true;
    if (suppressContextMenuTimerRef.current !== null) {
      window.clearTimeout(suppressContextMenuTimerRef.current);
    }
    suppressContextMenuTimerRef.current = window.setTimeout(() => {
      suppressContextMenuRef.current = false;
      suppressContextMenuTimerRef.current = null;
    }, 800);
    closeContextMenu();
  };
  const cancelKeyboardPasteFallback = () => {
    if (keyboardPasteFallbackTimerRef.current !== null) {
      window.clearTimeout(keyboardPasteFallbackTimerRef.current);
      keyboardPasteFallbackTimerRef.current = null;
    }
  };
  const kb = useAppStore((state) => state.kb);
  const refreshTree = useAppStore((state) => state.refreshTree);
  const setLeftSidebarVisible = useAppStore((state) => state.setLeftSidebarVisible);
  const currentNote = useEditorStore((state) => state.currentNote);
  const setIsComposing = useEditorStore((state) => state.setIsComposing);
  const isComposing = useEditorStore((state) => state.isComposing);
  const isProgrammaticChange = useRef(false);
  const isProgrammaticScroll = useRef(false);
  const currentNotePathRef = useRef<string | undefined>(currentNote?.path);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const navigationHighlightTimerRef = useRef<number | null>(null);
  const copyNoticeTimerRef = useRef<number | null>(null);
  const [linkPickerMode, setLinkPickerMode] = useState<LinkInsertMode | null>(null);
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [linkPickerResults, setLinkPickerResults] = useState<SearchResult[]>([]);
  const [linkPickerLoading, setLinkPickerLoading] = useState(false);
  const [linkPickerError, setLinkPickerError] = useState<string | null>(null);
  const [pasteFeedbackState, setPasteFeedbackState] = useState<"shortcut" | "image" | null>(null);
  const setStatusNotice = useEditorStore((state) => state.setStatusNotice);

  const scheduleKeyboardPasteFallback = (view: EditorView) => {
    cancelKeyboardPasteFallback();
    const selection = view.state.selection.main;
    const snapshot: SelectionSnapshot = {
      from: selection.from,
      to: selection.to,
      text: view.state.sliceDoc(selection.from, selection.to),
    };

    keyboardPasteFallbackTimerRef.current = window.setTimeout(() => {
      keyboardPasteFallbackTimerRef.current = null;
      void pasteIntoSelectionSnapshot(
        view,
        snapshot,
        currentNotePathRef.current,
        () => setPasteFeedbackState("image"),
      ).finally(() => setPasteFeedbackState(null));
    }, KEYBOARD_PASTE_FALLBACK_DELAY_MS);
  };

  const showCopiedNotice = () => {
    setStatusNotice("已拷贝");
    if (copyNoticeTimerRef.current !== null) {
      window.clearTimeout(copyNoticeTimerRef.current);
    }
    copyNoticeTimerRef.current = window.setTimeout(() => {
      setStatusNotice(null);
      copyNoticeTimerRef.current = null;
    }, 1600);
  };

  const closeLinkPicker = () => {
    setLinkPickerMode(null);
    setLinkPickerQuery("");
    setLinkPickerResults([]);
    setLinkPickerLoading(false);
    setLinkPickerError(null);
  };

  const openLinkPicker = (mode: LinkInsertMode) => {
    setLinkPickerMode(mode);
    setLinkPickerQuery("");
    setLinkPickerResults([]);
    setLinkPickerLoading(false);
    setLinkPickerError(null);
  };

  const insertLinkFromPicker = (result?: SearchResult) => {
    const view = viewRef.current;
    const query = linkPickerQuery.trim();
    if (!view || !linkPickerMode) {
      return;
    }

    if (linkPickerMode === "wiki") {
      const targetTitle = result?.title ?? query;
      if (!targetTitle) {
        return;
      }
      insertTextIntoView(view, `[[${targetTitle}]]`);
      closeLinkPicker();
      return;
    }

    const markdownLabel = result?.title ?? "链接";
    const markdownTarget = result?.path ?? query;
    if (!markdownTarget) {
      return;
    }
    insertTextIntoView(view, `[${markdownLabel}](${markdownTarget})`);
    closeLinkPicker();
  };

  const releaseProgrammaticScrollSoon = () => {
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      isProgrammaticScroll.current = false;
      programmaticScrollTimerRef.current = null;
    }, 120);
  };

  const handleExternalTagDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const tagName = readDraggedTagName(event.dataTransfer);
    const view = viewRef.current;
    if (!view || !tagName) return;

    event.preventDefault();
    const position = getDropPosition(view, event.clientX, event.clientY);
    insertTagIntoView(view, tagName, position);
    clearActiveDraggedTagName();
  };

  const handlePointerTagDrop = (event: React.PointerEvent<HTMLDivElement>) => {
    const tagName = getActiveDraggedTagName();
    const view = viewRef.current;
    logTagDrag("pointer-up", {
      tagName,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (!view || !tagName) return;

    event.preventDefault();
    const position = getDropPosition(view, event.clientX, event.clientY);
    logTagDrag("pointer-insert", { tagName, position });
    insertTagIntoView(view, tagName, position);
    clearActiveDraggedTagName();
  };

  const handleEditorContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    if (suppressContextMenuRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (isComposing) {
      return;
    }

    const selection = view.state.selection.main;
    const selectionSnapshot: SelectionSnapshot = {
      from: selection.from,
      to: selection.to,
      text: view.state.sliceDoc(selection.from, selection.to),
    };
    const selectedText = selectionSnapshot.text.trim();
    const notePath = currentNote?.path;

    const insertImageFromSelection = notePath
      ? async () => {
        const result = await requestImageInsert(notePath);
        if (!result) {
          return;
        }
        const insert = buildImageInsertText(result.markdownPath);
        replaceSelectionSnapshot(view, selectionSnapshot, () => ({ insert, anchor: insert.length }));
      }
      : undefined;

    const pasteFromSelection = canReadClipboard()
      ? async () => {
        await pasteIntoSelectionSnapshot(view, selectionSnapshot, notePath);
      }
      : undefined;

    const insertImageFromBlank = notePath
      ? async () => {
        const result = await requestImageInsert(notePath);
        if (!result) {
          return;
        }
        insertTextIntoView(view, buildImageInsertText(result.markdownPath), selectionSnapshot.from);
      }
      : undefined;

    const pasteFromBlank = canReadClipboard()
      ? async () => {
        await pasteIntoCursor(view, notePath, selectionSnapshot.from);
      }
      : undefined;

    event.preventDefault();

    if (selectedText) {
      openContextMenu({
        position: { x: event.clientX, y: event.clientY },
        payload: {
          type: "editorSelection",
          selectedText,
          handlers: {
            paste: pasteFromSelection,
            insertImage: insertImageFromSelection,
            insertLink: () => {
              replaceSelectionSnapshot(view, selectionSnapshot, (text) => {
                const insert = `[${text}]()`;
                return { insert, anchor: text.length + 3 };
              });
            },
            insertTag: () => {
              replaceSelectionSnapshot(view, selectionSnapshot, (text) => {
                const normalized = text.replace(/^#/, "").trim();
                const insert = `#${normalized}`;
                return { insert, anchor: insert.length };
              });
            },
            createWikiLink: () => {
              replaceSelectionSnapshot(view, selectionSnapshot, (text) => {
                const insert = `[[${text}]]`;
                return { insert, anchor: insert.length };
              });
            },
          },
        },
      });
      return;
    }

    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "editorBlank",
        handlers: {
          paste: pasteFromBlank,
          insertImage: insertImageFromBlank,
          insertLink: () => openLinkPicker("markdown"),
          createWikiLink: () => openLinkPicker("wiki"),
          refreshIndex: async () => {
            await refreshTree();
          },
          showSidebar: () => {
            setLeftSidebarVisible(true);
          },
        },
      },
    });
  };

  useEffect(() => {
    if (!linkPickerMode) {
      return;
    }

    const trimmedQuery = linkPickerQuery.trim();
    if (!trimmedQuery) {
      setLinkPickerResults([]);
      setLinkPickerLoading(false);
      setLinkPickerError(null);
      return;
    }

    if (!kb) {
      setLinkPickerResults([]);
      setLinkPickerLoading(false);
      setLinkPickerError("请先打开知识库后再插入内部链接");
      return;
    }

    let isActive = true;
    setLinkPickerLoading(true);
    setLinkPickerError(null);

    api.searchNotes(trimmedQuery, kb.id)
      .then((results) => {
        if (!isActive) {
          return;
        }
        setLinkPickerResults(dedupeSearchResultsByNote(results));
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setLinkPickerResults([]);
        setLinkPickerError("笔记搜索失败，请稍后重试");
      })
      .finally(() => {
        if (isActive) {
          setLinkPickerLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [kb, linkPickerMode, linkPickerQuery]);

  useEffect(() => {
    currentNotePathRef.current = currentNote?.path;
  }, [currentNote?.path]);

  useEffect(() => () => {
    if (copyNoticeTimerRef.current !== null) {
      window.clearTimeout(copyNoticeTimerRef.current);
    }
    cancelKeyboardPasteFallback();
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    const startState = EditorState.create({
      doc: initialContent,
      extensions: [
        history(),
        tagNavigationTargetField,
        searchNavigationTargetField,
        lineNumbers(),
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        inlineTagPlugin,
        searchNavigationPlugin,
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
              suppressEditorContextMenu();
              setPasteFeedbackState("shortcut");
              scheduleKeyboardPasteFallback(view);
              return false;
            }

            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
              void mirrorSelectionToClipboard(view)
                .then((copied) => {
                  if (copied) {
                    showCopiedNotice();
                  }
                })
                .catch(() => undefined);
            }
            return false;
          },
          copy: (event, view) => {
            if (!writeSelectionToClipboardData(view, event.clipboardData)) {
              return false;
            }

            event.preventDefault();
            showCopiedNotice();
            return true;
          },
          paste: (event, view) => {
            suppressEditorContextMenu();
            cancelKeyboardPasteFallback();
            const imageItem = readClipboardImageItem(event.clipboardData);
            const plainText = event.clipboardData?.getData("text/plain") ?? "";
            const htmlText = event.clipboardData?.getData("text/html") ?? "";
            if (imageItem) {
              event.preventDefault();
              setPasteFeedbackState("image");
              void pasteClipboardDataIntoCurrentSelection(
                view,
                event.clipboardData,
                currentNotePathRef.current,
                (pending) => setPasteFeedbackState(pending ? "image" : null),
              );
              return true;
            }

            if (plainText || htmlText) {
              setPasteFeedbackState(null);
              event.preventDefault();
              void pasteClipboardDataIntoCurrentSelection(view, event.clipboardData, currentNotePathRef.current);
              return true;
            }

            event.preventDefault();
            setPasteFeedbackState("image");
            void pasteNativeClipboardImageIntoCurrentSelection(view, currentNotePathRef.current)
              .finally(() => setPasteFeedbackState(null));
            return true;
          },
          compositionstart: () => {
            setIsComposing(true);
            return false;
          },
          compositionend: () => {
            setIsComposing(false);
            return false;
          },
          dragover: (event) => {
            const tagName = readDraggedTagName(event.dataTransfer);
            logTagDrag("editor-dragover", {
              tagName,
              dataTypes: Array.from(event.dataTransfer?.types ?? []),
              clientX: event.clientX,
              clientY: event.clientY,
            });
            if (!tagName) return false;
            event.preventDefault();
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = "copy";
            }
            return true;
          },
          drop: (event, view) => {
            const tagName = readDraggedTagName(event.dataTransfer);
            logTagDrag("editor-drop", {
              tagName,
              dataTypes: Array.from(event.dataTransfer?.types ?? []),
              clientX: event.clientX,
              clientY: event.clientY,
            });
            if (!tagName) return false;
            event.preventDefault();
            const position = getDropPosition(view, event.clientX, event.clientY);
            logTagDrag("insert", { tagName, position });
            insertTagIntoView(view, tagName, position);
            clearActiveDraggedTagName();
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isProgrammaticChange.current) {
            onChange(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", width: "100%", fontSize: "15px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
          ".cm-inline-tag-token": {
            color: "#7c4dff",
            fontStyle: "italic",
            backgroundColor: "rgba(124, 77, 255, 0.08)",
            borderRadius: "4px",
            padding: "0 1px",
          },
          ".cm-inline-tag-navigation-target": {
            color: "#2450c5",
            backgroundColor: "rgba(91, 106, 249, 0.18)",
            boxShadow: "0 0 0 1px rgba(91, 106, 249, 0.24)",
          },
          ".cm-search-navigation-target": {
            backgroundColor: "rgba(255, 212, 92, 0.55)",
            boxShadow: "0 0 0 1px rgba(217, 154, 0, 0.18)",
            borderRadius: "3px",
          },
        }),
      ],
    });

    const view = new EditorView({ state: startState, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      setIsComposing(false);
      if (navigationHighlightTimerRef.current !== null) {
        window.clearTimeout(navigationHighlightTimerRef.current);
      }
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }
      if (suppressContextMenuTimerRef.current !== null) {
        window.clearTimeout(suppressContextMenuTimerRef.current);
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [setIsComposing]);

  useEffect(() => {
    const scroller = viewRef.current?.scrollDOM;
    if (!scroller || !onTopVisibleLineChange) return;

    const handleScroll = () => {
      if (isProgrammaticScroll.current) return;
      const topLine = viewRef.current ? getEditorTopVisibleLine(viewRef.current) : null;
      if (topLine !== null) onTopVisibleLineChange(topLine);
    };

    scroller.addEventListener("scroll", handleScroll);
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [onTopVisibleLineChange]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (navigationHighlightTimerRef.current !== null) {
      window.clearTimeout(navigationHighlightTimerRef.current);
      navigationHighlightTimerRef.current = null;
    }

    view.dispatch({
      effects: setTagNavigationTargetEffect.of(tagNavigationTarget ?? null),
    });

    if (!tagNavigationTarget) return;

    isProgrammaticScroll.current = true;
    scrollEditorToSourceLine(view, tagNavigationTarget.line_start);
    releaseProgrammaticScrollSoon();

    navigationHighlightTimerRef.current = window.setTimeout(() => {
      view.dispatch({ effects: setTagNavigationTargetEffect.of(null) });
      navigationHighlightTimerRef.current = null;
    }, 1600);
  }, [tagNavigationTarget]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: setSearchNavigationTargetEffect.of(searchNavigationTarget ?? null),
    });

    if (!searchNavigationTarget) return;

    isProgrammaticScroll.current = true;
    scrollEditorToSourceLine(view, searchNavigationTarget.line_start);
    releaseProgrammaticScrollSoon();
  }, [searchNavigationTarget]);

  useEffect(() => {
    if (!sourceLineSyncSignal || sourceLineSyncSignal.source === "editor") return;

    const view = viewRef.current;
    if (!view) return;

    isProgrammaticScroll.current = true;
    scrollEditorToSourceLine(view, sourceLineSyncSignal.line);
    releaseProgrammaticScrollSoon();
  }, [sourceLineSyncSignal]);

  useEffect(() => {
    if (!viewRef.current) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (currentContent !== initialContent) {
      isProgrammaticChange.current = true;
      viewRef.current.dispatch({
        changes: { from: 0, to: currentContent.length, insert: initialContent },
      });
      isProgrammaticChange.current = false;
    }
  }, [initialContent]);

  useEffect(() => {
    const handleInsertTag = (event: Event) => {
      const customEvent = event as CustomEvent<InsertTagDetail>;
      const tagName = customEvent.detail?.tagName?.trim();
      const view = viewRef.current;
      if (!view || !tagName) return;
      insertTagIntoView(view, tagName);
    };

    window.addEventListener(INSERT_TAG_EVENT, handleInsertTag as EventListener);
    return () => window.removeEventListener(INSERT_TAG_EVENT, handleInsertTag as EventListener);
  }, []);

  useEffect(() => {
    logTagDrag("global-editor-listener-ready", { mode: "pointer+mouse" });

    const finishGlobalTagDrop = (
      clientX: number,
      clientY: number,
      inputType: string,
      preventDefault: () => void,
    ) => {
      const tagName = getActiveDraggedTagName();
      if (!tagName) return;

      const dropTarget = typeof document.elementFromPoint === "function"
        ? document
          .elementFromPoint(clientX, clientY)
          ?.closest<HTMLElement>(EDITOR_DROP_TARGET_SELECTOR)
        : null;

      logTagDrag("global-up", {
        tagName,
        isEditorDropTarget: Boolean(dropTarget),
        inputType,
        clientX,
        clientY,
      });

      if (!dropTarget) {
        window.setTimeout(() => {
          if (getActiveDraggedTagName() === tagName) {
            clearActiveDraggedTagName();
          }
        }, 0);
        return;
      }

      const view = viewRef.current;
      if (!view) return;
      preventDefault();
      const position = getDropPosition(view, clientX, clientY);
      logTagDrag("global-insert", { tagName, position });
      insertTagIntoView(view, tagName, position);
      clearActiveDraggedTagName();
    };

    const handlePointerUp = (event: PointerEvent) => {
      finishGlobalTagDrop(event.clientX, event.clientY, `pointer:${event.pointerType}`, () => event.preventDefault());
    };

    const handleMouseUp = (event: MouseEvent) => {
      finishGlobalTagDrop(event.clientX, event.clientY, "mouse", () => event.preventDefault());
    };

    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };
  }, []);

  return (
    <>
      <div
        onContextMenuCapture={(event) => {
          // Intercept in capture phase to suppress platform-native callouts before they render.
          event.preventDefault();
          event.stopPropagation();
          handleEditorContextMenu(event);
        }}
        onDragOver={(event) => {
          const tagName = readDraggedTagName(event.dataTransfer);
          logTagDrag("wrapper-dragover", {
            tagName,
            dataTypes: Array.from(event.dataTransfer?.types ?? []),
            clientX: event.clientX,
            clientY: event.clientY,
          });
          if (!tagName) {
            return;
          }
          event.preventDefault();
        }}
        onDrop={handleExternalTagDrop}
        onPointerUp={handlePointerTagDrop}
        data-mynote-editor-drop-target="true"
        style={{ width: "100%", height: "100%", minWidth: 0, overflow: "hidden", position: "relative" }}
      >
        <div ref={editorRef} style={{ width: "100%", height: "100%", minWidth: 0, overflow: "hidden" }} />
        {pasteFeedbackState ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              right: 12,
              bottom: 12,
              padding: "6px 10px",
              borderRadius: 999,
              background: "rgba(15, 23, 42, 0.86)",
              color: "#fff",
              fontSize: 12,
              lineHeight: 1.2,
              boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
              pointerEvents: "none",
            }}
          >
            {pasteFeedbackState === "shortcut" ? "正在处理粘贴..." : "正在粘贴图片..."}
          </div>
        ) : null}
      </div>
      {linkPickerMode ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={linkPickerMode === "wiki" ? "插入双链" : "插入 Markdown 链接"}
          onClick={closeLinkPicker}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
            padding: 20,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              maxHeight: "min(540px, calc(100vh - 40px))",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: "#ffffff",
              borderRadius: 14,
              border: "1px solid rgba(148, 163, 184, 0.28)",
              boxShadow: "0 20px 48px rgba(15, 23, 42, 0.18)",
            }}
          >
            <div style={{ padding: "18px 20px 10px" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>
                {linkPickerMode === "wiki" ? "插入双链" : "插入 Markdown 链接"}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                输入关键词搜索现有笔记，也可以直接输入标题或目标路径后插入。
              </div>
            </div>
            <div style={{ padding: "0 20px 12px" }}>
              <input
                autoFocus
                value={linkPickerQuery}
                onChange={(event) => setLinkPickerQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    closeLinkPicker();
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    insertLinkFromPicker(linkPickerResults[0]);
                  }
                }}
                placeholder="搜索笔记标题或直接输入"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(148, 163, 184, 0.45)",
                  fontSize: 14,
                  color: "#0f172a",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ padding: "0 20px 16px", overflowY: "auto" }}>
              {linkPickerError ? (
                <div style={{ padding: "10px 12px", borderRadius: 10, background: "#fff1f2", color: "#be123c", fontSize: 12 }}>
                  {linkPickerError}
                </div>
              ) : null}
              {!linkPickerError && linkPickerLoading ? (
                <div style={{ padding: "10px 12px", color: "#64748b", fontSize: 12 }}>正在搜索笔记…</div>
              ) : null}
              {!linkPickerError && !linkPickerLoading && linkPickerQuery.trim() && linkPickerResults.length === 0 ? (
                <div style={{ padding: "10px 12px", color: "#64748b", fontSize: 12 }}>
                  未找到匹配笔记，可以直接按回车插入当前输入内容。
                </div>
              ) : null}
              {!linkPickerError && linkPickerResults.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {linkPickerResults.map((result) => (
                    <button
                      key={result.note_id}
                      type="button"
                      aria-label={result.title}
                      onClick={() => insertLinkFromPicker(result)}
                      style={{
                        textAlign: "left",
                        border: "1px solid rgba(148, 163, 184, 0.24)",
                        borderRadius: 10,
                        background: "#f8fafc",
                        padding: "10px 12px",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>{result.title}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{result.path}</div>
                      <div style={{ fontSize: 12, color: "#475569" }}>{result.snippet.replace(/<[^>]+>/g, "")}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={closeLinkPicker}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(148, 163, 184, 0.4)",
                  background: "#ffffff",
                  color: "#334155",
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => insertLinkFromPicker()}
                disabled={!linkPickerQuery.trim()}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: linkPickerQuery.trim() ? "#2450c5" : "#cbd5e1",
                  color: "#ffffff",
                  cursor: linkPickerQuery.trim() ? "pointer" : "not-allowed",
                }}
              >
                插入当前输入
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

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
  const { openContextMenu } = useContextMenu();
  const kb = useAppStore((state) => state.kb);
  const refreshTree = useAppStore((state) => state.refreshTree);
  const setLeftSidebarVisible = useAppStore((state) => state.setLeftSidebarVisible);
  const setIsComposing = useEditorStore((state) => state.setIsComposing);
  const isComposing = useEditorStore((state) => state.isComposing);
  const isProgrammaticChange = useRef(false);
  const isProgrammaticScroll = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const navigationHighlightTimerRef = useRef<number | null>(null);
  const [linkPickerMode, setLinkPickerMode] = useState<LinkInsertMode | null>(null);
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [linkPickerResults, setLinkPickerResults] = useState<SearchResult[]>([]);
  const [linkPickerLoading, setLinkPickerLoading] = useState(false);
  const [linkPickerError, setLinkPickerError] = useState<string | null>(null);

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

    event.preventDefault();

    if (selectedText) {
      openContextMenu({
        position: { x: event.clientX, y: event.clientY },
        payload: {
          type: "editorSelection",
          selectedText,
          handlers: {
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
        keymap.of([...defaultKeymap, ...historyKeymap]),
        inlineTagPlugin,
        searchNavigationPlugin,
        EditorView.domEventHandlers({
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
        onContextMenu={handleEditorContextMenu}
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
        style={{ width: "100%", height: "100%", minWidth: 0, overflow: "hidden" }}
      >
        <div ref={editorRef} style={{ width: "100%", height: "100%", minWidth: 0, overflow: "hidden" }} />
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

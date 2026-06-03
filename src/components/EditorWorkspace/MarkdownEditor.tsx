import { useEffect, useRef } from "react";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { SourceLineSyncSignal } from "./sourceLineSync";
import { findInlineTagMatches } from "./inlineTags";
import { clearActiveDraggedTagName, getActiveDraggedTagName } from "./tagDragState";
import type { SearchNavigationTarget, TagNavigationTarget } from "../../types";
import { useEditorStore } from "../../store/useEditorStore";

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
  const fallbackPosition = view.hasFocus ? view.state.selection.main.head : view.state.doc.length;
  const from = Math.max(0, Math.min(view.state.doc.length, at ?? fallbackPosition));
  view.dispatch({
    changes: { from, to: from, insert: text },
    selection: { anchor: from + text.length },
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
  const setIsComposing = useEditorStore((state) => state.setIsComposing);
  const isProgrammaticChange = useRef(false);
  const isProgrammaticScroll = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const navigationHighlightTimerRef = useRef<number | null>(null);

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
    <div
      onDragOver={(event) => {
        const tagName = readDraggedTagName(event.dataTransfer);
        logTagDrag("wrapper-dragover", {
          tagName,
          dataTypes: Array.from(event.dataTransfer?.types ?? []),
          clientX: event.clientX,
          clientY: event.clientY,
        });
        if (!tagName) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={handleExternalTagDrop}
      onPointerUp={handlePointerTagDrop}
      data-mynote-editor-drop-target="true"
      style={{ width: "100%", height: "100%", minWidth: 0, overflow: "hidden" }}
    >
      <div ref={editorRef} style={{ width: "100%", height: "100%", minWidth: 0, overflow: "hidden" }} />
    </div>
  );
}

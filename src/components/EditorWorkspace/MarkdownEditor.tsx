import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

interface Props {
  initialContent: string;
  onChange: (content: string) => void;
}

export function MarkdownEditor({ initialContent, onChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    const startState = EditorState.create({
      doc: initialContent,
      extensions: [
        history(),
        lineNumbers(),
        markdown({ base: markdownLanguage }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "15px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
        }),
      ],
    });

    const view = new EditorView({ state: startState, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!viewRef.current) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (currentContent !== initialContent) {
      viewRef.current.dispatch({
        changes: { from: 0, to: currentContent.length, insert: initialContent },
      });
    }
  }, [initialContent]);

  return (
    <div ref={editorRef} style={{ flex: 1, height: "100%", overflow: "auto" }} />
  );
}

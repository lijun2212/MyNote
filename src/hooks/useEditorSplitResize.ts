import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "mynote.editorSplitRatio";
const DEFAULT_EDITOR_RATIO = 50;
const MIN_EDITOR_RATIO = 30;
const MAX_EDITOR_RATIO = 75;

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EDITOR_RATIO;
  return Math.min(MAX_EDITOR_RATIO, Math.max(MIN_EDITOR_RATIO, value));
}

function readStoredRatio(): number {
  if (typeof window === "undefined") return DEFAULT_EDITOR_RATIO;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_EDITOR_RATIO;
    return clampRatio(Number(stored));
  } catch {
    return DEFAULT_EDITOR_RATIO;
  }
}

function writeStoredRatio(value: number) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampRatio(value)));
  } catch {
    // Layout preference persistence is best-effort.
  }
}

interface UseEditorSplitResizeOptions {
  containerRef: React.RefObject<HTMLElement | null>;
}

export function useEditorSplitResize({ containerRef }: UseEditorSplitResizeOptions) {
  const [editorRatio, setEditorRatio] = useState(readStoredRatio);
  const [isResizing, setIsResizing] = useState(false);
  const latestRatioRef = useRef(editorRatio);

  useEffect(() => {
    latestRatioRef.current = editorRatio;
  }, [editorRatio]);

  const updateRatioFromClientX = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;

    const nextRatio = clampRatio(((clientX - rect.left) / rect.width) * 100);
    latestRatioRef.current = nextRatio;
    setEditorRatio(nextRatio);
  }, [containerRef]);

  const startResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    updateRatioFromClientX(event.clientX);
  }, [updateRatioFromClientX]);

  const resize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!isResizing) return;
    updateRatioFromClientX(event.clientX);
  }, [isResizing, updateRatioFromClientX]);

  const stopResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!isResizing) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
    writeStoredRatio(latestRatioRef.current);
  }, [isResizing]);

  return {
    editorRatio,
    isResizing,
    minRatio: MIN_EDITOR_RATIO,
    maxRatio: MAX_EDITOR_RATIO,
    startResize,
    resize,
    stopResize,
  };
}
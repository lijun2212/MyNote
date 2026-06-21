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

type ResizeStartEvent = {
  clientX: number;
  preventDefault: () => void;
};

type ResizeMoveEvent = {
  clientX: number;
};

export function useEditorSplitResize({ containerRef }: UseEditorSplitResizeOptions) {
  const [editorRatio, setEditorRatio] = useState(readStoredRatio);
  const [isResizing, setIsResizing] = useState(false);
  const latestRatioRef = useRef(editorRatio);
  const isResizingRef = useRef(false);

  useEffect(() => {
    latestRatioRef.current = editorRatio;
  }, [editorRatio]);

  useEffect(() => {
    isResizingRef.current = isResizing;
  }, [isResizing]);

  const updateRatioFromClientX = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;

    const nextRatio = clampRatio(((clientX - rect.left) / rect.width) * 100);
    latestRatioRef.current = nextRatio;
    setEditorRatio(nextRatio);
  }, [containerRef]);

  const startResize = useCallback((event: ResizeStartEvent) => {
    event.preventDefault();
    setIsResizing(true);
    updateRatioFromClientX(event.clientX);
  }, [updateRatioFromClientX]);

  const resize = useCallback((event: ResizeMoveEvent) => {
    if (!isResizingRef.current) return;
    updateRatioFromClientX(event.clientX);
  }, [updateRatioFromClientX]);

  const stopResize = useCallback(() => {
    if (!isResizingRef.current) return;
    setIsResizing(false);
    writeStoredRatio(latestRatioRef.current);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isResizingRef.current) return;
      updateRatioFromClientX(event.clientX);
    };

    const handlePointerUp = () => {
      if (!isResizingRef.current) return;
      setIsResizing(false);
      writeStoredRatio(latestRatioRef.current);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return;
      updateRatioFromClientX(event.clientX);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      setIsResizing(false);
      writeStoredRatio(latestRatioRef.current);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [updateRatioFromClientX]);

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
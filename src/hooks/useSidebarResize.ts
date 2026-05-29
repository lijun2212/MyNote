import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  side: "left" | "right";
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  defaultVisible: boolean;
}

export function useSidebarResize({
  side,
  defaultWidth,
  minWidth,
  maxWidth,
  defaultVisible,
}: Options) {
  const storageKeyWidth = `mynote:${side}-sidebar:width`;
  const storageKeyVisible = `mynote:${side}-sidebar:visible`;

  const [width, setWidth] = useState<number>(() => {
    const saved = localStorage.getItem(storageKeyWidth);
    return saved ? parseInt(saved, 10) : defaultWidth;
  });
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKeyVisible);
    return saved !== null ? saved === "true" : defaultVisible;
  });

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = side === "left"
        ? e.clientX - startX.current
        : startX.current - e.clientX;
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(next);
    };
    const onUp = () => { isDragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [side, minWidth, maxWidth]);

  useEffect(() => {
    localStorage.setItem(storageKeyWidth, String(width));
  }, [width, storageKeyWidth]);

  useEffect(() => {
    localStorage.setItem(storageKeyVisible, String(isVisible));
  }, [isVisible, storageKeyVisible]);

  const toggleVisible = useCallback(() => setIsVisible((v) => !v), []);

  return { width, isVisible, toggleVisible, handleMouseDown };
}

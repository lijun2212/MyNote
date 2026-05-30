import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "../types";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";

export function useSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const kb = useAppStore((s) => s.kb);
  const kbRef = useRef(kb);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    kbRef.current = kb;
    requestIdRef.current += 1;
  }, [kb]);

  const doSearch = useCallback(async (q: string) => {
    const currentKb = kbRef.current;
    const requestId = ++requestIdRef.current;

    if (!currentKb) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.searchNotes(q, currentKb.id);
      if (requestId !== requestIdRef.current) return;
      if (kbRef.current?.id !== currentKb.id) return;
      setResults(res);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setResults([]);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query.trim()) {
      requestIdRef.current += 1;
      setResults([]);
      setIsLoading(false);
      return;
    }

    timerRef.current = setTimeout(() => {
      doSearch(query);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, doSearch]);

  return { results, isLoading };
}

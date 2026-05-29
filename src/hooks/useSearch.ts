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

  useEffect(() => {
    kbRef.current = kb;
  }, [kb]);

  const doSearch = useCallback(async (q: string) => {
    const currentKb = kbRef.current;
    if (!currentKb) { setResults([]); return; }
    setIsLoading(true);
    try {
      const res = await api.searchNotes(q, currentKb.id);
      setResults(res);
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query.trim()) {
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

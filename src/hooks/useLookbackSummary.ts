import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api/commands";
import { useAiSettingsStore } from "../store/useAiSettingsStore";
import { useEditorStore } from "../store/useEditorStore";
import { useLookbackSummaryStore } from "../store/useLookbackSummaryStore";
import type { SummaryStreamEvent } from "../types";

const SUMMARY_STREAM_EVENT = "summary:stream";

function formatSummaryFallbackReason(reason: string) {
  const trimmedReason = reason.trim();

  if (!trimmedReason) {
    return null;
  }

  if (/AI profile secret not found(?::|$)/i.test(trimmedReason) || /Not found:\s*AI profile secret not found/i.test(trimmedReason)) {
    return "默认 profile 未找到已保存的 API Key；如果刚测试过新配置，请先保存设置。";
  }

  if (/AI profile .* is disabled/i.test(trimmedReason)) {
    return "默认 profile 当前已禁用。";
  }

  if (/AI profile id cannot be blank/i.test(trimmedReason)) {
    return "当前没有可用的默认 profile。";
  }

  return trimmedReason;
}

function formatSummaryFallbackStatus(reason?: string | null) {
  const formattedReason = reason ? formatSummaryFallbackReason(reason) : null;

  if (!formattedReason) {
    return "AI 服务已回退到规则摘要。";
  }

  return `AI 服务已回退到规则摘要：${formattedReason}`;
}

function formatSummaryErrorStatus(error: unknown) {
  const message = toErrorMessage(error).trim();

  if (!message || message === "回看摘要操作失败") {
    return "AI 摘要失败，已回退到规则摘要。";
  }

  return `AI 摘要失败，已回退到规则摘要：${message}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "回看摘要操作失败";
}

function getNoteKey(note: { id: string; path: string } | null): string | null {
  return note ? `${note.id}:${note.path}` : null;
}

function getGenerationPendingStatus(aiEnabled: boolean, defaultProfileId: string | null) {
  return aiEnabled && defaultProfileId ? "AI 正在生成摘要..." : "正在生成摘要...";
}

function splitFrontMatter(content: string) {
  const match = content.match(/^(---\r?\n[\s\S]*?\r?\n---)(?:\r?\n\r?\n?)?/);

  if (!match) {
    return {
      frontMatter: null,
      body: content.trim(),
    };
  }

  return {
    frontMatter: match[1],
    body: content.slice(match[0].length).trim(),
  };
}

function removeSummaryFromFrontMatter(frontMatter: string | null) {
  if (!frontMatter) {
    return null;
  }

  const lines = frontMatter.split(/\r?\n/);
  const preservedLines = [lines[0]];
  let skippingSummaryContinuation = false;

  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index] ?? "";

    if (skippingSummaryContinuation) {
      if (/^[ \t]+/.test(line)) {
        continue;
      }

      skippingSummaryContinuation = false;
    }

    if (/^summary:\s*/.test(line)) {
      const summaryValue = line.slice("summary:".length).trim();
      skippingSummaryContinuation = summaryValue === "" || summaryValue === "|" || summaryValue === ">";
      continue;
    }

    preservedLines.push(line);
  }

  preservedLines.push(lines[lines.length - 1] ?? "---");

  if (preservedLines.slice(1, -1).every((line) => !line.trim())) {
    return null;
  }

  return preservedLines.join("\n");
}

function findLookbackSummaryBlockRange(body: string): [number, number] | null {
  const lines = body.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]?.trimStart().startsWith("> 摘要：")) {
      continue;
    }

    let end = index + 1;
    while (end < lines.length && lines[end]?.trimStart().startsWith("> ")) {
      end += 1;
    }

    return [index, end];
  }

  return null;
}

function removeLookbackSummaryBlock(body: string) {
  const range = findLookbackSummaryBlockRange(body);

  if (!range) {
    return body.trim();
  }

  const lines = body.split(/\r?\n/);
  const nextBody = lines.filter((_, index) => index < range[0] || index >= range[1]).join("\n");
  return nextBody.replace(/\n{3,}/g, "\n\n").trim();
}

function upsertLookbackSummaryBlock(body: string, summary: string) {
  const cleanedBody = removeLookbackSummaryBlock(body);
  const trimmedSummary = summary.trim();

  if (!trimmedSummary) {
    return cleanedBody;
  }

  const summaryLines = trimmedSummary.split(/\r?\n/);
  const summaryBlock = summaryLines
    .map((line, index) => (index === 0 ? `> 摘要：${line.trimEnd()}` : `> ${line.trimEnd()}`))
    .join("\n");
  const bodyLines = cleanedBody.split(/\r?\n/);
  const headingIndex = bodyLines.findIndex((line) => line.trimStart().startsWith("# "));

  if (headingIndex >= 0) {
    const before = bodyLines.slice(0, headingIndex + 1).join("\n").replace(/\s*$/, "");
    const after = bodyLines.slice(headingIndex + 1).join("\n").trim();

    if (!after) {
      return `${before}\n\n${summaryBlock}`;
    }

    return `${before}\n\n${summaryBlock}\n\n${after}`;
  }

  if (!cleanedBody) {
    return summaryBlock;
  }

  return `${summaryBlock}\n\n${cleanedBody}`;
}

function renderSummaryContent(content: string, summary: string) {
  const { frontMatter, body } = splitFrontMatter(content);
  const cleanedFrontMatter = removeSummaryFromFrontMatter(frontMatter);
  const nextBody = upsertLookbackSummaryBlock(body, summary);

  if (!cleanedFrontMatter) {
    return nextBody;
  }

  if (!nextBody) {
    return cleanedFrontMatter;
  }

  return `${cleanedFrontMatter}\n\n${nextBody}`;
}

function applySavedSummaryFallback(savedNote: ReturnType<typeof useEditorStore.getState>["currentNote"], summary: string, setContent: (content: string) => void, markSaved: (note: NonNullable<ReturnType<typeof useEditorStore.getState>["currentNote"]>) => void) {
  if (!savedNote) {
    return;
  }

  const editorState = useEditorStore.getState();
  const nextContent = renderSummaryContent(editorState.content, summary);

  if (editorState.isDirty) {
    useEditorStore.setState({
      currentNote: savedNote,
      content: nextContent,
      isComposing: false,
      isDirty: true,
      isSaving: false,
      saveStatus: "unsaved",
      saveError: null,
    });
    return;
  }

  setContent(nextContent);
  markSaved(savedNote);
}

export function useLookbackSummary() {
  const currentNote = useEditorStore((state) => state.currentNote);
  const setContent = useEditorStore((state) => state.setContent);
  const markSaved = useEditorStore((state) => state.markSaved);
  const aiEnabled = useAiSettingsStore((state) => Boolean(state.settings?.enabled && state.defaultProfile?.enabled));
  const defaultProfileId = useAiSettingsStore((state) => state.defaultProfile?.id ?? null);
  const currentNoteKey = getNoteKey(currentNote);
  const recentViews = useLookbackSummaryStore((state) => (currentNote?.path ? state.getRecentOpenCount(currentNote.path) : 0));
  const shouldPrompt = useLookbackSummaryStore((state) => state.shouldPrompt);
  const markPromptShown = useLookbackSummaryStore((state) => state.markPromptShown);
  const currentNoteKeyRef = useRef(currentNoteKey);
  const generateRequestIdRef = useRef(0);
  const summaryVersionRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const backlinksRequestIdRef = useRef(0);
  const [candidate, setCandidate] = useState("");
  const [savedSummary, setSavedSummary] = useState<string | null>(currentNote?.summary ?? null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [backlinkCount, setBacklinkCount] = useState(0);
  const [suggestedNoteKey, setSuggestedNoteKey] = useState<string | null>(null);

  currentNoteKeyRef.current = currentNoteKey;

  useEffect(() => {
    summaryVersionRef.current += 1;
    const nextSummary = currentNote?.summary ?? null;
    setCandidate(nextSummary ?? "");
    setSavedSummary(nextSummary);
    setIsGenerating(false);
    setIsSaving(false);
    setError(null);
    setGenerationStatus(null);
    setBacklinkCount(0);
    setSuggestedNoteKey(null);
  }, [currentNote?.id, currentNote?.path, currentNote?.summary]);

  async function generateSummary(notePath: string) {
    if (aiEnabled && defaultProfileId) {
      try {
        const aiResult = await api.generateSummaryCandidateWithAi(notePath, defaultProfileId);
        return {
          summary: aiResult.summary,
          status: aiResult.used_fallback ? formatSummaryFallbackStatus(aiResult.provider_trace?.error) : null,
        };
      } catch (error) {
        const fallbackSummary = await api.generateSummaryCandidate(notePath);
        return {
          summary: fallbackSummary,
          status: formatSummaryErrorStatus(error),
        };
      }
    }

    const summary = await api.generateSummaryCandidate(notePath);
    return { summary, status: null };
  }

  useEffect(() => {
    if (!currentNote?.id || !currentNoteKey) {
      return;
    }

    const requestId = backlinksRequestIdRef.current + 1;
    backlinksRequestIdRef.current = requestId;
    const noteKeyAtRequest = currentNoteKey;

    api.getNoteLinks(currentNote.id)
      .then((links) => {
        if (backlinksRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        setBacklinkCount(links.incoming.length);
      })
      .catch(() => {
        if (backlinksRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        setBacklinkCount(0);
      });
  }, [currentNote?.id, currentNoteKey]);

  const baseShouldSuggest = Boolean(
    currentNote
    && !currentNote.summary
    && shouldPrompt(currentNote.path, {
      wordCount: currentNote.word_count,
      recentViews,
      backlinks: backlinkCount,
    }),
  );

  const shouldSuggest = Boolean(
    currentNote
    && !currentNote.summary
    && (baseShouldSuggest || suggestedNoteKey === currentNoteKey),
  );

  useEffect(() => {
    if (!currentNote || currentNote.summary || !currentNoteKey || !baseShouldSuggest || suggestedNoteKey === currentNoteKey) {
      return;
    }

    setSuggestedNoteKey(currentNoteKey);
    markPromptShown(currentNote.path);
  }, [baseShouldSuggest, currentNote, currentNoteKey, markPromptShown, suggestedNoteKey]);

  function isGenerateRequestCurrent(requestId: number, noteKeyAtRequest: string | null, summaryVersionAtRequest: number) {
    return (
      generateRequestIdRef.current === requestId
      && currentNoteKeyRef.current === noteKeyAtRequest
      && summaryVersionRef.current === summaryVersionAtRequest
    );
  }

  async function generateSummaryFromAiStream(
    notePath: string,
    streamRequestId: string,
    requestId: number,
    noteKeyAtRequest: string | null,
    summaryVersionAtRequest: number,
  ) {
    return await new Promise<{ summary: string; status: string | null }>((resolve, reject) => {
      let settled = false;
      let currentSummary = "";
      let dispose = () => {};

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        dispose();
        callback();
      };

      listen<SummaryStreamEvent>(SUMMARY_STREAM_EVENT, (event) => {
        const payload = event.payload;

        if (payload.request_id !== streamRequestId) {
          return;
        }

        if (!isGenerateRequestCurrent(requestId, noteKeyAtRequest, summaryVersionAtRequest)) {
          finish(() => resolve({ summary: currentSummary, status: null }));
          return;
        }

        if (payload.type === "delta") {
          currentSummary = `${currentSummary}${payload.chunk ?? ""}`;
          setCandidate(currentSummary);
          return;
        }

        if (payload.type === "completed") {
          const finalSummary = payload.summary ?? currentSummary;
          finish(() => resolve({
            summary: finalSummary,
            status: payload.used_fallback ? formatSummaryFallbackStatus(payload.provider_trace?.error) : null,
          }));
          return;
        }

        finish(() => reject(new Error(payload.error ?? "回看摘要操作失败")));
      })
        .then((unlisten) => {
          dispose = unlisten;
          return api.generateSummaryCandidateWithAiStream(notePath, streamRequestId, defaultProfileId ?? undefined);
        })
        .catch((error) => {
          finish(() => reject(error));
        });
    });
  }

  async function generateCandidate() {
    if (!currentNote) {
      return;
    }

    const requestId = generateRequestIdRef.current + 1;
    generateRequestIdRef.current = requestId;
    const notePath = currentNote.path;
    const streamRequestId = `summary-${requestId}`;
    const noteKeyAtRequest = currentNoteKey;
    const summaryVersionAtRequest = summaryVersionRef.current;

    setIsGenerating(true);
    setError(null);
    setCandidate("");
    setGenerationStatus(getGenerationPendingStatus(aiEnabled, defaultProfileId));

    try {
      let generationResult;
      if (aiEnabled && defaultProfileId) {
        try {
          generationResult = await generateSummaryFromAiStream(
            notePath,
            streamRequestId,
            requestId,
            noteKeyAtRequest,
            summaryVersionAtRequest,
          );
        } catch (streamError) {
          const fallbackSummary = await api.generateSummaryCandidate(notePath);
          generationResult = {
            summary: fallbackSummary,
            status: formatSummaryErrorStatus(streamError),
          };
        }
      } else {
        generationResult = await generateSummary(notePath);
      }

      if (!isGenerateRequestCurrent(requestId, noteKeyAtRequest, summaryVersionAtRequest)) {
        return;
      }

      setCandidate(generationResult.summary);
      setGenerationStatus(generationResult.status);
    } catch (generationError) {
      if (!isGenerateRequestCurrent(requestId, noteKeyAtRequest, summaryVersionAtRequest)) {
        return;
      }

      setError(toErrorMessage(generationError));
    } finally {
      if (isGenerateRequestCurrent(requestId, noteKeyAtRequest, summaryVersionAtRequest)) {
        setIsGenerating(false);
      }
    }
  }

  async function saveCandidate() {
    if (!currentNote) {
      return;
    }

    const nextSummary = candidate.trim();
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    const notePath = currentNote.path;
    const noteKeyAtRequest = currentNoteKey;

    setIsSaving(true);
    setError(null);

    try {
      const savedNote = await api.saveNoteSummary(notePath, nextSummary);

      if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
        return;
      }

      if (!nextSummary) {
        markPromptShown(notePath);
      }

      setSavedSummary(savedNote.summary ?? null);
      setCandidate(savedNote.summary ?? "");

      try {
        const refreshedDetail = await api.getNoteByPath(notePath);

        if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        setContent(refreshedDetail.content);
        markSaved(refreshedDetail.note);
        setSavedSummary(refreshedDetail.note.summary ?? null);
        setCandidate(refreshedDetail.note.summary ?? "");
      } catch {
        if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        applySavedSummaryFallback(savedNote, nextSummary, setContent, markSaved);
      }
    } catch (saveError) {
      if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
        return;
      }

      setError(toErrorMessage(saveError));
    } finally {
      if (saveRequestIdRef.current === requestId && currentNoteKeyRef.current === noteKeyAtRequest) {
        setIsSaving(false);
      }
    }
  }

  async function clearSummary() {
    if (!currentNote) {
      return;
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    const notePath = currentNote.path;
    const noteKeyAtRequest = currentNoteKey;

    setIsSaving(true);
    setError(null);

    try {
      const savedNote = await api.saveNoteSummary(notePath, "");

      if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
        return;
      }

      markPromptShown(notePath);
      setSavedSummary(savedNote.summary ?? null);
      setCandidate(savedNote.summary ?? "");

      try {
        const refreshedDetail = await api.getNoteByPath(notePath);

        if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        setContent(refreshedDetail.content);
        markSaved(refreshedDetail.note);
        setSavedSummary(refreshedDetail.note.summary ?? null);
        setCandidate(refreshedDetail.note.summary ?? "");
      } catch {
        if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        applySavedSummaryFallback(savedNote, "", setContent, markSaved);
      }
    } catch (saveError) {
      if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
        return;
      }

      setError(toErrorMessage(saveError));
    } finally {
      if (saveRequestIdRef.current === requestId && currentNoteKeyRef.current === noteKeyAtRequest) {
        setIsSaving(false);
      }
    }
  }

  return {
    candidate,
    savedSummary,
    hasSummary: Boolean(savedSummary),
    isGenerating,
    isSaving,
    error,
    generationStatus,
    shouldSuggest,
    generateCandidate,
    saveCandidate,
    clearSummary,
    setCandidate,
  };
}
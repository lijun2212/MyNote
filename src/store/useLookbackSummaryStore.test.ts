import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLookbackSummaryStore } from "./useLookbackSummaryStore";

describe("useLookbackSummaryStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T12:00:00Z"));
    useLookbackSummaryStore.getState().resetForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records recent note opens and throttles prompts within 24 hours", () => {
    const path = "notes/demo.md";

    useLookbackSummaryStore.getState().recordOpen(path);
    useLookbackSummaryStore.getState().recordOpen(path);

    expect(useLookbackSummaryStore.getState().getRecentOpenCount(path)).toBe(2);
    expect(
      useLookbackSummaryStore.getState().shouldPrompt(path, {
        wordCount: 320,
        recentViews: useLookbackSummaryStore.getState().getRecentOpenCount(path),
        backlinks: 0,
      }),
    ).toBe(true);

    useLookbackSummaryStore.getState().markPromptShown(path);

    expect(
      useLookbackSummaryStore.getState().shouldPrompt(path, {
        wordCount: 320,
        recentViews: useLookbackSummaryStore.getState().getRecentOpenCount(path),
        backlinks: 0,
      }),
    ).toBe(false);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

    expect(
      useLookbackSummaryStore.getState().shouldPrompt(path, {
        wordCount: 320,
        recentViews: useLookbackSummaryStore.getState().getRecentOpenCount(path),
        backlinks: 0,
      }),
    ).toBe(true);
  });
});
import { create } from "zustand";

const DAY_MS = 24 * 60 * 60 * 1000;

function pruneRecentOpenTimestamps(timestamps: number[], now: number): number[] {
  return timestamps.filter((timestamp) => now - timestamp < DAY_MS);
}

export interface LookbackSummarySignal {
  wordCount: number;
  recentViews: number;
  backlinks: number;
}

interface LookbackSummaryState {
  recentOpenTimestamps: Record<string, number[]>;
  lastPromptAt: Record<string, number>;
  recordOpen: (path: string) => void;
  getRecentOpenCount: (path: string) => number;
  markPromptShown: (path: string) => void;
  shouldPrompt: (path: string, signal: LookbackSummarySignal) => boolean;
  resetForTest: () => void;
}

export const useLookbackSummaryStore = create<LookbackSummaryState>((set, get) => ({
  recentOpenTimestamps: {},
  lastPromptAt: {},
  recordOpen: (path) => set((state) => {
    const now = Date.now();
    const recentTimestamps = pruneRecentOpenTimestamps(state.recentOpenTimestamps[path] ?? [], now);

    return {
      recentOpenTimestamps: {
        ...state.recentOpenTimestamps,
        [path]: [...recentTimestamps, now],
      },
    };
  }),
  getRecentOpenCount: (path) => {
    const recentTimestamps = pruneRecentOpenTimestamps(get().recentOpenTimestamps[path] ?? [], Date.now());
    return recentTimestamps.length;
  },
  markPromptShown: (path) => set((state) => ({
    lastPromptAt: {
      ...state.lastPromptAt,
      [path]: Date.now(),
    },
  })),
  shouldPrompt: (path, signal) => {
    const lastPromptAt = get().lastPromptAt[path];
    if (typeof lastPromptAt === "number" && Date.now() - lastPromptAt < DAY_MS) {
      return false;
    }

    return signal.wordCount >= 300 || signal.recentViews >= 2 || signal.backlinks >= 1;
  },
  resetForTest: () => set({ recentOpenTimestamps: {}, lastPromptAt: {} }),
}));
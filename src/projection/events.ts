import type { SearchNavigationTarget, TagNavigationTarget } from "../types";

export const PROJECTION_STATE_SYNC_EVENT = "projection:state-sync";
export const PROJECTION_STATE_REQUEST_EVENT = "projection:state-request";
export const PROJECTION_SCROLL_SYNC_EVENT = "projection:scroll-sync";
export const PROJECTION_READY_EVENT = "projection:ready";
export const PROJECTION_CLOSED_EVENT = "projection:closed";
export const PROJECTION_ERROR_EVENT = "projection:error";

export interface ProjectionLifecyclePayload {
  sessionId: number;
}

export interface ProjectionErrorPayload extends ProjectionLifecyclePayload {
  message?: string | null;
}

export interface ProjectionStateSyncPayload {
  sessionId: number;
  revision: number;
  notePath: string | null;
  noteTitle: string | null;
  content: string;
  searchNavigationTarget: SearchNavigationTarget | null;
  tagNavigationTarget: TagNavigationTarget | null;
}

export interface ProjectionScrollSyncPayload {
  sessionId: number;
  revision: number;
  source: "main-editor" | "main-preview";
  topVisibleLine: number;
}
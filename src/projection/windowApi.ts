import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const PROJECTION_WINDOW_LABEL = "projection-preview";
const PROJECTION_WINDOW_ROLE = "projection-preview";
const DEFAULT_PROJECTION_WINDOW_TITLE = "投影预览";

function resolveProjectionWindowTitle(noteTitle?: string | null) {
  const normalizedTitle = noteTitle?.trim();
  return normalizedTitle && normalizedTitle.length > 0 ? normalizedTitle : DEFAULT_PROJECTION_WINDOW_TITLE;
}

export interface ProjectionWindowCapabilities {
  supportsExternalMonitorPlacement: boolean;
  supportsFullscreenProjection: boolean;
}

export async function openProjectionWindow(noteTitle?: string | null) {
  const projectionWindow = new WebviewWindow(PROJECTION_WINDOW_LABEL, {
    title: resolveProjectionWindowTitle(noteTitle),
    url: `/?windowRole=${PROJECTION_WINDOW_ROLE}`,
    visible: true,
    focus: true,
    center: true,
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    void projectionWindow.once("tauri://created", () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    });

    void projectionWindow.once("tauri://error", (event) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(event.payload instanceof Error ? event.payload : new Error(String(event.payload)));
    });
  });

  await projectionWindow.show();
  await projectionWindow.setFocus();

  return projectionWindow;
}

export async function closeProjectionWindow() {
  const projectionWindow = await WebviewWindow.getByLabel(PROJECTION_WINDOW_LABEL);

  if (!projectionWindow) {
    return;
  }

  await projectionWindow.close();
}

export async function emitProjectionState<T>(event: string, payload: T) {
  await emitTo(PROJECTION_WINDOW_LABEL, event, payload);
}

export async function hasProjectionWindow() {
  return (await WebviewWindow.getByLabel(PROJECTION_WINDOW_LABEL)) !== null;
}

export async function setProjectionWindowTitle(noteTitle?: string | null) {
  const projectionWindow = await WebviewWindow.getByLabel(PROJECTION_WINDOW_LABEL);

  if (!projectionWindow) {
    return;
  }

  await projectionWindow.setTitle(resolveProjectionWindowTitle(noteTitle));
}

export function getProjectionWindowCapabilities(): ProjectionWindowCapabilities {
  return {
    supportsExternalMonitorPlacement: false,
    supportsFullscreenProjection: true,
  };
}
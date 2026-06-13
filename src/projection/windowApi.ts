import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const PROJECTION_WINDOW_LABEL = "projection-preview";
const PROJECTION_WINDOW_ROLE = "projection-preview";

export interface ProjectionWindowCapabilities {
  supportsExternalMonitorPlacement: boolean;
  supportsFullscreenProjection: boolean;
}

export async function openProjectionWindow() {
  const projectionWindow = new WebviewWindow(PROJECTION_WINDOW_LABEL, {
    title: "Projection Preview",
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

export function getProjectionWindowCapabilities(): ProjectionWindowCapabilities {
  return {
    supportsExternalMonitorPlacement: false,
    supportsFullscreenProjection: true,
  };
}
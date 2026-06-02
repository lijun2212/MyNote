let activeDraggedTagName: string | null = null;
let pendingClearTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPendingClear() {
  if (pendingClearTimer !== null) {
    clearTimeout(pendingClearTimer);
    pendingClearTimer = null;
  }
}

export function setActiveDraggedTagName(tagName: string | null) {
  cancelPendingClear();
  const normalizedTag = tagName?.trim() ?? "";
  activeDraggedTagName = normalizedTag ? normalizedTag : null;
}

export function getActiveDraggedTagName() {
  return activeDraggedTagName;
}

export function clearActiveDraggedTagName() {
  cancelPendingClear();
  activeDraggedTagName = null;
}

export function scheduleClearActiveDraggedTagName() {
  cancelPendingClear();
  pendingClearTimer = setTimeout(() => {
    pendingClearTimer = null;
    activeDraggedTagName = null;
  }, 0);
}
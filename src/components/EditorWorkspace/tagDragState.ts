let activeDraggedTagName: string | null = null;

export function setActiveDraggedTagName(tagName: string | null) {
  const normalizedTag = tagName?.trim() ?? "";
  activeDraggedTagName = normalizedTag ? normalizedTag : null;
}

export function getActiveDraggedTagName() {
  return activeDraggedTagName;
}

export function clearActiveDraggedTagName() {
  activeDraggedTagName = null;
}
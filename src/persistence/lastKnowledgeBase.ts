const LAST_KNOWLEDGE_BASE_ROOT_PATH_KEY = "mynote:lastKnowledgeBaseRootPath";

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function getLastKnowledgeBaseRootPath() {
  try {
    return getStorage()?.getItem(LAST_KNOWLEDGE_BASE_ROOT_PATH_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveLastKnowledgeBaseRootPath(rootPath: string) {
  try {
    getStorage()?.setItem(LAST_KNOWLEDGE_BASE_ROOT_PATH_KEY, rootPath);
  } catch {
    // Ignore storage failures and continue without startup restore.
  }
}

export function clearLastKnowledgeBaseRootPath() {
  try {
    getStorage()?.removeItem(LAST_KNOWLEDGE_BASE_ROOT_PATH_KEY);
  } catch {
    // Ignore storage failures and continue without startup restore.
  }
}
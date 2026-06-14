import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { ProjectionPreviewShell } from "./components/Projection/ProjectionPreviewShell";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { api } from "./api/commands";
import { clearLastKnowledgeBaseRootPath, getLastKnowledgeBaseRootPath } from "./persistence/lastKnowledgeBase";
import { getCurrentWindowRole } from "./projection/windowRole";
import { useAppStore } from "./store/useAppStore";
import "./styles/global.css";

function MainAppShellRoute() {
  const kb = useAppStore((s) => s.kb);
  const setKb = useAppStore((s) => s.setKb);
  const refreshTree = useAppStore((s) => s.refreshTree);
  const clearKnowledgeBaseSession = useAppStore((s) => s.clearKnowledgeBaseSession);
  const [isRestoringKnowledgeBase, setIsRestoringKnowledgeBase] = useState(() => Boolean(getLastKnowledgeBaseRootPath()));

  useEffect(() => {
    let cancelled = false;
    const lastRootPath = getLastKnowledgeBaseRootPath();

    if (!lastRootPath) {
      setIsRestoringKnowledgeBase(false);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const restoredKnowledgeBase = await api.openKnowledgeBase(lastRootPath);
        if (cancelled) {
          return;
        }

        setKb(restoredKnowledgeBase);
        await refreshTree();
      } catch {
        if (cancelled) {
          return;
        }

        clearLastKnowledgeBaseRootPath();
        clearKnowledgeBaseSession();
      } finally {
        if (!cancelled) {
          setIsRestoringKnowledgeBase(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearKnowledgeBaseSession, refreshTree, setKb]);

  if (isRestoringKnowledgeBase) {
    return null;
  }

  return kb ? <AppShell /> : <WelcomeScreen />;
}

export default function App() {
  const role = getCurrentWindowRole();

  return (
    <ErrorBoundary>
      {role === "projection-preview" ? <ProjectionPreviewShell /> : <MainAppShellRoute />}
    </ErrorBoundary>
  );
}

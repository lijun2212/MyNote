import { AppShell } from "./components/AppShell";
import { ProjectionPreviewShell } from "./components/Projection/ProjectionPreviewShell";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getCurrentWindowRole } from "./projection/windowRole";
import { useAppStore } from "./store/useAppStore";
import "./styles/global.css";

function MainAppShellRoute() {
  const kb = useAppStore((s) => s.kb);

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

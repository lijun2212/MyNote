import { AppShell } from "./components/AppShell";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAppStore } from "./store/useAppStore";
import "./styles/global.css";

export default function App() {
  const kb = useAppStore((s) => s.kb);

  return (
    <ErrorBoundary>
      {kb ? <AppShell /> : <WelcomeScreen />}
    </ErrorBoundary>
  );
}

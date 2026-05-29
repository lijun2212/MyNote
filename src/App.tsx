import { AppShell } from "./components/AppShell";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { useAppStore } from "./store/useAppStore";
import "./styles/global.css";

export default function App() {
  const { kb } = useAppStore();

  if (!kb) return <WelcomeScreen />;
  return <AppShell />;
}

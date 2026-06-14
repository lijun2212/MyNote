import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { tauriMocks } from "./test/setup";
import type { KnowledgeBase } from "./types";

const LAST_KB_STORAGE_KEY = "mynote:lastKnowledgeBaseRootPath";

const openKb: KnowledgeBase = {
  id: "kb-open",
  name: "Archive",
  root_path: "/Users/lijun/Archive",
  created_at: "2026-06-14T00:00:00Z",
  updated_at: "2026-06-14T00:00:00Z",
};

vi.mock("./components/AppShell", () => ({
  AppShell: () => <div data-testid="app-shell" />,
}));

vi.mock("./components/WelcomeScreen", () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen" />,
}));

vi.mock("./components/Projection/ProjectionPreviewShell", () => ({
  ProjectionPreviewShell: () => <div data-testid="projection-preview-shell" />,
}));

vi.mock("./projection/windowRole", () => ({
  getCurrentWindowRole: () => "main",
}));

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens the last knowledge base on startup when a stored path exists", async () => {
    window.localStorage.setItem(LAST_KB_STORAGE_KEY, openKb.root_path);
    tauriMocks.invoke.mockResolvedValue(openKb);

    render(<App />);

    await waitFor(() => {
      expect(tauriMocks.invoke).toHaveBeenCalledWith("open_knowledge_base", {
        rootPath: openKb.root_path,
      });
      expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("welcome-screen")).not.toBeInTheDocument();
  });

  it("clears the stored path and returns to the welcome screen when auto-open fails", async () => {
    window.localStorage.setItem(LAST_KB_STORAGE_KEY, "/Users/lijun/Missing");
    tauriMocks.invoke.mockRejectedValue(new Error("Not a knowledge base"));

    render(<App />);

    await waitFor(() => {
      expect(tauriMocks.invoke).toHaveBeenCalledWith("open_knowledge_base", {
        rootPath: "/Users/lijun/Missing",
      });
      expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
    });

    expect(window.localStorage.getItem(LAST_KB_STORAGE_KEY)).toBeNull();
  });
});
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { AppHeader } from "./AppHeader";

const mockKnowledgeBase = {
  id: "kb-1",
  name: "My KB",
  root_path: "/tmp/kb",
  created_at: "2026-06-04T00:00:00Z",
  updated_at: "2026-06-04T00:00:00Z",
};

vi.mock("./SearchOverlay", () => ({
  SearchOverlay: () => <div>Search Overlay</div>,
}));

describe("AppHeader", () => {
  beforeEach(() => {
    useAppStore.setState({ kb: mockKnowledgeBase });
  });

  afterEach(() => {
    useAppStore.setState({ kb: null });
  });

  it("opens the search overlay when the app menu dispatches the search event", () => {
    let openSearchListener: EventListener | null = null;
    const originalAddEventListener = window.addEventListener.bind(window);
    const addEventListenerSpy = vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "mynote:open-search") {
        openSearchListener = listener as EventListener;
      }
      originalAddEventListener(type, listener, options);
    });

    render(<AppHeader />);

    expect(openSearchListener).not.toBeNull();

    act(() => {
      openSearchListener?.(new Event("mynote:open-search"));
    });

    expect(screen.getByText("Search Overlay")).toBeInTheDocument();

    addEventListenerSpy.mockRestore();
  });

  it("uses the shared bright blue hover style for the search button", async () => {
    const user = userEvent.setup();

    render(<AppHeader />);

    const searchButton = screen.getByTitle("搜索 (⌘K)");

    expect(searchButton).toHaveStyle({
      color: "#475467",
    });

    await user.hover(searchButton);

    expect(searchButton).toHaveStyle({
      color: "#0969da",
    });
  });

  it("renders the search button with a linear svg icon", () => {
    render(<AppHeader />);

    const searchButton = screen.getByTitle("搜索 (⌘K)");

    expect(searchButton.querySelector("svg")).not.toBeNull();
    expect(searchButton).not.toHaveTextContent("🔍");
  });
});
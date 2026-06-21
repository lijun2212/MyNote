import { act, renderHook } from "@testing-library/react";
import type { EventCallback } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROJECTION_CLOSED_EVENT,
  PROJECTION_ERROR_EVENT,
  PROJECTION_READY_EVENT,
} from "../projection/events";
import { useProjectionStore } from "../store/useProjectionStore";
import { tauriMocks } from "../test/setup";
import { useProjectionLifecycle } from "./useProjectionLifecycle";

describe("useProjectionLifecycle", () => {
  beforeEach(() => {
    useProjectionStore.getState().resetForTest();
  });

  async function flushListenerRegistration() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function mockProjectionListeners() {
    const listeners = new Map<string, EventCallback<unknown>>();

    tauriMocks.listen.mockImplementation(async (eventName: string, callback: EventCallback<unknown>) => {
      listeners.set(eventName, callback);
      return () => undefined;
    });

    return listeners;
  }

  it("marks the projection window ready after the ready event", async () => {
    const listeners = mockProjectionListeners();

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    const sessionId = useProjectionStore.getState().beginSession();

    const readyListener = listeners.get(PROJECTION_READY_EVENT);
    expect(readyListener).toBeTypeOf("function");

    await act(async () => {
      await readyListener?.({ event: PROJECTION_READY_EVENT, id: -1, payload: { sessionId } });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionEnabled: true,
      projectionWindowReady: true,
    });
  });

  it("marks projection closed after the closed event", async () => {
    const listeners = mockProjectionListeners();

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    const sessionId = useProjectionStore.getState().beginSession();
    act(() => {
      useProjectionStore.getState().setReady(true);
    });

    const closedListener = listeners.get(PROJECTION_CLOSED_EVENT);
    expect(closedListener).toBeTypeOf("function");

    await act(async () => {
      await closedListener?.({ event: PROJECTION_CLOSED_EVENT, id: -1, payload: { sessionId } });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionEnabled: false,
      projectionWindowReady: false,
    });
  });

  it("marks projection closed after the projection window is destroyed", async () => {
    const listeners = mockProjectionListeners();
    tauriMocks.getWebviewWindowByLabel.mockResolvedValue(null);

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    useProjectionStore.getState().beginSession();
    act(() => {
      useProjectionStore.getState().setReady(true);
    });

    const destroyedListener = listeners.get("tauri://destroyed");
    expect(destroyedListener).toBeTypeOf("function");

    await act(async () => {
      await destroyedListener?.({ event: "tauri://destroyed", id: -1, payload: null });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionEnabled: false,
      projectionSessionRequested: false,
      projectionWindowReady: false,
    });
  });

  it("marks projection closed when the window is manually destroyed before the ready event returns", async () => {
    const listeners = mockProjectionListeners();
    tauriMocks.getWebviewWindowByLabel.mockResolvedValue(null);

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    useProjectionStore.getState().beginSession();

    const destroyedListener = listeners.get("tauri://destroyed");
    expect(destroyedListener).toBeTypeOf("function");

    await act(async () => {
      await destroyedListener?.({ event: "tauri://destroyed", id: -1, payload: null });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionEnabled: false,
      projectionSessionRequested: false,
      projectionWindowReady: false,
    });
  });

  it("marks projection closed and stores the error after the error event", async () => {
    const listeners = mockProjectionListeners();

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    const sessionId = useProjectionStore.getState().beginSession();
    act(() => {
      useProjectionStore.getState().setReady(true);
    });

    const errorListener = listeners.get(PROJECTION_ERROR_EVENT);
    expect(errorListener).toBeTypeOf("function");

    await act(async () => {
      await errorListener?.({ event: PROJECTION_ERROR_EVENT, id: -1, payload: { sessionId, message: "窗口启动失败" } });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionEnabled: false,
      projectionWindowReady: false,
      projectionLastError: "窗口启动失败",
    });
  });

  it("ignores a late ready event after projection has already closed", async () => {
    const listeners = mockProjectionListeners();

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    const sessionId = useProjectionStore.getState().beginSession();

    act(() => {
      useProjectionStore.getState().markClosed();
    });

    const readyListener = listeners.get(PROJECTION_READY_EVENT);
    expect(readyListener).toBeTypeOf("function");

    await act(async () => {
      await readyListener?.({ event: PROJECTION_READY_EVENT, id: -1, payload: { sessionId } });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionEnabled: false,
      projectionWindowReady: false,
    });
  });

  it("ignores a late error event after projection has already closed", async () => {
    const listeners = mockProjectionListeners();

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    const sessionId = useProjectionStore.getState().beginSession();

    act(() => {
      useProjectionStore.getState().markClosed();
    });

    const errorListener = listeners.get(PROJECTION_ERROR_EVENT);
    expect(errorListener).toBeTypeOf("function");

    await act(async () => {
      await errorListener?.({ event: PROJECTION_ERROR_EVENT, id: -1, payload: { sessionId, message: "迟到错误" } });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionEnabled: false,
      projectionWindowReady: false,
      projectionLastError: null,
    });
  });

  it("ignores a previous session ready event after a new projection session starts", async () => {
    const listeners = mockProjectionListeners();

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    const firstSessionId = useProjectionStore.getState().beginSession();

    act(() => {
      useProjectionStore.getState().markClosed();
    });

    const secondSessionId = useProjectionStore.getState().beginSession();
    const readyListener = listeners.get(PROJECTION_READY_EVENT);
    expect(readyListener).toBeTypeOf("function");

    await act(async () => {
      await readyListener?.({ event: PROJECTION_READY_EVENT, id: -1, payload: { sessionId: firstSessionId } });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionId: secondSessionId,
      projectionEnabled: true,
      projectionWindowReady: false,
    });
  });

  it("ignores a previous session error event after a new projection session starts", async () => {
    const listeners = mockProjectionListeners();

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    const firstSessionId = useProjectionStore.getState().beginSession();

    act(() => {
      useProjectionStore.getState().markClosed();
    });

    const secondSessionId = useProjectionStore.getState().beginSession();
    const errorListener = listeners.get(PROJECTION_ERROR_EVENT);
    expect(errorListener).toBeTypeOf("function");

    await act(async () => {
      await errorListener?.({ event: PROJECTION_ERROR_EVENT, id: -1, payload: { sessionId: firstSessionId, message: "旧会话错误" } });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionId: secondSessionId,
      projectionEnabled: true,
      projectionWindowReady: false,
      projectionLastError: null,
    });
  });

  it("ignores a previous session destroyed event after a new projection session starts", async () => {
    const listeners = mockProjectionListeners();
    tauriMocks.getWebviewWindowByLabel.mockResolvedValue({ close: vi.fn() });

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    useProjectionStore.getState().beginSession();
    act(() => {
      useProjectionStore.getState().markClosed();
    });

    const secondSessionId = useProjectionStore.getState().beginSession();
    const destroyedListener = listeners.get("tauri://destroyed");
    expect(destroyedListener).toBeTypeOf("function");

    await act(async () => {
      await destroyedListener?.({ event: "tauri://destroyed", id: -1, payload: null });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionId: secondSessionId,
      projectionSessionRequested: true,
      projectionEnabled: true,
      projectionWindowReady: false,
    });
  });

  it("ignores a previous session destroyed event even after the new session is ready", async () => {
    const listeners = mockProjectionListeners();
    tauriMocks.getWebviewWindowByLabel.mockResolvedValue({ close: vi.fn() });

    renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    useProjectionStore.getState().beginSession();
    act(() => {
      useProjectionStore.getState().markClosed();
    });

    const secondSessionId = useProjectionStore.getState().beginSession();
    act(() => {
      useProjectionStore.getState().setReady(true);
    });

    const destroyedListener = listeners.get("tauri://destroyed");
    expect(destroyedListener).toBeTypeOf("function");

    await act(async () => {
      await destroyedListener?.({ event: "tauri://destroyed", id: -1, payload: null });
    });

    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionId: secondSessionId,
      projectionSessionRequested: true,
      projectionEnabled: true,
      projectionWindowReady: true,
    });
  });

  it("cleans up all projection listeners on unmount", async () => {
    const readyUnlisten = vi.fn();
    const closedUnlisten = vi.fn();
    const errorUnlisten = vi.fn();

    tauriMocks.listen.mockImplementation(async (eventName: string) => {
      if (eventName === PROJECTION_READY_EVENT) {
        return readyUnlisten;
      }
      if (eventName === PROJECTION_CLOSED_EVENT) {
        return closedUnlisten;
      }
      if (eventName === PROJECTION_ERROR_EVENT) {
        return errorUnlisten;
      }

      return () => undefined;
    });

    const { unmount } = renderHook(() => useProjectionLifecycle());

    await flushListenerRegistration();

    unmount();

    expect(readyUnlisten).toHaveBeenCalledTimes(1);
    expect(closedUnlisten).toHaveBeenCalledTimes(1);
    expect(closedUnlisten).toHaveBeenCalledTimes(1);
    expect(errorUnlisten).toHaveBeenCalledTimes(1);
  });
});
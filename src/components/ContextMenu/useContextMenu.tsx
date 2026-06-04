import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ContextMenuRequest } from "./contextMenuTypes";

interface ContextMenuController {
  request: ContextMenuRequest | null;
  openContextMenu: (request: ContextMenuRequest) => void;
  closeContextMenu: () => void;
}

const noop = () => undefined;

const defaultContextMenuController: ContextMenuController = {
  request: null,
  openContextMenu: noop,
  closeContextMenu: noop,
};

const ContextMenuContext = createContext<ContextMenuController>(defaultContextMenuController);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ContextMenuRequest | null>(null);

  const openContextMenu = useCallback((nextRequest: ContextMenuRequest) => {
    setRequest(nextRequest);
  }, []);

  const closeContextMenu = useCallback(() => {
    setRequest(null);
  }, []);

  const value = useMemo(() => ({
    request,
    openContextMenu,
    closeContextMenu,
  }), [closeContextMenu, openContextMenu, request]);

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu() {
  return useContext(ContextMenuContext);
}
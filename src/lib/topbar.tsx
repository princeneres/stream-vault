import {
  createContext,
  useContext,
  useEffect,
  type DependencyList,
  type ReactNode,
} from "react";

interface TopBarSlotValue {
  setActions: (node: ReactNode | null) => void;
}

const TopBarSlotContext = createContext<TopBarSlotValue | null>(null);

export function TopBarSlotProvider({
  setActions,
  children,
}: {
  setActions: (node: ReactNode | null) => void;
  children: ReactNode;
}) {
  return (
    <TopBarSlotContext.Provider value={{ setActions }}>
      {children}
    </TopBarSlotContext.Provider>
  );
}

/**
 * Register contextual actions in the TopBar from within a view. The node is
 * cleared on unmount or when `deps` change. Views call this near the top of
 * their render.
 */
export function useTopBarActions(node: ReactNode, deps: DependencyList): void {
  const ctx = useContext(TopBarSlotContext);
  useEffect(() => {
    ctx?.setActions(node);
    return () => ctx?.setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

import { useCallback, useEffect, useReducer, useRef } from "react";

export type Route =
  | { kind: "home" }
  | { kind: "library"; id: number }
  | { kind: "group"; id: number }
  | { kind: "settings" };

/**
 * Returns the parsed Route for a known hash path, or null if the hash is
 * an unrelated anchor (e.g. "#main" skip link target).
 */
export function parseHash(hash: string): Route | null {
  const stripped = hash.replace(/^#/, "");
  if (stripped === "" || stripped === "/") return { kind: "home" };
  if (!stripped.startsWith("/")) return null;
  if (stripped === "/settings") return { kind: "settings" };
  const lib = stripped.match(/^\/library\/(\d+)$/);
  if (lib) return { kind: "library", id: Number(lib[1]) };
  const grp = stripped.match(/^\/group\/(\d+)$/);
  if (grp) return { kind: "group", id: Number(grp[1]) };
  return { kind: "home" };
}

export function routeToPath(r: Route): string {
  switch (r.kind) {
    case "home":
      return "/";
    case "library":
      return `/library/${r.id}`;
    case "group":
      return `/group/${r.id}`;
    case "settings":
      return "/settings";
  }
}

export interface NavHistory {
  route: Route;
  /** Push a new entry (drops any forward history). */
  navigate: (r: Route) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
}

interface HistoryState {
  stack: Route[];
  index: number;
}

type HistoryAction =
  | { type: "PUSH"; route: Route }
  | { type: "BACK" }
  | { type: "FORWARD" }
  | { type: "EXTERNAL"; route: Route };

function sameRoute(a: Route, b: Route): boolean {
  return routeToPath(a) === routeToPath(b);
}

function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "PUSH":
    case "EXTERNAL": {
      if (sameRoute(state.stack[state.index], action.route)) return state;
      const truncated = state.stack.slice(0, state.index + 1);
      return { stack: [...truncated, action.route], index: truncated.length };
    }
    case "BACK":
      return state.index > 0 ? { ...state, index: state.index - 1 } : state;
    case "FORWARD":
      return state.index < state.stack.length - 1
        ? { ...state, index: state.index + 1 }
        : state;
  }
}

function initialState(): HistoryState {
  const route =
    typeof window === "undefined"
      ? { kind: "home" as const }
      : parseHash(window.location.hash) ?? { kind: "home" as const };
  return { stack: [route], index: 0 };
}

/**
 * In-memory navigation history layered over the URL hash. The hash is kept in
 * sync (so reload restores the route and the skip link works), but back/forward
 * and the canBack/canForward flags come from the explicit stack.
 */
export function useHistory(): NavHistory {
  const [state, dispatch] = useReducer(historyReducer, undefined, initialState);
  const route = state.stack[state.index];

  // Track hashes we set ourselves so the hashchange listener can ignore them.
  const selfHashRef = useRef<string | null>(null);

  // Keep the URL hash in sync with the active route.
  useEffect(() => {
    const next = "#" + routeToPath(route);
    if (window.location.hash !== next) {
      selfHashRef.current = next;
      window.location.hash = next;
    }
  }, [route]);

  // React to external hash changes (manual edits, native back gestures).
  useEffect(() => {
    const onChange = () => {
      if (selfHashRef.current === window.location.hash) {
        selfHashRef.current = null;
        return;
      }
      const next = parseHash(window.location.hash);
      if (next !== null) dispatch({ type: "EXTERNAL", route: next });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((r: Route) => dispatch({ type: "PUSH", route: r }), []);
  const back = useCallback(() => dispatch({ type: "BACK" }), []);
  const forward = useCallback(() => dispatch({ type: "FORWARD" }), []);

  return {
    route,
    navigate,
    back,
    forward,
    canBack: state.index > 0,
    canForward: state.index < state.stack.length - 1,
  };
}

/** Backwards-compatible thin wrapper. */
export function useRoute(): [Route, (r: Route) => void] {
  const { route, navigate } = useHistory();
  return [route, navigate];
}

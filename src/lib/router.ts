import { useCallback, useEffect, useState } from "react";

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

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => {
    if (typeof window === "undefined") return { kind: "home" };
    return parseHash(window.location.hash) ?? { kind: "home" };
  });

  useEffect(() => {
    const onChange = () => {
      const next = parseHash(window.location.hash);
      if (next !== null) setRoute(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((r: Route) => {
    const next = "#" + routeToPath(r);
    if (window.location.hash !== next) {
      window.location.hash = next;
    } else {
      setRoute(r);
    }
  }, []);

  return [route, navigate];
}

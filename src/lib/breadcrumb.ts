import { useEffect, useRef, useState } from "react";
import { getGroup } from "@/lib/api";
import type { Route } from "@/lib/router";
import type { Group, Library } from "@/lib/types";

export interface Crumb {
  label: string;
  /** Omitted on the current (last) crumb. */
  onNavigate?: () => void;
}

/**
 * Resolves the breadcrumb trail for the active route. Library names come from
 * the already-loaded `libraries` list (no fetch); group ancestors are walked
 * via `parentGroupId`, cached in a ref to avoid refetching across navigation.
 */
export function useBreadcrumb(
  route: Route,
  libraries: Library[],
  navigate: (r: Route) => void,
): Crumb[] {
  const cache = useRef<Map<number, Group>>(new Map());
  const [chain, setChain] = useState<Group[]>([]);

  useEffect(() => {
    if (route.kind !== "group") {
      setChain([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const acc: Group[] = [];
      let cursor: number | null = route.id;
      while (cursor != null) {
        let g = cache.current.get(cursor);
        if (!g) {
          try {
            const detail = await getGroup(cursor);
            g = detail.group;
            cache.current.set(cursor, g);
          } catch {
            break;
          }
        }
        acc.unshift(g);
        cursor = g.parentGroupId;
      }
      if (!cancelled) setChain(acc);
    })();

    return () => {
      cancelled = true;
    };
  }, [route]);

  const home: Crumb = { label: "Home", onNavigate: () => navigate({ kind: "home" }) };

  if (route.kind === "home") return [{ label: "Home" }];
  if (route.kind === "settings") return [home, { label: "Settings" }];

  if (route.kind === "library") {
    const lib = libraries.find((l) => l.id === route.id);
    return [home, { label: lib?.name ?? "Library" }];
  }

  // group
  const libId = chain[0]?.libraryId;
  const lib = libId != null ? libraries.find((l) => l.id === libId) : undefined;
  const crumbs: Crumb[] = [home];
  if (lib) {
    crumbs.push({
      label: lib.name,
      onNavigate: () => navigate({ kind: "library", id: lib.id }),
    });
  }
  chain.forEach((g, i) => {
    const isLast = i === chain.length - 1;
    crumbs.push({
      label: g.title,
      onNavigate: isLast
        ? undefined
        : () => navigate({ kind: "group", id: g.id }),
    });
  });
  return crumbs;
}

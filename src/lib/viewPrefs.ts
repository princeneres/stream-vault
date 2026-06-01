import { useCallback, useEffect, useState } from "react";
import type { Group, ItemWithProgress } from "./types";

export type SortKey = "default" | "name" | "recent" | "progress";
export type FilterKey = "all" | "in-progress" | "completed" | "unwatched";

export interface ViewPrefs {
  sort: SortKey;
  filter: FilterKey;
}

export const DEFAULT_PREFS: ViewPrefs = { sort: "default", filter: "all" };

const SORT_LABELS: Record<SortKey, string> = {
  default: "Default",
  name: "Name (A–Z)",
  recent: "Recently watched",
  progress: "Progress",
};

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  "in-progress": "In progress",
  completed: "Completed",
  unwatched: "Unwatched",
};

export const SORT_OPTIONS = Object.entries(SORT_LABELS) as [SortKey, string][];
export const FILTER_OPTIONS = Object.entries(FILTER_LABELS) as [
  FilterKey,
  string,
][];

const PREFS_PREFIX = "streamvault:view-prefs:";

function loadPrefs(scope: string): ViewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_PREFIX + scope);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ViewPrefs>;
      return {
        sort: p.sort && p.sort in SORT_LABELS ? p.sort : DEFAULT_PREFS.sort,
        filter:
          p.filter && p.filter in FILTER_LABELS
            ? p.filter
            : DEFAULT_PREFS.filter,
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

/**
 * Per-scope view preferences persisted to localStorage. `scope` is a stable
 * key like `lib:3` or `grp:42`; prefs reload when the scope changes so each
 * library/group remembers its own sort & filter across navigation and reload.
 */
export function useViewPrefs(
  scope: string,
): [ViewPrefs, (next: ViewPrefs) => void] {
  const [prefs, setPrefs] = useState<ViewPrefs>(() => loadPrefs(scope));

  useEffect(() => {
    setPrefs(loadPrefs(scope));
  }, [scope]);

  const update = useCallback(
    (next: ViewPrefs) => {
      setPrefs(next);
      try {
        localStorage.setItem(PREFS_PREFIX + scope, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [scope],
  );

  return [prefs, update];
}

function itemProgressPct(item: ItemWithProgress): number {
  if (!item.progress || !item.durationSeconds || item.durationSeconds <= 0) {
    return 0;
  }
  return item.progress.positionSeconds / item.durationSeconds;
}

export function applyItemPrefs(
  items: ItemWithProgress[],
  prefs: ViewPrefs,
): ItemWithProgress[] {
  const filtered = items.filter((it) => {
    switch (prefs.filter) {
      case "in-progress":
        return it.progress !== null && !it.progress.completed;
      case "completed":
        return it.progress?.completed === true;
      case "unwatched":
        return it.progress === null;
      default:
        return true;
    }
  });
  const sorted = [...filtered];
  switch (prefs.sort) {
    case "name":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "recent":
      sorted.sort((a, b) => {
        const ta = a.progress ? Date.parse(a.progress.watchedAt) : 0;
        const tb = b.progress ? Date.parse(b.progress.watchedAt) : 0;
        return tb - ta;
      });
      break;
    case "progress":
      sorted.sort((a, b) => itemProgressPct(b) - itemProgressPct(a));
      break;
    case "default":
      sorted.sort((a, b) => a.position - b.position || a.id - b.id);
      break;
  }
  return sorted;
}

export function applyGroupPrefs(
  groups: Group[],
  prefs: ViewPrefs,
): Group[] {
  const filtered = groups.filter((g) => {
    if (g.itemCount === 0) return prefs.filter === "all";
    const completed = g.completedCount >= g.itemCount;
    const started = g.completedCount > 0;
    switch (prefs.filter) {
      case "completed":
        return completed;
      case "unwatched":
        return !started;
      case "in-progress":
        return started && !completed;
      default:
        return true;
    }
  });
  const sorted = [...filtered];
  switch (prefs.sort) {
    case "name":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "progress":
      sorted.sort((a, b) => {
        const pa = a.itemCount === 0 ? 0 : a.completedCount / a.itemCount;
        const pb = b.itemCount === 0 ? 0 : b.completedCount / b.itemCount;
        return pb - pa;
      });
      break;
    case "default":
    case "recent":
      sorted.sort((a, b) => a.position - b.position || a.id - b.id);
      break;
  }
  return sorted;
}

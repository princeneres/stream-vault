import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Play } from "lucide-react";
import {
  convertFileSrc,
  getLibraryPlaylist,
  onItemProgress,
  setItemCompleted,
} from "@/lib/api";
import type { Group, ItemWithProgress } from "@/lib/types";
import { cn } from "./cn";

export interface PlayerSidebarProps {
  /** Library whose full contents are listed. */
  libraryId: number;
  /** Group the current item belongs to (used to auto-expand). */
  currentGroupId: number | null;
  /** The item currently loaded in the player. */
  currentItemId: number;
  /** Switch the player to another item. */
  onSelect: (itemId: number) => void;
}

const COMPLETION_FRACTION = 0.9;

/** Side panel that lists every video in the whole library as a collapsible
 *  tree, letting the user jump between them and toggle completed state without
 *  leaving the player. The library is fetched once per library id; switching
 *  items only updates highlight/expansion, never refetches. */
export default function PlayerSidebar({
  libraryId,
  currentGroupId,
  currentItemId,
  onSelect,
}: PlayerSidebarProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [items, setItems] = useState<ItemWithProgress[]>([]);
  const [libraryName, setLibraryName] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const pl = await getLibraryPlaylist(libraryId);
        if (cancelled) return;
        setGroups(pl.groups);
        setItems(pl.items);
        setLibraryName(pl.library.name);
      } catch (e) {
        console.error("PlayerSidebar: getLibraryPlaylist failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryId]);

  // Keep completed checkmarks live as the player reports progress, without
  // refetching the whole library.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onItemProgress((u) => {
      if (u.durationSeconds <= 0) return;
      const done = u.positionSeconds / u.durationSeconds >= COMPLETION_FRACTION;
      if (!done) return;
      setItems((prev) =>
        prev.map((it) =>
          it.id === u.itemId && !it.progress?.completed
            ? {
                ...it,
                progress: {
                  itemId: it.id,
                  positionSeconds: u.positionSeconds,
                  completed: true,
                  watchedAt:
                    it.progress?.watchedAt ?? new Date().toISOString(),
                },
              }
            : it,
        ),
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // Index the tree: child groups by parent, items by group.
  const { childGroups, itemsByGroup, rootGroups, topItems, parentOf } =
    useMemo(() => {
      const childGroups = new Map<number, Group[]>();
      const parentOf = new Map<number, number | null>();
      const rootGroups: Group[] = [];
      for (const g of groups) {
        parentOf.set(g.id, g.parentGroupId);
        if (g.parentGroupId == null) {
          rootGroups.push(g);
        } else {
          const arr = childGroups.get(g.parentGroupId) ?? [];
          arr.push(g);
          childGroups.set(g.parentGroupId, arr);
        }
      }
      const itemsByGroup = new Map<number, ItemWithProgress[]>();
      const topItems: ItemWithProgress[] = [];
      for (const it of items) {
        if (it.groupId == null) {
          topItems.push(it);
        } else {
          const arr = itemsByGroup.get(it.groupId) ?? [];
          arr.push(it);
          itemsByGroup.set(it.groupId, arr);
        }
      }
      return { childGroups, itemsByGroup, rootGroups, topItems, parentOf };
    }, [groups, items]);

  // Auto-expand the path from root down to the current item's group whenever
  // the current item changes. Preserves any groups the user toggled manually.
  const lastExpandedFor = useRef<number | null>(null);
  useEffect(() => {
    if (currentGroupId == null || parentOf.size === 0) return;
    if (lastExpandedFor.current === currentItemId) return;
    lastExpandedFor.current = currentItemId;
    setExpanded((prev) => {
      const next = new Set(prev);
      let gid: number | null | undefined = currentGroupId;
      while (gid != null) {
        next.add(gid);
        gid = parentOf.get(gid) ?? null;
      }
      return next;
    });
  }, [currentItemId, currentGroupId, parentOf]);

  const toggleGroup = useCallback((groupId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const toggleCompleted = useCallback(async (item: ItemWithProgress) => {
    const completed = !item.progress?.completed;
    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? {
              ...it,
              progress: {
                itemId: it.id,
                positionSeconds: it.progress?.positionSeconds ?? 0,
                completed,
                watchedAt: it.progress?.watchedAt ?? new Date().toISOString(),
              },
            }
          : it,
      ),
    );
    try {
      await setItemCompleted(item.id, completed);
    } catch (e) {
      console.error("setItemCompleted failed", e);
    }
  }, []);

  const renderItem = useCallback(
    (it: ItemWithProgress, depth: number) => {
      const isCurrent = it.id === currentItemId;
      const completed = it.progress?.completed ?? false;
      return (
        <li key={`i${it.id}`}>
          <div
            style={{ paddingLeft: 12 + depth * 14 }}
            className={cn(
              "flex items-center gap-2 pr-2",
              isCurrent
                ? "bg-(--color-surface-raised)"
                : "hover:bg-(--color-surface-raised)/60",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(it.id)}
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
              title={it.title}
            >
              <div className="relative h-8 w-12 shrink-0 overflow-hidden rounded-(--radius-control) bg-(--color-surface-raised)">
                {it.thumbnailPath ? (
                  <img
                    src={convertFileSrc(it.thumbnailPath)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : null}
                {isCurrent ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-(--color-accent)">
                    <Play size={14} fill="currentColor" />
                  </span>
                ) : null}
              </div>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  isCurrent
                    ? "font-medium text-(--color-text-primary)"
                    : completed
                      ? "text-(--color-text-muted)"
                      : "text-(--color-text-secondary)",
                )}
              >
                {it.title}
              </span>
            </button>
            <button
              type="button"
              onClick={() => toggleCompleted(it)}
              title={completed ? "Mark as not watched" : "Mark as watched"}
              aria-label={completed ? "Mark as not watched" : "Mark as watched"}
              aria-pressed={completed}
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                completed
                  ? "border-(--color-accent) bg-(--color-accent) text-(--color-text-inverse)"
                  : "border-(--color-border-subtle) text-(--color-text-muted) hover:border-(--color-accent) hover:text-(--color-text-primary)",
              )}
            >
              {completed ? <Check size={12} /> : null}
            </button>
          </div>
        </li>
      );
    },
    [currentItemId, onSelect, toggleCompleted],
  );

  const renderGroup = useCallback(
    (group: Group, depth: number): React.ReactNode => {
      const isOpen = expanded.has(group.id);
      const subgroups = childGroups.get(group.id) ?? [];
      const groupItems = itemsByGroup.get(group.id) ?? [];
      return (
        <li key={`g${group.id}`}>
          <button
            type="button"
            onClick={() => toggleGroup(group.id)}
            style={{ paddingLeft: 8 + depth * 14 }}
            className="flex w-full items-center gap-1.5 py-1.5 pr-2 text-left hover:bg-(--color-surface-raised)/60"
            aria-expanded={isOpen}
          >
            {isOpen ? (
              <ChevronDown size={14} className="shrink-0 text-(--color-text-muted)" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-(--color-text-muted)" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--color-text-primary)">
              {group.title}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-(--color-text-muted)">
              {group.completedCount}/{group.itemCount}
            </span>
          </button>
          {isOpen ? (
            <ul>
              {subgroups.map((sg) => renderGroup(sg, depth + 1))}
              {groupItems.map((it) => renderItem(it, depth + 1))}
            </ul>
          ) : null}
        </li>
      );
    },
    [expanded, childGroups, itemsByGroup, toggleGroup, renderItem],
  );

  return (
    <div className="flex h-full w-full flex-col bg-(--color-surface)/95 backdrop-blur">
      <div className="border-b border-(--color-border-subtle) px-4 py-3">
        <p className="truncate text-sm font-semibold text-(--color-text-primary)">
          {libraryName || "Library"}
        </p>
        <p className="text-xs text-(--color-text-muted)">
          {items.length} {items.length === 1 ? "video" : "videos"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading ? (
          <p className="px-4 py-3 text-xs text-(--color-text-muted)">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-3 text-xs text-(--color-text-muted)">
            No videos in this library.
          </p>
        ) : (
          <ul>
            {rootGroups.map((g) => renderGroup(g, 0))}
            {topItems.map((it) => renderItem(it, 0))}
          </ul>
        )}
      </div>
    </div>
  );
}

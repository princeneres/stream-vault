import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  File as FileIcon,
  FileAudio,
  FileText,
  FileType,
  ImageIcon,
  ImagePlus,
  Layers,
  Locate,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import IconButton from "@/components/IconButton";
import Input from "@/components/Input";
import ItemCard from "@/components/ItemCard";
import ViewControls from "@/components/ViewControls";
import { cn } from "@/components/cn";
import NotesPanel from "@/components/NotesPanel";
import {
  convertFileSrc,
  countNotesForItems,
  getGroup,
  getNextItem,
  playItem,
  regenerateLibraryArtwork,
  setGroupCompleted,
  setGroupPoster,
  setItemCompleted,
} from "@/lib/api";
import type {
  Attachment,
  AttachmentKind,
  Group,
  GroupDetail,
  ItemWithProgress,
} from "@/lib/types";
import {
  applyItemPrefs,
  DEFAULT_PREFS,
  type ViewPrefs,
} from "@/lib/viewPrefs";

export interface DetailViewProps {
  groupId: number;
  /** Bumped by the App when item-progress fires; refetches detail. */
  progressTick: number;
  /** Bumped by the App when note-saved fires; refetches notes. */
  notesTick: number;
}

type TreeCache = Map<number, GroupDetail>;

function thumbSrc(path: string | null | undefined): string | undefined {
  return path ? convertFileSrc(path) : undefined;
}

function progressPercent(item: ItemWithProgress): number | undefined {
  if (!item.progress || !item.durationSeconds || item.durationSeconds <= 0) {
    return undefined;
  }
  return Math.round((item.progress.positionSeconds / item.durationSeconds) * 100);
}

function episodeLabel(item: ItemWithProgress): string | undefined {
  if (item.seasonNumber != null && item.episodeNumber != null) {
    const s = String(item.seasonNumber).padStart(2, "0");
    const e = String(item.episodeNumber).padStart(2, "0");
    return `S${s}E${e}`;
  }
  return undefined;
}

function attachmentIcon(kind: AttachmentKind, size = 18) {
  const props = { size, "aria-hidden": true } as const;
  switch (kind) {
    case "image":
      return <ImageIcon {...props} />;
    case "pdf":
      return <FileType {...props} />;
    case "archive":
      return <Archive {...props} />;
    case "audio":
      return <FileAudio {...props} />;
    case "document":
    case "text":
      return <FileText {...props} />;
    default:
      return <FileIcon {...props} />;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function handleAttachmentClick(att: Attachment) {
  try {
    if (att.kind === "archive") {
      await revealItemInDir(att.path);
    } else {
      await openPath(att.path);
    }
  } catch (e) {
    console.error("attachment open failed", e);
  }
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="-mx-1 flex flex-wrap gap-3 px-1">
      {attachments.map((att) => {
        const reveal = att.kind === "archive";
        const action = reveal
          ? "Show in file manager"
          : "Open with system default";
        const label = `${att.name} · ${action}`;
        const previewSrc = att.previewPath
          ? convertFileSrc(att.previewPath)
          : null;
        return (
          <button
            key={att.path}
            type="button"
            onClick={() => handleAttachmentClick(att)}
            title={label}
            aria-label={label}
            className="group/att flex w-44 flex-col overflow-hidden rounded-(--radius-card) border border-(--color-border-subtle) bg-(--color-surface) text-left transition-colors hover:border-(--color-accent) hover:bg-(--color-surface-raised) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
          >
            <div className="flex h-28 w-full items-center justify-center bg-(--color-surface-raised) text-(--color-text-secondary)">
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={
                    att.kind === "pdf"
                      ? "h-full w-full object-contain"
                      : "h-full w-full object-cover"
                  }
                />
              ) : (
                attachmentIcon(att.kind, 28)
              )}
            </div>
            <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
              <span className="shrink-0 text-(--color-text-muted)">
                {attachmentIcon(att.kind, 14)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-(--color-text-primary)">
                  {att.name}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-(--color-text-muted)">
                  {att.extension ?? att.kind} · {formatBytes(att.sizeBytes)}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ItemGrid({
  items,
  onToggle,
  prefs,
  noteCounts,
}: {
  items: ItemWithProgress[];
  onToggle: (item: ItemWithProgress, next: boolean) => void;
  prefs: ViewPrefs;
  noteCounts: Record<number, number>;
}) {
  const sorted = useMemo(() => applyItemPrefs(items, prefs), [items, prefs]);
  return (
    <div className="-mx-1 flex flex-wrap gap-4 px-1">
      {sorted.map((item: ItemWithProgress) => {
        const ep = episodeLabel(item);
        const completed = item.progress?.completed === true;
        return (
          <ItemCard
            key={item.id}
            title={item.title}
            subtitle={ep}
            thumbnail={thumbSrc(item.thumbnailPath)}
            progressPercent={progressPercent(item)}
            completed={completed}
            noteCount={noteCounts[item.id]}
            onToggleCompleted={(next) => onToggle(item, next)}
            onClick={() => playItem(item.id)}
          />
        );
      })}
    </div>
  );
}

const SubgroupSection = memo(function SubgroupSection({
  group,
  depth = 0,
  expanded,
  onSetExpanded,
  cache,
  onLoaded,
  refreshTick,
  onItemToggle,
  onGroupToggle,
  prefs,
  noteCounts,
}: {
  group: Group;
  depth?: number;
  expanded: Set<number>;
  onSetExpanded: (updater: (prev: Set<number>) => Set<number>) => void;
  cache: TreeCache;
  onLoaded: (detail: GroupDetail) => void;
  refreshTick: number;
  onItemToggle: (item: ItemWithProgress, next: boolean) => void;
  onGroupToggle: (group: Group, next: boolean) => void;
  prefs: ViewPrefs;
  noteCounts: Record<number, number>;
}) {
  const open = expanded.has(group.id);
  const detail = cache.get(group.id) ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await getGroup(group.id);
        if (!cancelled) onLoaded(result);
      } catch (e) {
        console.error(`getGroup(${group.id}) failed`, e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, group.id, refreshTick, onLoaded]);

  const toggleOpen = useCallback(() => {
    onSetExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(group.id)) next.delete(group.id);
      else next.add(group.id);
      return next;
    });
  }, [group.id, onSetExpanded]);

  const isEmpty =
    detail !== null &&
    detail.items.length === 0 &&
    detail.subgroups.length === 0 &&
    detail.attachments.length === 0;
  const allWatched =
    group.itemCount > 0 && group.completedCount >= group.itemCount;
  const indent = depth * 24;

  return (
    <section className="space-y-3" style={{ paddingLeft: indent }}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={allWatched}
          disabled={group.itemCount === 0}
          onChange={(e) => onGroupToggle(group, e.currentTarget.checked)}
          aria-label={allWatched ? "Mark group unwatched" : "Mark group watched"}
          className="h-4 w-4 accent-(--color-accent)"
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          onClick={toggleOpen}
          className="flex flex-1 items-center gap-2 text-left text-base font-semibold text-(--color-text-primary) hover:text-(--color-accent)"
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>{group.title}</span>
          {group.itemCount > 0 ? (
            <span className="tabular-nums text-xs font-normal text-(--color-text-secondary)">
              {group.completedCount} / {group.itemCount}
            </span>
          ) : null}
        </button>
      </div>
      {open ? (
        detail ? (
          <div className="space-y-6">
            {detail.items.length > 0 ? (
              <ItemGrid
                items={detail.items}
                onToggle={onItemToggle}
                prefs={prefs}
                noteCounts={noteCounts}
              />
            ) : null}
            {detail.attachments.length > 0 ? (
              <AttachmentList attachments={detail.attachments} />
            ) : null}
            {detail.subgroups.map((sg) => (
              <SubgroupSection
                key={sg.id}
                group={sg}
                depth={depth + 1}
                expanded={expanded}
                onSetExpanded={onSetExpanded}
                cache={cache}
                onLoaded={onLoaded}
                refreshTick={refreshTick}
                onItemToggle={onItemToggle}
                onGroupToggle={onGroupToggle}
                prefs={prefs}
                noteCounts={noteCounts}
              />
            ))}
            {isEmpty ? (
              <p className="text-sm text-(--color-text-secondary)">No items.</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-(--color-text-muted)">Loading…</p>
        )
      ) : null}
    </section>
  );
});

interface FlatMatch {
  kind: "group" | "item";
  group?: Group;
  item?: ItemWithProgress;
  /** Title path joined with " / " for context display. */
  pathLabel: string;
  /** Ancestor group IDs from immediate parent to root, used by reveal. */
  ancestorIds: number[];
}

function collectMatches(
  rootId: number,
  cache: TreeCache,
  query: string,
): FlatMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: FlatMatch[] = [];
  const visit = (id: number, titlePath: string[], ancestorIds: number[]) => {
    const detail = cache.get(id);
    if (!detail) return;
    for (const item of detail.items) {
      if (item.title.toLowerCase().includes(q)) {
        out.push({
          kind: "item",
          item,
          pathLabel: titlePath.join(" / "),
          ancestorIds,
        });
      }
    }
    for (const sg of detail.subgroups) {
      const childPath = [...titlePath, sg.title];
      const childAncestors = [sg.id, ...ancestorIds];
      if (sg.title.toLowerCase().includes(q)) {
        out.push({
          kind: "group",
          group: sg,
          pathLabel: titlePath.join(" / ") || detail.group.title,
          ancestorIds,
        });
      }
      visit(sg.id, childPath, childAncestors);
    }
  };
  const root = cache.get(rootId);
  if (!root) return out;
  visit(rootId, [], []);
  return out;
}

function collectAllGroupIds(rootId: number, cache: TreeCache): number[] {
  const out: number[] = [];
  const visit = (id: number) => {
    const detail = cache.get(id);
    if (!detail) return;
    for (const sg of detail.subgroups) {
      out.push(sg.id);
      visit(sg.id);
    }
  };
  visit(rootId);
  return out;
}

export default function DetailView({
  groupId,
  progressTick,
  notesTick,
}: DetailViewProps) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ViewPrefs>(DEFAULT_PREFS);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [cache, setCache] = useState<TreeCache>(new Map());
  const [query, setQuery] = useState("");
  const [noteCounts, setNoteCounts] = useState<Record<number, number>>({});
  const cacheRef = useRef<TreeCache>(cache);
  const seededRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    setPrefs(DEFAULT_PREFS);
    setExpanded(new Set());
    setCache(new Map());
    setQuery("");
    setNoteCounts({});
    seededRef.current = false;
  }, [groupId]);

  // Refetch note counts for every cached item whenever the cache or notesTick
  // changes. Cheap query (single GROUP BY) so it's fine to recompute.
  useEffect(() => {
    const ids = new Set<number>();
    for (const detail of cache.values()) {
      for (const item of detail.items) ids.add(item.id);
    }
    if (ids.size === 0) {
      setNoteCounts({});
      return;
    }
    let cancelled = false;
    countNotesForItems(Array.from(ids))
      .then((c) => {
        if (!cancelled) setNoteCounts(c);
      })
      .catch((e) => console.error("countNotesForItems failed", e));
    return () => {
      cancelled = true;
    };
  }, [cache, notesTick]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const result = await getGroup(groupId);
        if (!cancelled) setDetail(result);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, progressTick, refreshTick]);

  // Seed root in cache + auto-expand top-level subgroups once.
  useEffect(() => {
    if (!detail) return;
    setCache((prev) => {
      const next = new Map(prev);
      next.set(detail.group.id, detail);
      return next;
    });
    if (!seededRef.current) {
      seededRef.current = true;
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<number>();
        for (const sg of detail.subgroups) next.add(sg.id);
        return next;
      });
    }
  }, [detail]);

  const bumpRefresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const cacheLoaded = useCallback((d: GroupDetail) => {
    setCache((prev) => {
      const next = new Map(prev);
      next.set(d.group.id, d);
      return next;
    });
  }, []);

  const loadGroupCached = useCallback(async (id: number): Promise<GroupDetail> => {
    const hit = cacheRef.current.get(id);
    if (hit) return hit;
    const fresh = await getGroup(id);
    cacheRef.current = new Map(cacheRef.current).set(id, fresh);
    setCache(cacheRef.current);
    return fresh;
  }, []);

  const loadFullSubtree = useCallback(async () => {
    const queue: number[] = [groupId];
    const visited = new Set<number>();
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const d = await loadGroupCached(id);
      for (const sg of d.subgroups) queue.push(sg.id);
    }
  }, [groupId, loadGroupCached]);

  const handlePlayNext = useCallback(async () => {
    try {
      const next = await getNextItem(groupId);
      if (next) await playItem(next.id);
    } catch (e) {
      console.error("getNextItem failed", e);
    }
  }, [groupId]);

  const handleItemToggle = useCallback(
    async (item: ItemWithProgress, next: boolean) => {
      try {
        await setItemCompleted(item.id, next);
        bumpRefresh();
      } catch (e) {
        console.error("setItemCompleted failed", e);
      }
    },
    [bumpRefresh],
  );

  const handleGroupToggle = useCallback(
    async (group: Group, next: boolean) => {
      try {
        await setGroupCompleted(group.id, next);
        bumpRefresh();
      } catch (e) {
        console.error("setGroupCompleted failed", e);
      }
    },
    [bumpRefresh],
  );

  const handlePickPoster = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        filters: [{ name: "Image", extensions: ["jpg", "jpeg", "png", "webp"] }],
      });
      if (typeof selected !== "string") return;
      setBusyAction("poster");
      await setGroupPoster(groupId, selected);
      bumpRefresh();
    } catch (e) {
      console.error("setGroupPoster failed", e);
    } finally {
      setBusyAction(null);
    }
  }, [groupId, bumpRefresh]);

  const handleRegenerateArtwork = useCallback(async (libraryId: number) => {
    try {
      setBusyAction("artwork");
      await regenerateLibraryArtwork(libraryId);
    } catch (e) {
      console.error("regenerateLibraryArtwork failed", e);
    } finally {
      setBusyAction(null);
    }
  }, []);

  const handleExpandAll = useCallback(async () => {
    try {
      setBusyAction("expand-all");
      await loadFullSubtree();
      const all = collectAllGroupIds(groupId, cacheRef.current);
      setExpanded(new Set(all));
    } catch (e) {
      console.error("expand all failed", e);
    } finally {
      setBusyAction(null);
    }
  }, [groupId, loadFullSubtree]);

  const handleCollapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const handleRevealNext = useCallback(async () => {
    try {
      setBusyAction("reveal-next");
      const next = await getNextItem(groupId);
      if (!next || next.groupId == null) return;
      const path: number[] = [];
      let cursor: number | null = next.groupId;
      while (cursor != null && cursor !== groupId) {
        const d = await loadGroupCached(cursor);
        path.push(cursor);
        cursor = d.group.parentGroupId;
      }
      setExpanded((prev) => {
        const out = new Set(prev);
        for (const id of path) out.add(id);
        return out;
      });
    } catch (e) {
      console.error("reveal next failed", e);
    } finally {
      setBusyAction(null);
    }
  }, [groupId, loadGroupCached]);

  const handleRevealGroup = useCallback(
    async (targetId: number, ancestorIds: number[]) => {
      try {
        for (const id of ancestorIds) {
          await loadGroupCached(id);
        }
        setExpanded((prev) => {
          const out = new Set(prev);
          for (const id of ancestorIds) out.add(id);
          out.add(targetId);
          return out;
        });
        setQuery("");
      } catch (e) {
        console.error("reveal group failed", e);
      }
    },
    [loadGroupCached],
  );

  const handlePlayItem = useCallback(async (itemId: number) => {
    try {
      await playItem(itemId);
      setQuery("");
    } catch (e) {
      console.error("playItem failed", e);
    }
  }, []);

  const trimmedQuery = query.trim();
  const searchActive = trimmedQuery.length > 0;
  const allLoaded = useMemo(() => {
    if (!detail) return false;
    const groups = collectAllGroupIds(groupId, cache);
    return groups.every((id) => cache.has(id));
  }, [groupId, cache, detail]);

  // Auto-load subtree once when search becomes active.
  useEffect(() => {
    if (!searchActive) return;
    if (allLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        await loadFullSubtree();
        if (cancelled) return;
      } catch (e) {
        console.error("subtree load failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchActive, allLoaded, loadFullSubtree]);

  const matches = useMemo(
    () => (searchActive ? collectMatches(groupId, cache, trimmedQuery) : []),
    [searchActive, groupId, cache, trimmedQuery],
  );

  if (error) {
    return (
      <div className="px-8 py-10">
        <EmptyState
          icon={<Layers size={20} />}
          title="Failed to load group"
          description={error}
        />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6 px-8 py-6">
        <div className="h-48 animate-pulse rounded-(--radius-card-lg) bg-(--color-surface-raised)" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-(--color-surface-raised)" />
      </div>
    );
  }

  const { group, subgroups, items, attachments } = detail;
  const poster = thumbSrc(group.posterPath);
  const combinedTick = progressTick + refreshTick;
  const hasContents =
    items.length > 0 || subgroups.length > 0 || attachments.length > 0;
  const expandAllBusy = busyAction === "expand-all";
  const revealBusy = busyAction === "reveal-next";

  return (
    <div className="space-y-8">
      <header className="relative isolate overflow-hidden">
        {poster ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
          >
            <img
              src={poster}
              alt=""
              className="h-full w-full scale-110 object-cover blur-3xl saturate-150 opacity-50 motion-safe:transition-opacity motion-safe:duration-500"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-(--color-bg)/40 via-(--color-bg)/70 to-(--color-bg)" />
          </div>
        ) : null}
        <div className="flex flex-col gap-4 px-8 py-10 md:flex-row md:items-end">
          <div className="group/poster relative h-48 w-80 shrink-0 overflow-hidden rounded-(--radius-card-lg) bg-(--color-surface-raised) shadow-(--shadow-card)">
            {poster ? (
              <img
                src={poster}
                alt=""
                width={320}
                height={192}
                className="h-full w-full object-cover"
                decoding="async"
                fetchPriority="high"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-(--color-text-muted)">
                <Layers size={36} aria-hidden />
              </div>
            )}
            <button
              type="button"
              onClick={handlePickPoster}
              disabled={busyAction === "poster"}
              className="absolute inset-0 flex items-end justify-end bg-(--color-bg)/0 p-3 text-(--color-text-primary) opacity-0 transition-opacity group-hover/poster:bg-(--color-bg)/40 group-hover/poster:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
              aria-label="Change poster image"
            >
              <span className="inline-flex items-center gap-1.5 rounded-(--radius-pill) bg-(--color-bg)/80 px-3 py-1.5 text-xs font-medium">
                <ImagePlus size={14} aria-hidden />
                {busyAction === "poster" ? "Saving…" : "Change image"}
              </span>
            </button>
          </div>
          <div className="flex-1 space-y-3">
            <h1 className="text-pretty text-3xl font-semibold text-(--color-text-primary) drop-shadow-md">
              {group.title}
            </h1>
            {group.itemCount > 0 ? (
              <p className="tabular-nums text-sm text-(--color-text-secondary)">
                {group.completedCount} of {group.itemCount} watched
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                leadingIcon={<Play size={14} />}
                onClick={handlePlayNext}
              >
                Play next
              </Button>
              <IconButton
                icon={<RefreshCw size={14} />}
                tooltip="Regenerate thumbnails"
                size="sm"
                onClick={() => handleRegenerateArtwork(group.libraryId)}
                disabled={busyAction === "artwork"}
              />
            </div>
          </div>
        </div>
      </header>
      <div className="space-y-6 px-8">
        {hasContents ? (
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-(--color-text-primary)">
                Contents
              </h2>
              <ViewControls prefs={prefs} onChange={setPrefs} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder="Search this course…"
                aria-label="Search items and folders in this group"
                spellCheck={false}
                autoComplete="off"
                className="w-64"
                leadingIcon={<Search size={14} aria-hidden />}
                trailingIcon={
                  query ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        searchInputRef.current?.focus();
                      }}
                      aria-label="Clear search"
                      className="text-(--color-text-muted) hover:text-(--color-text-primary)"
                    >
                      <X size={14} />
                    </button>
                  ) : undefined
                }
              />
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Locate size={14} />}
                onClick={handleRevealNext}
                disabled={revealBusy}
              >
                {revealBusy ? "Locating…" : "Reveal next"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<ChevronsUpDown size={14} />}
                onClick={handleExpandAll}
                disabled={expandAllBusy}
              >
                {expandAllBusy ? "Loading…" : "Expand all"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={<ChevronsDownUp size={14} />}
                onClick={handleCollapseAll}
                disabled={expanded.size === 0}
              >
                Collapse all
              </Button>
            </div>
          </div>
        ) : null}

        {searchActive ? (
          <SearchResultsPanel
            matches={matches}
            loading={!allLoaded}
            onPlayItem={handlePlayItem}
            onRevealGroup={handleRevealGroup}
            query={trimmedQuery}
          />
        ) : (
          <>
            {items.length > 0 ? (
              <ItemGrid
                items={items}
                onToggle={handleItemToggle}
                prefs={prefs}
                noteCounts={noteCounts}
              />
            ) : null}

            {attachments.length > 0 ? (
              <AttachmentList attachments={attachments} />
            ) : null}

            {subgroups.map((sg) => (
              <SubgroupSection
                key={sg.id}
                group={sg}
                expanded={expanded}
                onSetExpanded={setExpanded}
                cache={cache}
                onLoaded={cacheLoaded}
                refreshTick={combinedTick}
                onItemToggle={handleItemToggle}
                onGroupToggle={handleGroupToggle}
                prefs={prefs}
                noteCounts={noteCounts}
              />
            ))}

            {!hasContents ? (
              <EmptyState
                icon={<Layers size={20} />}
                title="Empty group"
                description="No subgroups or items found in this group."
              />
            ) : null}

            <GroupNotesSection
              cache={cache}
              noteCounts={noteCounts}
              notesTick={notesTick}
            />
          </>
        )}
      </div>
    </div>
  );
}

function GroupNotesSection({
  cache,
  noteCounts,
  notesTick,
}: {
  cache: TreeCache;
  noteCounts: Record<number, number>;
  notesTick: number;
}) {
  const itemsWithNotes = useMemo(() => {
    const seen = new Set<number>();
    const out: ItemWithProgress[] = [];
    for (const detail of cache.values()) {
      for (const item of detail.items) {
        if (seen.has(item.id)) continue;
        if ((noteCounts[item.id] ?? 0) > 0) {
          seen.add(item.id);
          out.push(item);
        }
      }
    }
    return out;
  }, [cache, noteCounts]);

  if (itemsWithNotes.length === 0) return null;

  return (
    <section className="space-y-4 pt-2">
      <h2 className="text-base font-semibold text-(--color-text-primary)">
        Notes
      </h2>
      <div className="space-y-5">
        {itemsWithNotes.map((item) => {
          const count = noteCounts[item.id] ?? 0;
          return (
            <div key={item.id} className="space-y-2">
              <h3 className="text-sm font-medium text-(--color-text-primary)">
                {item.title}
                <span className="ml-2 text-xs font-normal text-(--color-text-muted)">
                  ({count} note{count === 1 ? "" : "s"})
                </span>
              </h3>
              <NotesPanel itemId={item.id} refreshTick={notesTick} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SearchResultsPanel({
  matches,
  loading,
  query,
  onPlayItem,
  onRevealGroup,
}: {
  matches: FlatMatch[];
  loading: boolean;
  query: string;
  onPlayItem: (itemId: number) => void;
  onRevealGroup: (groupId: number, ancestorIds: number[]) => void;
}) {
  const groups = matches.filter((m) => m.kind === "group");
  const items = matches.filter((m) => m.kind === "item");

  if (loading && matches.length === 0) {
    return (
      <p className="px-1 py-6 text-sm text-(--color-text-muted)">Searching…</p>
    );
  }
  if (matches.length === 0) {
    return (
      <p className="px-1 py-6 text-sm text-(--color-text-muted)">
        No matches for “{query}”.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {groups.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
            Folders ({groups.length})
          </h3>
          <ul className="space-y-1">
            {groups.map((m) => (
              <li key={`g:${m.group!.id}`}>
                <button
                  type="button"
                  onClick={() => onRevealGroup(m.group!.id, m.ancestorIds)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-(--radius-control) px-3 py-2 text-left",
                    "text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)",
                  )}
                >
                  <Layers
                    size={14}
                    aria-hidden
                    className="shrink-0 text-(--color-text-muted)"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {m.group!.title}
                    </span>
                    {m.pathLabel ? (
                      <span className="block truncate text-xs text-(--color-text-muted)">
                        in {m.pathLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-(--color-text-muted)">
                    {m.group!.completedCount} / {m.group!.itemCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {items.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
            Videos ({items.length})
          </h3>
          <ul className="space-y-1">
            {items.map((m) => {
              const it = m.item!;
              const ep = episodeLabel(it);
              const completed = it.progress?.completed === true;
              return (
                <li key={`i:${it.id}`}>
                  <button
                    type="button"
                    onClick={() => onPlayItem(it.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-(--radius-control) px-3 py-2 text-left",
                      "text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)",
                    )}
                  >
                    {it.thumbnailPath ? (
                      <img
                        src={convertFileSrc(it.thumbnailPath)}
                        alt=""
                        width={64}
                        height={36}
                        loading="lazy"
                        decoding="async"
                        className="h-9 w-16 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="flex h-9 w-16 shrink-0 items-center justify-center rounded bg-(--color-surface-raised) text-(--color-text-muted)">
                        <Play size={14} aria-hidden />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {it.title}
                      </span>
                      <span className="block truncate text-xs text-(--color-text-muted)">
                        {ep ? `${ep} · ` : ""}
                        {m.pathLabel || "—"}
                      </span>
                    </span>
                    {completed ? (
                      <span className="shrink-0 rounded-(--radius-pill) bg-(--color-accent-soft) px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-(--color-accent)">
                        Watched
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

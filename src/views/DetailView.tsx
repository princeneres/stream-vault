import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Layers,
  Play,
  RefreshCw,
} from "lucide-react";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import IconButton from "@/components/IconButton";
import ItemCard from "@/components/ItemCard";
import {
  convertFileSrc,
  getGroup,
  getNextItem,
  playItem,
  regenerateLibraryArtwork,
  setGroupCompleted,
  setGroupPoster,
  setItemCompleted,
} from "@/lib/api";
import type { Group, GroupDetail, ItemWithProgress } from "@/lib/types";

export interface DetailViewProps {
  groupId: number;
  /** Bumped by the App when item-progress fires; refetches detail. */
  progressTick: number;
}

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

function ItemGrid({
  items,
  onToggle,
}: {
  items: ItemWithProgress[];
  onToggle: (item: ItemWithProgress, next: boolean) => void;
}) {
  return (
    <div className="-mx-1 flex flex-wrap gap-4 px-1">
      {items.map((item) => {
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
            onToggleCompleted={(next) => onToggle(item, next)}
            onClick={() => playItem(item.id)}
          />
        );
      })}
    </div>
  );
}

function SubgroupSection({
  group,
  depth = 0,
  refreshTick,
  onItemToggle,
  onGroupToggle,
}: {
  group: Group;
  depth?: number;
  refreshTick: number;
  onItemToggle: (item: ItemWithProgress, next: boolean) => void;
  onGroupToggle: (group: Group, next: boolean) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [detail, setDetail] = useState<GroupDetail | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await getGroup(group.id);
        if (!cancelled) setDetail(result);
      } catch (e) {
        console.error(`getGroup(${group.id}) failed`, e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, group.id, refreshTick]);

  const isEmpty =
    detail !== null &&
    detail.items.length === 0 &&
    detail.subgroups.length === 0;
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
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left text-base font-semibold text-(--color-text-primary) hover:text-(--color-accent)"
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>{group.title}</span>
          {group.itemCount > 0 ? (
            <span className="text-xs font-normal text-(--color-text-secondary)">
              {group.completedCount} / {group.itemCount}
            </span>
          ) : null}
        </button>
      </div>
      {open ? (
        detail ? (
          <div className="space-y-6">
            {detail.items.length > 0 ? (
              <ItemGrid items={detail.items} onToggle={onItemToggle} />
            ) : null}
            {detail.subgroups.map((sg) => (
              <SubgroupSection
                key={sg.id}
                group={sg}
                depth={depth + 1}
                refreshTick={refreshTick}
                onItemToggle={onItemToggle}
                onGroupToggle={onGroupToggle}
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
}

export default function DetailView({ groupId, progressTick }: DetailViewProps) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);

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

  const bumpRefresh = () => setRefreshTick((t) => t + 1);

  const handlePlayNext = async () => {
    try {
      const next = await getNextItem(groupId);
      if (next) await playItem(next.id);
    } catch (e) {
      console.error("getNextItem failed", e);
    }
  };

  const handleItemToggle = async (
    item: ItemWithProgress,
    next: boolean,
  ) => {
    try {
      await setItemCompleted(item.id, next);
      bumpRefresh();
    } catch (e) {
      console.error("setItemCompleted failed", e);
    }
  };

  const handleGroupToggle = async (group: Group, next: boolean) => {
    try {
      await setGroupCompleted(group.id, next);
      bumpRefresh();
    } catch (e) {
      console.error("setGroupCompleted failed", e);
    }
  };

  const handlePickPoster = async () => {
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
  };

  const handleRegenerateArtwork = async (libraryId: number) => {
    try {
      setBusyAction("artwork");
      await regenerateLibraryArtwork(libraryId);
    } catch (e) {
      console.error("regenerateLibraryArtwork failed", e);
    } finally {
      setBusyAction(null);
    }
  };

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

  const { group, subgroups, items } = detail;
  const poster = thumbSrc(group.posterPath);
  const combinedTick = progressTick + refreshTick;

  return (
    <div className="space-y-8 px-8 py-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="group/poster relative h-48 w-80 shrink-0 overflow-hidden rounded-(--radius-card-lg) bg-(--color-surface-raised) shadow-(--shadow-card)">
          {poster ? (
            <img
              src={poster}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
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
          <h1 className="text-3xl font-semibold text-(--color-text-primary)">
            {group.title}
          </h1>
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
      </header>

      {items.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-(--color-text-primary)">
            Items
          </h2>
          <ItemGrid items={items} onToggle={handleItemToggle} />
        </section>
      ) : null}

      {subgroups.map((sg) => (
        <SubgroupSection
          key={sg.id}
          group={sg}
          refreshTick={combinedTick}
          onItemToggle={handleItemToggle}
          onGroupToggle={handleGroupToggle}
        />
      ))}

      {items.length === 0 && subgroups.length === 0 ? (
        <EmptyState
          icon={<Layers size={20} />}
          title="Empty group"
          description="No subgroups or items found in this group."
        />
      ) : null}
    </div>
  );
}

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Layers, Play } from "lucide-react";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import ItemCard from "@/components/ItemCard";
import { convertFileSrc, getGroup, getNextItem, playItem } from "@/lib/api";
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

function ItemGrid({ items }: { items: ItemWithProgress[] }) {
  return (
    <div className="-mx-1 flex flex-wrap gap-4 px-1">
      {items.map((item) => {
        const ep = episodeLabel(item);
        return (
          <ItemCard
            key={item.id}
            title={item.title}
            subtitle={ep}
            thumbnail={thumbSrc(item.thumbnailPath)}
            progressPercent={progressPercent(item)}
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
}: {
  group: Group;
  depth?: number;
  refreshTick: number;
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

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-base font-semibold text-(--color-text-primary) hover:text-(--color-accent)"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{group.title}</span>
        {detail && detail.items.length > 0 ? (
          <span className="text-xs font-normal text-(--color-text-secondary)">
            {detail.items.length} items
          </span>
        ) : null}
      </button>
      {open ? (
        detail ? (
          <div
            className={
              depth > 0
                ? "space-y-6 border-l border-(--color-border) pl-4"
                : "space-y-6"
            }
          >
            {detail.items.length > 0 ? <ItemGrid items={detail.items} /> : null}
            {detail.subgroups.map((sg) => (
              <SubgroupSection
                key={sg.id}
                group={sg}
                depth={depth + 1}
                refreshTick={refreshTick}
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
  }, [groupId, progressTick]);

  const handlePlayNext = async () => {
    try {
      const next = await getNextItem(groupId);
      if (next) await playItem(next.id);
    } catch (e) {
      console.error("getNextItem failed", e);
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

  return (
    <div className="space-y-8 px-8 py-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="relative h-48 w-80 shrink-0 overflow-hidden rounded-(--radius-card-lg) bg-(--color-surface-raised) shadow-(--shadow-card)">
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
        </div>
        <div className="flex-1 space-y-3">
          <h1 className="text-3xl font-semibold text-(--color-text-primary)">
            {group.title}
          </h1>
          <div className="flex gap-2">
            <Button
              variant="primary"
              leadingIcon={<Play size={14} />}
              onClick={handlePlayNext}
            >
              Play next
            </Button>
          </div>
        </div>
      </header>

      {items.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-(--color-text-primary)">
            Items
          </h2>
          <ItemGrid items={items} />
        </section>
      ) : null}

      {subgroups.map((sg) => (
        <SubgroupSection key={sg.id} group={sg} refreshTick={progressTick} />
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

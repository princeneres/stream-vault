import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Library as LibraryIcon,
  PlayCircle,
} from "lucide-react";
import EmptyState from "@/components/EmptyState";
import GroupCard from "@/components/GroupCard";
import ItemCard from "@/components/ItemCard";
import LibrarySection from "@/components/LibrarySection";
import MovieCard from "@/components/MovieCard";
import { getContinueWatching, getLibraryContents } from "@/lib/api";
import { usePlayer } from "@/lib/player";
import {
  episodeLabel,
  movieStatus,
  progressPercent,
  thumbSrc,
} from "@/lib/itemDisplay";
import type {
  ItemWithProgress,
  Library,
  LibraryContents,
} from "@/lib/types";

export interface HomeProps {
  libraries: Library[];
  onOpenLibrary: (id: number) => void;
  onOpenGroup: (id: number) => void;
  /** Bumped by the App when item-progress fires; refetches Continue Watching. */
  progressTick: number;
}

function remainingLabel(item: ItemWithProgress): string | null {
  if (!item.progress || !item.durationSeconds) return null;
  const remaining = item.durationSeconds - item.progress.positionSeconds;
  if (remaining <= 30) return "Almost done";
  if (remaining < 60) return `${Math.round(remaining)} sec left`;
  const min = Math.round(remaining / 60);
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h left` : `${h} h ${m} m left`;
}

function continueSubtitle(item: ItemWithProgress): string | undefined {
  const parts = [episodeLabel(item), remainingLabel(item)].filter(
    (x): x is string => x != null,
  );
  return parts.length ? parts.join(" · ") : undefined;
}

export default function Home({
  libraries,
  onOpenLibrary,
  onOpenGroup,
  progressTick,
}: HomeProps) {
  const [continueWatching, setContinueWatching] = useState<ItemWithProgress[]>(
    [],
  );
  const [perLibrary, setPerLibrary] = useState<Record<number, LibraryContents>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await getContinueWatching(20);
        if (!cancelled) setContinueWatching(items);
      } catch (e) {
        console.error("getContinueWatching failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [progressTick]);

  // Refetch on progressTick too so library card counts (e.g. "3 / 10 watched")
  // update live as items complete, matching Continue Watching above.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        libraries.map(async (lib) => {
          try {
            const contents = await getLibraryContents(lib.id);
            return [lib.id, contents] as const;
          } catch (e) {
            console.error(`getLibraryContents(${lib.id}) failed`, e);
            return null;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<number, LibraryContents> = {};
      for (const e of entries) if (e) next[e[0]] = e[1];
      setPerLibrary(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [libraries, progressTick]);

  const { play } = usePlayer();
  const handlePlay = useCallback((id: number) => play(id), [play]);

  const stats = useMemo(() => {
    let total = 0;
    let completed = 0;
    for (const lib of Object.values(perLibrary)) {
      for (const g of lib.groups) {
        total += g.itemCount;
        completed += g.completedCount;
      }
      for (const item of lib.topItems) {
        total += 1;
        if (item.progress?.completed) completed += 1;
      }
    }
    return {
      libraries: libraries.length,
      total,
      completed,
      inProgress: continueWatching.length,
    };
  }, [perLibrary, libraries.length, continueWatching.length]);

  if (libraries.length === 0) {
    return (
      <div className="px-8 py-10">
        <EmptyState
          icon={<LibraryIcon size={20} />}
          title="No libraries yet"
          description="Add a folder in Settings to start watching."
        />
      </div>
    );
  }

  return (
    <div className="space-y-10 px-8 py-6">
      <section className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<LibraryIcon size={16} aria-hidden />}
          label="Libraries"
          value={stats.libraries}
        />
        <StatCard
          icon={<PlayCircle size={16} aria-hidden />}
          label="In progress"
          value={stats.inProgress}
        />
        <StatCard
          icon={<CheckCircle2 size={16} aria-hidden />}
          label="Watched"
          value={stats.completed}
        />
        <StatCard label="Total items" value={stats.total} />
      </section>
      {continueWatching.length > 0 ? (
        <LibrarySection title="Continue Watching">
          {continueWatching.map((item) => (
            <ItemCard
              key={item.id}
              id={item.id}
              title={item.title}
              subtitle={continueSubtitle(item)}
              thumbnail={thumbSrc(item.thumbnailPath)}
              progressPercent={progressPercent(item)}
              onActivate={handlePlay}
            />
          ))}
        </LibrarySection>
      ) : null}

      {libraries.map((lib) => {
        const contents = perLibrary[lib.id];
        if (!contents) {
          return (
            <LibrarySection key={lib.id} title={lib.name}>
              <GroupCard.Skeleton />
              <GroupCard.Skeleton />
              <GroupCard.Skeleton />
            </LibrarySection>
          );
        }
        if (lib.kind === "movies") {
          if (contents.topItems.length === 0) {
            return null;
          }
          return (
            <LibrarySection
              key={lib.id}
              title={lib.name}
              onSeeAll={() => onOpenLibrary(lib.id)}
            >
              {contents.topItems.slice(0, 12).map((item) => (
                <div key={item.id} className="w-40 shrink-0 snap-start">
                  <MovieCard
                    id={item.id}
                    title={item.title}
                    poster={thumbSrc(item.thumbnailPath)}
                    status={movieStatus(item)}
                    progressPercent={progressPercent(item)}
                    onActivate={handlePlay}
                  />
                </div>
              ))}
            </LibrarySection>
          );
        }
        if (contents.groups.length === 0) {
          return null;
        }
        return (
          <LibrarySection
            key={lib.id}
            title={lib.name}
            onSeeAll={() => onOpenLibrary(lib.id)}
          >
            {contents.groups.slice(0, 12).map((group) => (
              <div key={group.id} className="w-56 shrink-0 snap-start">
                <GroupCard
                  id={group.id}
                  title={group.title}
                  poster={thumbSrc(group.posterPath)}
                  kind={lib.kind}
                  totalCount={group.itemCount}
                  completedCount={group.completedCount}
                  onActivate={onOpenGroup}
                />
              </div>
            ))}
          </LibrarySection>
        );
      })}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-(--radius-card) border border-(--color-border-subtle) bg-(--color-surface) px-4 py-3">
      {icon ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius-pill) bg-(--color-surface-raised) text-(--color-accent)">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-(--color-text-secondary)">{label}</p>
        <p className="tabular-nums text-xl font-semibold text-(--color-text-primary)">
          {value}
        </p>
      </div>
    </div>
  );
}

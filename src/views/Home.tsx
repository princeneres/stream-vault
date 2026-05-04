import { useEffect, useState } from "react";
import { Library as LibraryIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import GroupCard from "@/components/GroupCard";
import ItemCard from "@/components/ItemCard";
import LibrarySection from "@/components/LibrarySection";
import MovieCard, { type MovieStatus } from "@/components/MovieCard";
import {
  convertFileSrc,
  getContinueWatching,
  getLibraryContents,
  playItem,
} from "@/lib/api";
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

function thumbSrc(path: string | null | undefined): string | undefined {
  return path ? convertFileSrc(path) : undefined;
}

function progressPercent(item: ItemWithProgress): number | undefined {
  if (!item.progress || !item.durationSeconds || item.durationSeconds <= 0) {
    return undefined;
  }
  return Math.round((item.progress.positionSeconds / item.durationSeconds) * 100);
}

function movieStatus(item: ItemWithProgress): MovieStatus {
  if (item.progress?.completed) return "watched";
  if (item.progress) return "in-progress";
  return "unwatched";
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
  }, [libraries]);

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
      {continueWatching.length > 0 ? (
        <LibrarySection title="Continue Watching">
          {continueWatching.map((item) => (
            <ItemCard
              key={item.id}
              title={item.title}
              thumbnail={thumbSrc(item.thumbnailPath)}
              progressPercent={progressPercent(item)}
              onClick={() => playItem(item.id)}
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
                    title={item.title}
                    poster={thumbSrc(item.thumbnailPath)}
                    status={movieStatus(item)}
                    progressPercent={progressPercent(item)}
                    onClick={() => playItem(item.id)}
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
                  title={group.title}
                  poster={thumbSrc(group.posterPath)}
                  kind={lib.kind}
                  onClick={() => onOpenGroup(group.id)}
                />
              </div>
            ))}
          </LibrarySection>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import GroupCard from "@/components/GroupCard";
import ItemCard from "@/components/ItemCard";
import MovieCard, { type MovieStatus } from "@/components/MovieCard";
import { convertFileSrc, getLibraryContents, playItem } from "@/lib/api";
import type { ItemWithProgress, LibraryContents } from "@/lib/types";

export interface LibraryViewProps {
  libraryId: number;
  onOpenGroup: (groupId: number) => void;
  /** Bumped by the App when item-progress fires; refetches contents. */
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

export default function LibraryView({
  libraryId,
  onOpenGroup,
  progressTick,
}: LibraryViewProps) {
  const [contents, setContents] = useState<LibraryContents | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const result = await getLibraryContents(libraryId);
        if (!cancelled) setContents(result);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryId, progressTick]);

  if (error) {
    return (
      <div className="px-8 py-10">
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="Failed to load library"
          description={error}
        />
      </div>
    );
  }

  if (!contents) {
    return (
      <div className="grid grid-cols-2 gap-4 px-8 py-6 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <GroupCard.Skeleton key={i} />
        ))}
      </div>
    );
  }

  const { library, groups, topItems } = contents;
  const empty =
    library.kind === "movies"
      ? topItems.length === 0
      : groups.length === 0 && topItems.length === 0;

  return (
    <div className="space-y-6 px-8 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-(--color-text-primary)">
            {library.name}
          </h1>
          <p className="text-sm text-(--color-text-secondary)">
            {library.rootPath}
          </p>
        </div>
      </header>

      {!library.available ? (
        <div className="flex items-start gap-3 rounded-(--radius-card) border border-(--color-border-subtle) bg-(--color-surface)/40 px-4 py-3 text-sm text-(--color-text-secondary)">
          <AlertTriangle size={16} className="mt-0.5 text-(--color-warning)" />
          <span>
            Library root folder is not available. Reconnect the drive or update
            the path in Settings.
          </span>
        </div>
      ) : null}

      {empty ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title="Nothing here yet"
          description="Run a scan from Settings to index this library."
        />
      ) : library.kind === "movies" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {topItems.map((item) => (
            <MovieCard
              key={item.id}
              title={item.title}
              poster={thumbSrc(item.thumbnailPath)}
              status={movieStatus(item)}
              progressPercent={progressPercent(item)}
              onClick={() => playItem(item.id)}
            />
          ))}
        </div>
      ) : (
        <>
          {topItems.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-(--color-text-primary)">
                Loose items
              </h2>
              <div className="-mx-1 flex flex-wrap gap-4 px-1">
                {topItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    title={item.title}
                    thumbnail={thumbSrc(item.thumbnailPath)}
                    progressPercent={progressPercent(item)}
                    onClick={() => playItem(item.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {groups.map((group) => (
              <GroupCard
                key={group.id}
                title={group.title}
                poster={thumbSrc(group.posterPath)}
                kind={library.kind}
                onClick={() => onOpenGroup(group.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

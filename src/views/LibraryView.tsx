import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import GroupCard from "@/components/GroupCard";
import ItemCard from "@/components/ItemCard";
import MovieCard from "@/components/MovieCard";
import ViewControls from "@/components/ViewControls";
import { getLibraryContents } from "@/lib/api";
import { usePlayer } from "@/lib/player";
import { movieStatus, progressPercent, thumbSrc } from "@/lib/itemDisplay";
import type { LibraryContents } from "@/lib/types";
import { applyGroupPrefs, applyItemPrefs, useViewPrefs } from "@/lib/viewPrefs";
import { useTopBarActions } from "@/lib/topbar";

export interface LibraryViewProps {
  libraryId: number;
  onOpenGroup: (groupId: number) => void;
  /** Bumped by the App when item-progress fires; refetches contents. */
  progressTick: number;
}

export default function LibraryView({
  libraryId,
  onOpenGroup,
  progressTick,
}: LibraryViewProps) {
  const [contents, setContents] = useState<LibraryContents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useViewPrefs(`lib:${libraryId}`);

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

  const { play } = usePlayer();
  const handlePlay = useCallback((id: number) => play(id), [play]);

  const sortedGroups = useMemo(
    () => applyGroupPrefs(contents?.groups ?? [], prefs),
    [contents, prefs],
  );
  const sortedTopItems = useMemo(
    () => applyItemPrefs(contents?.topItems ?? [], prefs),
    [contents, prefs],
  );

  const hasContent = Boolean(
    contents &&
      (contents.library.kind === "movies"
        ? contents.topItems.length > 0
        : contents.groups.length > 0 || contents.topItems.length > 0),
  );
  useTopBarActions(
    hasContent ? <ViewControls prefs={prefs} onChange={setPrefs} /> : null,
    [hasContent, prefs],
  );

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
  const filteredEmpty =
    !empty &&
    (library.kind === "movies"
      ? sortedTopItems.length === 0
      : sortedGroups.length === 0 && sortedTopItems.length === 0);

  return (
    <div className="space-y-6 px-8 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-(--color-text-primary)">
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
      ) : filteredEmpty ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title="No matches"
          description="No items match the current filter."
        />
      ) : library.kind === "movies" ? (
        <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {sortedTopItems.map((item, i) => (
            <MovieCard
              key={item.id}
              id={item.id}
              title={item.title}
              poster={thumbSrc(item.thumbnailPath)}
              status={movieStatus(item)}
              progressPercent={progressPercent(item)}
              onActivate={handlePlay}
              style={{ "--i": Math.min(i, 12) } as CSSProperties}
            />
          ))}
        </div>
      ) : (
        <>
          {sortedTopItems.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-(--color-text-primary)">
                Loose items
              </h2>
              <div className="-mx-1 flex flex-wrap gap-4 px-1">
                {sortedTopItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    thumbnail={thumbSrc(item.thumbnailPath)}
                    progressPercent={progressPercent(item)}
                    onActivate={handlePlay}
                  />
                ))}
              </div>
            </section>
          ) : null}
          <div className="stagger grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {sortedGroups.map((group, i) => (
              <GroupCard
                key={group.id}
                id={group.id}
                title={group.title}
                poster={thumbSrc(group.posterPath)}
                kind={library.kind}
                totalCount={group.itemCount}
                completedCount={group.completedCount}
                onActivate={onOpenGroup}
                style={{ "--i": Math.min(i, 12) } as CSSProperties}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

import { convertFileSrc } from "./api";
import type { ItemWithProgress } from "./types";
import type { MovieStatus } from "@/components/MovieCard";

/** Resolve a backend file path to a webview-loadable src, if present. */
export function thumbSrc(path: string | null | undefined): string | undefined {
  return path ? convertFileSrc(path) : undefined;
}

/** Watched percentage (0–100) for an item, or undefined when unknown. */
export function progressPercent(item: ItemWithProgress): number | undefined {
  if (!item.progress || !item.durationSeconds || item.durationSeconds <= 0) {
    return undefined;
  }
  return Math.round(
    (item.progress.positionSeconds / item.durationSeconds) * 100,
  );
}

export function movieStatus(item: ItemWithProgress): MovieStatus {
  if (item.progress?.completed) return "watched";
  if (item.progress) return "in-progress";
  return "unwatched";
}

/** "S02E04"-style label, or undefined when the item isn't an episode. */
export function episodeLabel(item: ItemWithProgress): string | undefined {
  if (item.seasonNumber != null && item.episodeNumber != null) {
    const s = String(item.seasonNumber).padStart(2, "0");
    const e = String(item.episodeNumber).padStart(2, "0");
    return `S${s}E${e}`;
  }
  return undefined;
}

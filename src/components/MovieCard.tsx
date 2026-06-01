import { memo, type CSSProperties } from "react";
import { Check, CircleDashed, Film, PlayCircle } from "lucide-react";
import { cn } from "./cn";
import ProgressBar from "./ProgressBar";

const CV_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "200px 320px",
} as const;

export type MovieStatus = "unwatched" | "in-progress" | "watched";

export interface MovieCardProps {
  id: number;
  title: string;
  poster?: string | null;
  status: MovieStatus;
  progressPercent?: number;
  durationLabel?: string;
  onActivate?: (id: number) => void;
  className?: string;
  style?: CSSProperties;
}

const statusBadge: Record<
  MovieStatus,
  { label: string; icon: typeof Check; tone: string }
> = {
  unwatched: {
    label: "Unwatched",
    icon: CircleDashed,
    tone: "text-(--color-text-muted)",
  },
  "in-progress": {
    label: "In progress",
    icon: PlayCircle,
    tone: "text-(--color-accent)",
  },
  watched: { label: "Watched", icon: Check, tone: "text-(--color-success)" },
};

function MovieCardImpl({
  id,
  title,
  poster,
  status,
  progressPercent,
  durationLabel,
  onActivate,
  className,
  style,
}: MovieCardProps) {
  const badge = statusBadge[status];
  const Icon = badge.icon;
  return (
    <button
      type="button"
      onClick={onActivate ? () => onActivate(id) : undefined}
      style={{ ...CV_STYLE, ...style }}
      className={cn(
        "group relative flex w-full flex-col gap-2 text-left",
        "rounded-(--radius-card) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
        "motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-[0.98]",
        className,
      )}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-(--radius-card) bg-(--color-surface-raised) shadow-(--shadow-card) ring-1 ring-transparent motion-safe:transition-all motion-safe:duration-200 motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:shadow-(--shadow-card-hover) motion-safe:group-hover:ring-(--color-accent-soft) hover:[will-change:transform]">
        {poster ? (
          <img
            src={poster}
            alt=""
            width={200}
            height={300}
            className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.04]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-(--color-text-muted)">
            <Film size={28} aria-hidden />
          </div>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-(--color-bg)/30 opacity-0 motion-safe:transition-opacity group-hover:opacity-100"
        >
          <span className="glow-accent flex h-14 w-14 items-center justify-center rounded-(--radius-pill) bg-(--color-accent) text-(--color-text-inverse) shadow-(--shadow-card-hover)">
            <PlayCircle size={24} fill="currentColor" strokeWidth={1} />
          </span>
        </span>
        <span
          className={cn(
            "absolute right-2 top-2 inline-flex items-center gap-1 rounded-(--radius-pill) bg-(--color-bg)/75 px-2 py-0.5 text-[11px]",
            badge.tone,
          )}
          aria-label={badge.label}
        >
          <Icon size={12} aria-hidden />
          <span>{badge.label}</span>
        </span>
        {status === "in-progress" && typeof progressPercent === "number" ? (
          <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1.5">
            <ProgressBar value={progressPercent / 100} size="sm" />
          </div>
        ) : null}
      </div>
      <div className="px-0.5">
        <p className="line-clamp-2 text-pretty text-sm font-semibold text-(--color-text-primary)">
          {title}
        </p>
        {durationLabel ? (
          <p className="text-xs text-(--color-text-secondary)">{durationLabel}</p>
        ) : null}
      </div>
    </button>
  );
}

function Skeleton() {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="aspect-[2/3] animate-pulse rounded-(--radius-card) bg-(--color-surface-raised)" />
      <div className="space-y-1.5 px-0.5">
        <div className="h-3 w-4/5 animate-pulse rounded bg-(--color-surface-raised)" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-(--color-surface-raised)" />
      </div>
    </div>
  );
}

const MemoMovieCard = memo(MovieCardImpl);
const MovieCard = Object.assign(MemoMovieCard, { Skeleton });
export default MovieCard;

import { Check, CircleDashed, Film, PlayCircle } from "lucide-react";
import { cn } from "./cn";
import ProgressBar from "./ProgressBar";

export type MovieStatus = "unwatched" | "in-progress" | "watched";

export interface MovieCardProps {
  title: string;
  poster?: string | null;
  status: MovieStatus;
  progressPercent?: number;
  durationLabel?: string;
  onClick?: () => void;
  className?: string;
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
  title,
  poster,
  status,
  progressPercent,
  durationLabel,
  onClick,
  className,
}: MovieCardProps) {
  const badge = statusBadge[status];
  const Icon = badge.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full flex-col gap-2 text-left",
        "rounded-(--radius-card) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
        className,
      )}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-(--radius-card) bg-(--color-surface-raised) shadow-(--shadow-card) transition-transform group-hover:-translate-y-0.5 group-hover:shadow-(--shadow-card-hover)">
        {poster ? (
          <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-(--color-text-muted)">
            <Film size={28} aria-hidden />
          </div>
        )}
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
        <p className="line-clamp-2 text-sm font-semibold text-(--color-text-primary)">
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

const MovieCard = Object.assign(MovieCardImpl, { Skeleton });
export default MovieCard;

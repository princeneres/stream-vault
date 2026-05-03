import { Play } from "lucide-react";
import { cn } from "./cn";
import ProgressBar from "./ProgressBar";

export interface ItemCardProps {
  title: string;
  thumbnail?: string | null;
  progressPercent?: number;
  subtitle?: string;
  onClick?: () => void;
  onPlay?: () => void;
  className?: string;
}

function ItemCardImpl({
  title,
  thumbnail,
  progressPercent,
  subtitle,
  onClick,
  onPlay,
  className,
}: ItemCardProps) {
  const interactive = Boolean(onClick);
  const Wrapper = interactive ? "button" : "div";
  return (
    <Wrapper
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group relative flex w-56 shrink-0 flex-col gap-2 text-left",
        interactive &&
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) rounded-(--radius-card)",
        className,
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-(--radius-card) bg-(--color-surface-raised) shadow-(--shadow-card) transition-transform group-hover:-translate-y-0.5 group-hover:shadow-(--shadow-card-hover)">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-(--color-text-muted)">
            <Play size={28} aria-hidden />
          </div>
        )}
        {onPlay ? (
          <span
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-(--radius-pill) bg-(--color-bg)/80 text-(--color-text-primary) opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            role="button"
            tabIndex={-1}
            aria-label="Play"
          >
            <Play size={14} aria-hidden />
          </span>
        ) : null}
        {typeof progressPercent === "number" && progressPercent > 0 ? (
          <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1.5">
            <ProgressBar value={progressPercent / 100} size="sm" />
          </div>
        ) : null}
      </div>
      <div className="px-0.5">
        <p className="line-clamp-2 text-sm font-medium text-(--color-text-primary)">
          {title}
        </p>
        {subtitle ? (
          <p className="text-xs text-(--color-text-secondary)">{subtitle}</p>
        ) : null}
      </div>
    </Wrapper>
  );
}

function Skeleton() {
  return (
    <div className="flex w-56 shrink-0 flex-col gap-2">
      <div className="aspect-video animate-pulse rounded-(--radius-card) bg-(--color-surface-raised)" />
      <div className="space-y-1.5 px-0.5">
        <div className="h-3 w-4/5 animate-pulse rounded bg-(--color-surface-raised)" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-(--color-surface-raised)" />
      </div>
    </div>
  );
}

const ItemCard = Object.assign(ItemCardImpl, { Skeleton });
export default ItemCard;

import { memo } from "react";
import { Layers } from "lucide-react";
import type { LibraryKind } from "@/lib/types";
import KindIcon from "./KindIcon";
import { cn } from "./cn";

const CV_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "240px 220px",
} as const;

export interface GroupCardProps {
  id: number;
  title: string;
  poster?: string | null;
  kind: LibraryKind;
  completedCount?: number;
  totalCount?: number;
  nextEpisode?: string;
  onActivate?: (id: number) => void;
  className?: string;
}

function metadata(props: GroupCardProps): string | null {
  if (props.kind === "courses" && typeof props.totalCount === "number") {
    return `${props.completedCount ?? 0} / ${props.totalCount} lessons`;
  }
  if (props.kind === "series") {
    if (props.nextEpisode) return `Next: ${props.nextEpisode}`;
    if (typeof props.totalCount === "number") {
      return `${props.completedCount ?? 0} / ${props.totalCount} episodes`;
    }
  }
  if (props.kind === "generic" && typeof props.totalCount === "number") {
    return `${props.totalCount} items`;
  }
  return null;
}

function GroupCardImpl(props: GroupCardProps) {
  const { id, title, poster, kind, onActivate, className } = props;
  const meta = metadata(props);
  return (
    <button
      type="button"
      onClick={onActivate ? () => onActivate(id) : undefined}
      style={CV_STYLE}
      className={cn(
        "group relative flex w-full flex-col gap-2 text-left",
        "rounded-(--radius-card) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
        "motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-[0.98]",
        className,
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-(--radius-card) bg-(--color-surface-raised) shadow-(--shadow-card) motion-safe:transition-all motion-safe:duration-200 motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:shadow-(--shadow-card-hover) hover:[will-change:transform]">
        {poster ? (
          <img
            src={poster}
            alt=""
            width={320}
            height={180}
            className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.04]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-(--color-text-muted)">
            <Layers size={28} aria-hidden />
          </div>
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-(--radius-pill) bg-(--color-bg)/70 px-2 py-0.5 text-[11px] text-(--color-text-secondary)">
          <KindIcon kind={kind} size={12} />
          <span className="capitalize">{kind}</span>
        </span>
      </div>
      <div className="px-0.5">
        <p className="line-clamp-2 text-pretty text-sm font-semibold text-(--color-text-primary)">
          {title}
        </p>
        {meta ? (
          <p className="tabular-nums text-xs text-(--color-text-secondary)">
            {meta}
          </p>
        ) : null}
      </div>
    </button>
  );
}

function Skeleton() {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="aspect-video animate-pulse rounded-(--radius-card) bg-(--color-surface-raised)" />
      <div className="space-y-1.5 px-0.5">
        <div className="h-3 w-4/5 animate-pulse rounded bg-(--color-surface-raised)" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-(--color-surface-raised)" />
      </div>
    </div>
  );
}

const MemoGroupCard = memo(GroupCardImpl);
const GroupCard = Object.assign(MemoGroupCard, { Skeleton });
export default GroupCard;

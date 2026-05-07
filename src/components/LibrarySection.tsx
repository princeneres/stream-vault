import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "./cn";

export interface LibrarySectionProps {
  title: string;
  seeAllHref?: string;
  onSeeAll?: () => void;
  children: ReactNode;
  className?: string;
}

export default function LibrarySection({
  title,
  seeAllHref,
  onSeeAll,
  children,
  className,
}: LibrarySectionProps) {
  return (
    <section
      className={cn("space-y-3", className)}
      style={{ contentVisibility: "auto", containIntrinsicSize: "1px 280px" }}
    >
      <header className="flex items-end justify-between gap-4">
        <h2 className="text-lg font-semibold text-(--color-text-primary)">{title}</h2>
        {seeAllHref ? (
          <a
            href={seeAllHref}
            className="inline-flex items-center gap-1 text-sm text-(--color-text-secondary) hover:text-(--color-accent) transition-colors"
          >
            See all
            <ArrowRight size={14} aria-hidden />
          </a>
        ) : onSeeAll ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex items-center gap-1 text-sm text-(--color-text-secondary) hover:text-(--color-accent) transition-colors"
          >
            See all
            <ArrowRight size={14} aria-hidden />
          </button>
        ) : null}
      </header>
      <div
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2"
        style={{ scrollbarWidth: "thin" }}
      >
        {/* Children should each set `snap-start` (cards do by default via shrink-0). */}
        {children}
      </div>
    </section>
  );
}

import { Fragment } from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import type { Crumb } from "@/lib/breadcrumb";
import { cn } from "./cn";

const MAX_VISIBLE = 4;

export interface BreadcrumbsProps {
  crumbs: Crumb[];
}

/**
 * Compact navigation trail. Collapses the middle into a "…" when the chain
 * exceeds MAX_VISIBLE so the bar never overflows on deep nesting.
 */
export default function Breadcrumbs({ crumbs }: BreadcrumbsProps) {
  if (crumbs.length === 0) return null;

  let display: (Crumb | "ellipsis")[] = crumbs;
  if (crumbs.length > MAX_VISIBLE) {
    display = [crumbs[0], "ellipsis", ...crumbs.slice(crumbs.length - 2)];
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {display.map((c, i) => {
          const last = i === display.length - 1;
          return (
            <Fragment key={i}>
              <li className="flex min-w-0 items-center">
                {c === "ellipsis" ? (
                  <span className="px-1 text-(--color-text-muted)">
                    <MoreHorizontal size={14} aria-hidden />
                  </span>
                ) : c.onNavigate ? (
                  <button
                    type="button"
                    onClick={c.onNavigate}
                    className="truncate rounded-(--radius-sm) px-1.5 py-0.5 text-(--color-text-secondary) transition-colors hover:bg-(--color-surface-hover) hover:text-(--color-text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
                  >
                    {c.label}
                  </button>
                ) : (
                  <span
                    aria-current="page"
                    className={cn(
                      "truncate px-1.5 py-0.5 font-medium",
                      "text-(--color-text-primary)",
                    )}
                  >
                    {c.label}
                  </span>
                )}
              </li>
              {!last ? (
                <li aria-hidden className="text-(--color-text-muted)">
                  <ChevronRight size={14} />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

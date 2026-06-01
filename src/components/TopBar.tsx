import { type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Crumb } from "@/lib/breadcrumb";
import type { NavHistory } from "@/lib/router";
import Breadcrumbs from "./Breadcrumbs";
import IconButton from "./IconButton";
import { cn } from "./cn";

export interface TopBarProps {
  history: NavHistory;
  crumbs: Crumb[];
  onSearch: () => void;
  actions?: ReactNode;
}

export default function TopBar({
  history,
  crumbs,
  onSearch,
  actions,
}: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-(--color-border-subtle) bg-(--color-surface)/80 px-3 backdrop-blur">
      <div className="flex items-center gap-0.5">
        <IconButton
          icon={<ChevronLeft size={18} />}
          tooltip="Back (Alt+←)"
          onClick={history.back}
          disabled={!history.canBack}
        />
        <IconButton
          icon={<ChevronRight size={18} />}
          tooltip="Forward (Alt+→)"
          onClick={history.forward}
          disabled={!history.canForward}
        />
      </div>

      <div className="min-w-0 flex-1">
        <Breadcrumbs crumbs={crumbs} />
      </div>

      <button
        type="button"
        onClick={onSearch}
        className={cn(
          "flex h-8 w-40 items-center gap-2 rounded-(--radius-control) px-2.5 text-sm md:w-56",
          "border border-(--color-border-subtle) bg-(--color-bg) text-(--color-text-muted)",
          "transition-colors hover:text-(--color-text-secondary)",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
        )}
        aria-label="Search"
      >
        <Search size={14} aria-hidden />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded bg-(--color-surface-raised) px-1.5 py-0.5 text-[10px] text-(--color-text-muted)">
          /
        </kbd>
      </button>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "./cn";

export interface SidebarItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: string | number;
}

export interface SidebarProps {
  items: SidebarItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onSearch?: () => void;
  className?: string;
}

export default function Sidebar({
  items,
  activeId,
  onSelect,
  onSearch,
  className,
}: SidebarProps) {
  return (
    <aside
      aria-label="Primary"
      className={cn(
        "flex h-full w-60 shrink-0 flex-col gap-2 border-r border-(--color-border-subtle) bg-(--color-surface) px-3 py-4",
        className,
      )}
    >
      <div className="px-2 pb-2">
        <h1 className="text-base font-semibold tracking-tight text-(--color-text-primary)">
          Stream Vault
        </h1>
      </div>
      {onSearch ? (
        <button
          type="button"
          onClick={onSearch}
          className={cn(
            "flex h-9 items-center gap-2 rounded-(--radius-control) px-3 text-sm",
            "bg-(--color-surface-raised) text-(--color-text-secondary)",
            "hover:text-(--color-text-primary) transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
          )}
        >
          <Search size={14} aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded bg-(--color-bg) px-1.5 py-0.5 text-[10px] text-(--color-text-muted)">
            /
          </kbd>
        </button>
      ) : null}
      <nav
        aria-label="Libraries"
        className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      >
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-(--radius-control) px-3 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
                active
                  ? "bg-(--color-accent-soft) text-(--color-text-primary)"
                  : "text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)",
              )}
            >
              <span className="flex shrink-0 text-(--color-text-secondary)">
                {item.icon}
              </span>
              <span className="flex-1 truncate text-left">{item.label}</span>
              {item.badge !== undefined ? (
                <span className="rounded-(--radius-pill) bg-(--color-bg) px-1.5 py-0.5 text-[11px] text-(--color-text-muted)">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

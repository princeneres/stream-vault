import { memo, type ReactNode } from "react";
import { Keyboard, Search } from "lucide-react";
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
  onShortcuts?: () => void;
  className?: string;
}

const QUICK_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["/"], label: "Search" },
  { keys: ["g", "h"], label: "Home" },
  { keys: ["g", "s"], label: "Settings" },
  { keys: ["?"], label: "More" },
];

function Sidebar({
  items,
  activeId,
  onSelect,
  onSearch,
  onShortcuts,
  className,
}: SidebarProps) {
  return (
    <aside
      aria-label="Primary"
      className={cn(
        "flex h-full w-(--layout-sidebar) shrink-0 flex-col gap-2 border-r border-(--color-border-subtle) bg-(--color-surface) px-3 py-4",
        className,
      )}
    >
      <div className="px-2 pb-2">
        <h1 className="font-display text-lg font-bold tracking-tight text-(--color-text-primary)">
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
        className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2"
      >
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                "relative flex h-9 items-center gap-2.5 rounded-(--radius-control) px-3 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
                "before:absolute before:left-0 before:h-5 before:w-0.5 before:rounded-(--radius-pill) before:bg-(--color-accent) before:transition-opacity before:content-['']",
                active
                  ? "bg-(--color-accent-soft) text-(--color-text-primary) before:opacity-100"
                  : "text-(--color-text-secondary) before:opacity-0 hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)",
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
      <button
        type="button"
        onClick={onShortcuts}
        disabled={!onShortcuts}
        aria-label="Show keyboard shortcuts"
        className="group/sc mt-2 flex flex-col gap-1.5 rounded-(--radius-control) border border-(--color-border-subtle) bg-(--color-surface-raised) px-3 py-2 text-left transition-colors hover:bg-(--color-surface-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) disabled:cursor-default disabled:hover:bg-(--color-surface-raised)"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
          <Keyboard size={11} aria-hidden />
          Shortcuts
        </span>
        <ul className="space-y-1">
          {QUICK_SHORTCUTS.map((s) => (
            <li
              key={s.label}
              className="flex items-center justify-between gap-2 text-[11px] text-(--color-text-secondary)"
            >
              <span>{s.label}</span>
              <span className="flex items-center gap-0.5">
                {s.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="rounded bg-(--color-bg) px-1 py-px text-[10px] font-medium text-(--color-text-primary)"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </button>
    </aside>
  );
}

export default memo(Sidebar);

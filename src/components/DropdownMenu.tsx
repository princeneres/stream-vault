import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";

export type MenuItem =
  | { kind: "label"; label: string }
  | { kind: "separator" }
  | { kind: "action"; label: string; onSelect: () => void; disabled?: boolean }
  | {
      kind: "radio";
      label: string;
      value: string;
      current: string;
      onChange: (next: string) => void;
    }
  | {
      kind: "checkbox";
      label: string;
      checked: boolean;
      onChange: (next: boolean) => void;
    };

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  triggerLabel?: string;
}

export default function DropdownMenu({
  trigger,
  items,
  align = "start",
  triggerLabel,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        className="inline-flex"
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute top-full mt-1 min-w-48 overflow-hidden rounded-(--radius-control) border border-(--color-border-subtle) bg-(--color-surface-raised) py-1 shadow-(--shadow-modal) z-(--z-overlay)",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, i) => renderItem(item, i, () => setOpen(false)))}
        </div>
      ) : null}
    </div>
  );
}

function renderItem(item: MenuItem, key: number, close: () => void) {
  switch (item.kind) {
    case "label":
      return (
        <p
          key={key}
          className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)"
        >
          {item.label}
        </p>
      );
    case "separator":
      return (
        <div
          key={key}
          role="separator"
          className="my-1 h-px bg-(--color-border-subtle)"
        />
      );
    case "action":
      return (
        <button
          key={key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect();
            close();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-(--color-text-primary) hover:bg-(--color-surface-hover) disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {item.label}
        </button>
      );
    case "radio": {
      const active = item.current === item.value;
      return (
        <button
          key={key}
          type="button"
          role="menuitemradio"
          aria-checked={active}
          onClick={() => {
            item.onChange(item.value);
            close();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-(--color-text-primary) hover:bg-(--color-surface-hover)"
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {active ? <Check size={14} aria-hidden /> : null}
          </span>
          <span>{item.label}</span>
        </button>
      );
    }
    case "checkbox":
      return (
        <button
          key={key}
          type="button"
          role="menuitemcheckbox"
          aria-checked={item.checked}
          onClick={() => {
            item.onChange(!item.checked);
            close();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-(--color-text-primary) hover:bg-(--color-surface-hover)"
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {item.checked ? <Check size={14} aria-hidden /> : null}
          </span>
          <span>{item.label}</span>
        </button>
      );
  }
}

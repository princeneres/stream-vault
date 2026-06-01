import { Check } from "lucide-react";
import { THEMES, type Theme } from "@/lib/theme";
import { cn } from "./cn";

export interface ThemePickerProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

/**
 * Swatch grid for picking a theme. Chips render with literal palette hex
 * (the only intentional use of fixed colors) so every preview looks correct
 * regardless of the active theme.
 */
export default function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      {THEMES.map((t) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(t.value)}
            className={cn(
              "group flex flex-col gap-2 rounded-(--radius-card) border p-2.5 text-left",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
              selected
                ? "border-(--color-accent) bg-(--color-accent-soft)"
                : "border-(--color-border-subtle) bg-(--color-surface) hover:bg-(--color-surface-hover)",
            )}
          >
            <span
              className="flex h-12 items-center gap-1.5 overflow-hidden rounded-(--radius-sm) border border-black/10 px-2.5"
              style={{ backgroundColor: t.swatches[0] }}
            >
              {t.swatches.slice(1).map((c, i) => (
                <span
                  key={i}
                  className="h-5 w-5 rounded-full shadow-sm ring-1 ring-black/10"
                  style={{ backgroundColor: c }}
                />
              ))}
            </span>
            <span className="flex items-center justify-between gap-1">
              <span className="text-sm font-medium text-(--color-text-primary)">
                {t.label}
              </span>
              {selected ? (
                <Check size={14} className="text-(--color-accent)" aria-hidden />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

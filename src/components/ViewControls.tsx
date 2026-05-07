import { ArrowDownUp, Filter } from "lucide-react";
import {
  FILTER_OPTIONS,
  SORT_OPTIONS,
  type ViewPrefs,
} from "@/lib/viewPrefs";
import DropdownMenu, { type MenuItem } from "./DropdownMenu";

export interface ViewControlsProps {
  prefs: ViewPrefs;
  onChange: (next: ViewPrefs) => void;
}

const PILL_CLASS =
  "h-8 gap-1.5 rounded-(--radius-control) border border-(--color-border-subtle) bg-(--color-surface) px-3 text-xs font-medium text-(--color-text-secondary) transition-colors hover:bg-(--color-surface-raised) hover:text-(--color-text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)";

export default function ViewControls({ prefs, onChange }: ViewControlsProps) {
  const sortLabel =
    SORT_OPTIONS.find(([k]) => k === prefs.sort)?.[1] ?? "Sort";
  const filterLabel =
    prefs.filter === "all"
      ? "All"
      : FILTER_OPTIONS.find(([k]) => k === prefs.filter)?.[1] ?? "All";

  const sortItems: MenuItem[] = [
    { kind: "label", label: "Sort by" },
    ...SORT_OPTIONS.map(
      ([value, label]): MenuItem => ({
        kind: "radio",
        label,
        value,
        current: prefs.sort,
        onChange: (next) =>
          onChange({ ...prefs, sort: next as ViewPrefs["sort"] }),
      }),
    ),
  ];

  const filterItems: MenuItem[] = [
    { kind: "label", label: "Filter" },
    ...FILTER_OPTIONS.map(
      ([value, label]): MenuItem => ({
        kind: "radio",
        label,
        value,
        current: prefs.filter,
        onChange: (next) =>
          onChange({ ...prefs, filter: next as ViewPrefs["filter"] }),
      }),
    ),
  ];

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu
        triggerLabel="Sort"
        align="end"
        triggerClassName={PILL_CLASS}
        trigger={
          <>
            <ArrowDownUp size={12} aria-hidden />
            <span>{sortLabel}</span>
          </>
        }
        items={sortItems}
      />
      <DropdownMenu
        triggerLabel="Filter"
        align="end"
        triggerClassName={PILL_CLASS}
        trigger={
          <>
            <Filter size={12} aria-hidden />
            <span>{filterLabel}</span>
          </>
        }
        items={filterItems}
      />
    </div>
  );
}

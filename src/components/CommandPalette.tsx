import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, Play, Search } from "lucide-react";
import {
  convertFileSrc,
  playItem as playItemApi,
  search as searchApi,
} from "@/lib/api";
import type { Group, ItemWithProgress, SearchResults } from "@/lib/types";
import { cn } from "./cn";

const RECENT_KEY = "streamvault:recent-searches";
const RECENT_MAX = 5;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const current = loadRecent();
    const next = [trimmed, ...current.filter((q) => q !== trimmed)].slice(
      0,
      RECENT_MAX,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenGroup: (id: number) => void;
}

interface FlatRow {
  key: string;
  kind: "group" | "item";
  group?: Group;
  item?: ItemWithProgress;
}

function flatten(results: SearchResults | null): FlatRow[] {
  if (!results) return [];
  const rows: FlatRow[] = [];
  for (const g of results.groups) {
    rows.push({ key: `g:${g.id}`, kind: "group", group: g });
  }
  for (const i of results.items) {
    rows.push({ key: `i:${i.id}`, kind: "item", item: i });
  }
  return rows;
}

export default function CommandPalette({
  open,
  onClose,
  onOpenGroup,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRecent(loadRecent());
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setResults(null);
    }
  }, [open]);

  // Restore focus to the trigger when the palette closes.
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    return () => trigger?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await searchApi(trimmed);
        if (!cancelled) {
          setResults(r);
          setActiveIndex(0);
        }
      } catch (e) {
        console.error("search failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const rows = useMemo(() => flatten(results), [results]);

  const choose = (row: FlatRow) => {
    pushRecent(query);
    if (row.kind === "group" && row.group) {
      onOpenGroup(row.group.id);
    } else if (row.kind === "item" && row.item) {
      playItemApi(row.item.id).catch((e) =>
        console.error("playItem failed", e),
      );
    }
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const row = rows[activeIndex];
        if (row) {
          e.preventDefault();
          choose(row);
        }
      } else if (e.key === "Tab") {
        // Trap focus within the dialog.
        const root = dialogRef.current;
        if (!root) return;
        const focusable = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === root)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, rows, activeIndex, query]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="motion-safe:animate-overlay-in fixed inset-0 z-(--z-modal) flex items-start justify-center bg-(--color-overlay) p-4 pt-[10vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="motion-safe:animate-dialog-in w-full max-w-xl overflow-hidden rounded-(--radius-card-lg) border border-(--color-border-subtle) bg-(--color-surface) shadow-(--shadow-modal)"
      >
        <div className="flex items-center gap-2 border-b border-(--color-border-subtle) px-4">
          <Search
            size={16}
            aria-hidden
            className="text-(--color-text-muted)"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search libraries, groups, items…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Search query"
            className="h-12 flex-1 bg-transparent text-sm text-(--color-text-primary) outline-none placeholder:text-(--color-text-muted)"
          />
          <kbd className="hidden rounded bg-(--color-bg) px-1.5 py-0.5 text-[10px] text-(--color-text-muted) sm:inline">
            Esc
          </kbd>
        </div>

        <div
          className="max-h-[60vh] overflow-y-auto p-2"
          role="listbox"
          aria-label="Search results"
        >
          {!query.trim() ? (
            recent.length > 0 ? (
              <div>
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                  Recent
                </p>
                {recent.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuery(q)}
                    className="flex w-full items-center gap-2 rounded-(--radius-control) px-3 py-2 text-left text-sm text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)"
                  >
                    <Search size={14} aria-hidden />
                    <span className="truncate">{q}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 py-6 text-center text-sm text-(--color-text-muted)">
                Start typing to search.
              </p>
            )
          ) : loading && rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-(--color-text-muted)">
              Searching…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-(--color-text-muted)">
              No results.
            </p>
          ) : (
            <ResultsList
              rows={rows}
              activeIndex={activeIndex}
              onChoose={choose}
              onHover={setActiveIndex}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ResultsList({
  rows,
  activeIndex,
  onChoose,
  onHover,
}: {
  rows: FlatRow[];
  activeIndex: number;
  onChoose: (row: FlatRow) => void;
  onHover: (idx: number) => void;
}) {
  const groups = rows.filter((r) => r.kind === "group");
  const items = rows.filter((r) => r.kind === "item");

  return (
    <div className="space-y-2">
      {groups.length > 0 ? (
        <Section
          label="Groups"
          rows={groups}
          rowsAll={rows}
          activeIndex={activeIndex}
          onChoose={onChoose}
          onHover={onHover}
        />
      ) : null}
      {items.length > 0 ? (
        <Section
          label="Items"
          rows={items}
          rowsAll={rows}
          activeIndex={activeIndex}
          onChoose={onChoose}
          onHover={onHover}
        />
      ) : null}
    </div>
  );
}

function Section({
  label,
  rows,
  rowsAll,
  activeIndex,
  onChoose,
  onHover,
}: {
  label: string;
  rows: FlatRow[];
  rowsAll: FlatRow[];
  activeIndex: number;
  onChoose: (row: FlatRow) => void;
  onHover: (idx: number) => void;
}) {
  return (
    <div>
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
        {label}
      </p>
      {rows.map((row) => {
        const idx = rowsAll.indexOf(row);
        const active = idx === activeIndex;
        return (
          <button
            key={row.key}
            type="button"
            role="option"
            aria-selected={active}
            onMouseEnter={() => onHover(idx)}
            onClick={() => onChoose(row)}
            className={cn(
              "flex w-full items-center gap-3 rounded-(--radius-control) px-3 py-2 text-left",
              active
                ? "bg-(--color-accent-soft) text-(--color-text-primary)"
                : "text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)",
            )}
          >
            <Thumbnail row={row} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {row.kind === "group" ? row.group?.title : row.item?.title}
              </p>
              <p className="truncate text-xs text-(--color-text-muted)">
                {row.kind === "group" ? "Group" : "Item"}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Thumbnail({ row }: { row: FlatRow }) {
  const path =
    row.kind === "group"
      ? row.group?.posterPath
      : row.item?.thumbnailPath;
  if (path) {
    return (
      <img
        src={convertFileSrc(path)}
        alt=""
        width={48}
        height={32}
        className="h-8 w-12 shrink-0 rounded object-cover"
        decoding="async"
        loading="lazy"
      />
    );
  }
  return (
    <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-(--color-surface-raised) text-(--color-text-muted)">
      {row.kind === "group" ? (
        <Layers size={14} aria-hidden />
      ) : (
        <Play size={14} aria-hidden />
      )}
    </span>
  );
}

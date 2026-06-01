import type { Route } from "@/lib/router";
import { THEMES, type Theme } from "@/lib/theme";
import type { Library } from "@/lib/types";

export type CommandGroup = "Navigation" | "Theme" | "Actions";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  keywords?: string[];
  run: () => void | Promise<void>;
}

export interface CommandDeps {
  navigate: (r: Route) => void;
  libraries: Library[];
  applyTheme: (t: Theme) => void;
  toggleMotion: () => void;
  rescan: (libraryId: number) => Promise<void> | void;
  closePalette: () => void;
}

export function buildCommands(d: CommandDeps): Command[] {
  const close = d.closePalette;
  return [
    {
      id: "nav:home",
      title: "Go to Home",
      group: "Navigation",
      keywords: ["home", "start"],
      run: () => {
        d.navigate({ kind: "home" });
        close();
      },
    },
    {
      id: "nav:settings",
      title: "Go to Settings",
      group: "Navigation",
      keywords: ["settings", "preferences", "config"],
      run: () => {
        d.navigate({ kind: "settings" });
        close();
      },
    },
    ...d.libraries.map((l) => ({
      id: `nav:lib:${l.id}`,
      title: `Open library: ${l.name}`,
      group: "Navigation" as const,
      keywords: ["library", l.name],
      run: () => {
        d.navigate({ kind: "library", id: l.id });
        close();
      },
    })),
    ...THEMES.map((t) => ({
      id: `theme:${t.value}`,
      title: `Theme: ${t.label}`,
      group: "Theme" as const,
      keywords: ["theme", "appearance", t.label],
      run: () => {
        d.applyTheme(t.value);
        close();
      },
    })),
    {
      id: "action:toggle-motion",
      title: "Toggle animations",
      group: "Actions",
      keywords: ["animation", "motion", "reduce", "disable"],
      run: () => {
        d.toggleMotion();
        close();
      },
    },
    ...d.libraries.map((l) => ({
      id: `action:rescan:${l.id}`,
      title: `Rescan library: ${l.name}`,
      group: "Actions" as const,
      keywords: ["scan", "rescan", "refresh", l.name],
      run: async () => {
        close();
        await d.rescan(l.id);
      },
    })),
  ];
}

/**
 * Subsequence fuzzy score. Rewards contiguous runs and word-start matches.
 * Returns null when `query` is not a subsequence of `target`.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatch = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastMatch === ti - 1 ? 2 : 1;
      if (ti === 0 || t[ti - 1] === " ") score += 1;
      lastMatch = ti;
      qi++;
    }
  }
  return qi === q.length ? score : null;
}

export function matchCommands(query: string, commands: Command[]): Command[] {
  const q = query.trim();
  if (!q) return commands;
  return commands
    .map((c) => ({
      c,
      s: fuzzyScore(q, `${c.title} ${(c.keywords ?? []).join(" ")}`),
    }))
    .filter((x): x is { c: Command; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

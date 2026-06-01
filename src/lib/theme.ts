export type Theme =
  | "dark"
  | "light"
  | "synthwave"
  | "dracula"
  | "emerald"
  | "nord";

export interface ThemeMeta {
  value: Theme;
  label: string;
  scheme: "dark" | "light";
  /** Preview chips: [bg, surface, accent, semantic, text]. */
  swatches: [string, string, string, string, string];
}

export const THEMES: ThemeMeta[] = [
  { value: "dark", label: "Dark", scheme: "dark", swatches: ["#191919", "#202020", "#529cca", "#4dab9a", "#ffffff"] },
  { value: "light", label: "Light", scheme: "light", swatches: ["#fafaf9", "#ffffff", "#2c80c4", "#2f8f7c", "#1f1f1f"] },
  { value: "synthwave", label: "Synthwave", scheme: "dark", swatches: ["#160e29", "#1d1338", "#ff2fb9", "#2cf5c4", "#fdf4ff"] },
  { value: "dracula", label: "Dracula", scheme: "dark", swatches: ["#282a36", "#2f313f", "#bd93f9", "#50fa7b", "#f8f8f2"] },
  { value: "emerald", label: "Emerald", scheme: "light", swatches: ["#f4faf6", "#ffffff", "#0f9d63", "#c08a04", "#0f2419"] },
  { value: "nord", label: "Nord", scheme: "dark", swatches: ["#2e3440", "#3b4252", "#88c0d0", "#a3be8c", "#eceff4"] },
];

const STORAGE_KEY = "stream-vault:theme";
const DEFAULT_THEME: Theme = "dark";
const VALID = new Set<Theme>(THEMES.map((t) => t.value));

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "purple") return "dracula"; // migrate retired theme
    if (v && VALID.has(v as Theme)) return v as Theme;
  } catch {
    // localStorage unavailable — fall through to default
  }
  return DEFAULT_THEME;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore quota / privacy-mode errors
  }
}

/* ---- Motion (animation enable/disable, independent of OS preference) ---- */

const MOTION_KEY = "stream-vault:reduce-motion";

/** Returns true when animations are enabled. */
export function getStoredMotion(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) !== "off";
  } catch {
    return true;
  }
}

export function applyMotion(enabled: boolean): void {
  if (enabled) delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = "off";
  try {
    localStorage.setItem(MOTION_KEY, enabled ? "on" : "off");
  } catch {
    // ignore quota / privacy-mode errors
  }
}

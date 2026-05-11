export type Theme = "dark" | "light" | "purple";

export const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark (default)" },
  { value: "light", label: "Light" },
  { value: "purple", label: "Purple" },
];

const STORAGE_KEY = "stream-vault:theme";
const DEFAULT_THEME: Theme = "dark";

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "purple") return v;
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

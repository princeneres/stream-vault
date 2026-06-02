import type { Library, LibraryKind } from "./types";

/** Singular unit term per kind when a library has no custom `itemLabel`.
 *  Mirrors `LibraryKind::default_item_label` in `src-tauri/src/models.rs`. */
const DEFAULT_UNIT_LABEL: Record<LibraryKind, string> = {
  courses: "lesson",
  series: "episode",
  movies: "movie",
  generic: "video",
};

/** Short, audience-neutral display name for a scanner kind (used on badges). */
const KIND_DISPLAY: Record<LibraryKind, string> = {
  courses: "Course",
  series: "Series",
  movies: "Movies",
  generic: "Videos",
};

/** Friendly label for a library kind, e.g. for a badge. */
export function kindLabel(kind: LibraryKind): string {
  return KIND_DISPLAY[kind];
}

/** Naive English pluralization good enough for the short unit terms we use
 *  ("lesson" → "lessons", "episode" → "episodes", "part" → "parts"). */
function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.replace(/y$/i, "ies");
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** The singular unit term for a library (custom `itemLabel` or kind default). */
export function unitTerm(library: Pick<Library, "kind" | "itemLabel">): string {
  return library.itemLabel?.trim() || DEFAULT_UNIT_LABEL[library.kind];
}

/** A count rendered with the library's unit term, e.g. `"12 lessons"`. */
export function unitLabel(
  library: Pick<Library, "kind" | "itemLabel">,
  count: number,
): string {
  const term = unitTerm(library);
  return `${count} ${count === 1 ? term : pluralize(term)}`;
}

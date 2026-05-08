import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export { convertFileSrc };
import type {
  GroupDetail,
  Item,
  ItemWithProgress,
  Library,
  LibraryContents,
  LibraryKind,
  Note,
  NoteSavedEvent,
  ProgressUpdate,
  ScanResult,
  SearchResults,
} from "./types";

export function listLibraries(): Promise<Library[]> {
  return invoke<Library[]>("list_libraries");
}

export function addLibrary(
  name: string,
  rootPath: string,
  kind: LibraryKind,
): Promise<Library> {
  return invoke<Library>("add_library", { name, rootPath, kind });
}

export function removeLibrary(libraryId: number): Promise<void> {
  return invoke<void>("remove_library", { libraryId });
}

export function scanLibrary(libraryId: number): Promise<ScanResult> {
  return invoke<ScanResult>("scan_library", { libraryId });
}

export function getLibraryContents(libraryId: number): Promise<LibraryContents> {
  return invoke<LibraryContents>("get_library_contents", { libraryId });
}

export function getGroup(groupId: number): Promise<GroupDetail> {
  return invoke<GroupDetail>("get_group", { groupId });
}

export function getContinueWatching(limit: number): Promise<ItemWithProgress[]> {
  return invoke<ItemWithProgress[]>("get_continue_watching", { limit });
}

export function getNextItem(groupId: number): Promise<Item | null> {
  return invoke<Item | null>("get_next_item", { groupId });
}

export function search(query: string): Promise<SearchResults> {
  return invoke<SearchResults>("search", { query });
}

export function playItem(itemId: number): Promise<void> {
  return invoke<void>("play_item", { itemId });
}

export function playItemAt(itemId: number, startSeconds: number): Promise<void> {
  return invoke<void>("play_item_at", { itemId, startSeconds });
}

export function setItemCompleted(
  itemId: number,
  completed: boolean,
): Promise<void> {
  return invoke<void>("set_item_completed", { itemId, completed });
}

export function setGroupCompleted(
  groupId: number,
  completed: boolean,
): Promise<void> {
  return invoke<void>("set_group_completed", { groupId, completed });
}

export function setGroupPoster(
  groupId: number,
  sourcePath: string,
): Promise<string> {
  return invoke<string>("set_group_poster", { groupId, sourcePath });
}

export function regenerateLibraryArtwork(libraryId: number): Promise<void> {
  return invoke<void>("regenerate_library_artwork", { libraryId });
}

export function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting", { key });
}

export function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>("set_setting", { key, value });
}

export async function onItemProgress(
  handler: (update: ProgressUpdate) => void,
): Promise<UnlistenFn> {
  return listen<ProgressUpdate>("item-progress", (event) => handler(event.payload));
}

// ---- Notes ----------------------------------------------------------------

export function addNote(
  itemId: number,
  timestampSec: number,
  content: string,
): Promise<Note> {
  return invoke<Note>("add_note", { itemId, timestampSec, content });
}

export function updateNote(noteId: number, content: string): Promise<Note> {
  return invoke<Note>("update_note", { noteId, content });
}

export function deleteNote(noteId: number): Promise<void> {
  return invoke<void>("delete_note", { noteId });
}

export function listNotesForItem(itemId: number): Promise<Note[]> {
  return invoke<Note[]>("list_notes_for_item", { itemId });
}

export function countNotesForItems(
  itemIds: number[],
): Promise<Record<number, number>> {
  return invoke<Record<number, number>>("count_notes_for_items", { itemIds });
}

export async function onNoteSaved(
  handler: (event: NoteSavedEvent) => void,
): Promise<UnlistenFn> {
  return listen<NoteSavedEvent>("note-saved", (event) => handler(event.payload));
}

// ---- mpv IPC --------------------------------------------------------------

export function mpvGetPosition(): Promise<number | null> {
  return invoke<number | null>("mpv_get_position");
}

export function mpvSetPaused(paused: boolean): Promise<void> {
  return invoke<void>("mpv_set_paused", { paused });
}

export function mpvSeek(seconds: number): Promise<void> {
  return invoke<void>("mpv_seek", { seconds });
}

export function mpvCurrentItemId(): Promise<number | null> {
  return invoke<number | null>("mpv_current_item_id");
}

// ---- Obsidian vault -------------------------------------------------------

export function republishVault(): Promise<number> {
  return invoke<number>("republish_vault");
}

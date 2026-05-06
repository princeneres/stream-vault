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

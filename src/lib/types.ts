// CONTRACT: domain types shared with the Rust backend.
//
// Mirror of `src-tauri/src/models.rs`. Wire format is camelCase
// (Rust uses `#[serde(rename_all = "camelCase")]`). Timestamps are ISO 8601
// strings (chrono `DateTime<Utc>` -> RFC3339).
//
// Owner: Orchestrator. Specialists must NOT change shapes here without
// flagging — `models.rs` and the SQL schema must stay in sync.

export type LibraryKind = "courses" | "series" | "movies" | "generic";

export interface Library {
  id: number;
  name: string;
  rootPath: string;
  kind: LibraryKind;
  createdAt: string;
  lastScannedAt: string | null;
  /** Transient — true if `rootPath` exists at query time. */
  available: boolean;
}

export interface Group {
  id: number;
  libraryId: number;
  parentGroupId: number | null;
  title: string;
  position: number;
  folderPath: string;
  posterPath: string | null;
  /** Total leaf items in this group's subtree (self + all descendants). */
  itemCount: number;
  /** Items in this group's subtree whose progress is completed. */
  completedCount: number;
}

export interface Item {
  id: number;
  libraryId: number;
  groupId: number | null;
  title: string;
  position: number;
  filePath: string;
  durationSeconds: number | null;
  thumbnailPath: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
}

export interface Progress {
  itemId: number;
  positionSeconds: number;
  completed: boolean;
  watchedAt: string;
}

export interface Note {
  id: number;
  itemId: number;
  timestampSec: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSavedEvent {
  kind: "added" | "updated" | "deleted";
  itemId: number;
  noteId: number | null;
}

/** `Item` flattened with an optional `Progress`. */
export type ItemWithProgress = Item & {
  progress: Progress | null;
};

export interface ProgressUpdate {
  itemId: number;
  positionSeconds: number;
  durationSeconds: number;
}

// --- Aggregates returned by commands ---

export interface ScanResult {
  itemsAdded: number;
  itemsRemoved: number;
  itemsUpdated: number;
  groupsAdded: number;
  groupsRemoved: number;
}

export interface LibraryContents {
  library: Library;
  groups: Group[];
  /** For `movies` libraries (groupId === null items). Empty for other kinds. */
  topItems: ItemWithProgress[];
}

export type AttachmentKind =
  | "image"
  | "pdf"
  | "archive"
  | "audio"
  | "document"
  | "text"
  | "other";

export interface Attachment {
  path: string;
  name: string;
  kind: AttachmentKind;
  sizeBytes: number;
  extension: string | null;
  /** Renderable preview image path (own path for image, generated PNG for PDF, null otherwise). */
  previewPath: string | null;
}

export interface GroupDetail {
  group: Group;
  subgroups: Group[];
  items: ItemWithProgress[];
  attachments: Attachment[];
}

export interface SearchResults {
  groups: Group[];
  items: ItemWithProgress[];
}

/** Every group and leaf item (with progress) in a library — powers the
 *  in-player playlist. */
export interface LibraryPlaylist {
  library: Library;
  groups: Group[];
  items: ItemWithProgress[];
}

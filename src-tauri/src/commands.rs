// CONTRACT: Tauri command surface area.
//
// Signatures are stable. Bodies are filled in by the specialist agents
// listed on each command. Errors crossing the Tauri boundary serialize as
// `Result<T, String>` (use `map_err(|e| e.to_string())` in implementations).
//
// Owner: Orchestrator. Specialists must NOT change a signature without
// flagging — the TS wrappers in `src/lib/api.ts` rely on these shapes.

use tauri::{AppHandle, State};

use crate::db::Database;
use crate::models::{
    GroupDetail, Item, ItemWithProgress, Library, LibraryContents, LibraryKind,
    ScanResult, SearchResults,
};

pub type CmdResult<T> = std::result::Result<T, String>;

// ---- Libraries (Backend Engineer) -----------------------------------------

/// List all configured libraries. Sets `available = false` if `root_path` is
/// missing on disk.
#[tauri::command]
pub fn list_libraries(_db: State<'_, Database>) -> CmdResult<Vec<Library>> {
    todo!("backend-eng")
}

/// Create a library row. Does not scan — caller must invoke `scan_library`.
#[tauri::command]
pub fn add_library(
    _db: State<'_, Database>,
    _name: String,
    _root_path: String,
    _kind: LibraryKind,
) -> CmdResult<Library> {
    todo!("backend-eng")
}

/// Delete library + cascading groups/items/progress.
#[tauri::command]
pub fn remove_library(_db: State<'_, Database>, _library_id: i64) -> CmdResult<()> {
    todo!("backend-eng")
}

// ---- Scanning (Backend Engineer) ------------------------------------------

/// Walk the library root and reconcile DB rows. Incremental: existing items
/// keyed by `file_path` keep their IDs and progress.
#[tauri::command]
pub fn scan_library(_db: State<'_, Database>, _library_id: i64) -> CmdResult<ScanResult> {
    todo!("backend-eng")
}

// ---- Reads (Backend Engineer) ---------------------------------------------

/// Top-level groups (and top items for movies) for a library.
#[tauri::command]
pub fn get_library_contents(
    _db: State<'_, Database>,
    _library_id: i64,
) -> CmdResult<LibraryContents> {
    todo!("backend-eng")
}

/// Group + immediate sub-groups + items (with progress) for a course/series
/// detail view.
#[tauri::command]
pub fn get_group(_db: State<'_, Database>, _group_id: i64) -> CmdResult<GroupDetail> {
    todo!("backend-eng")
}

/// Most recently watched in-progress items, newest first.
#[tauri::command]
pub fn get_continue_watching(
    _db: State<'_, Database>,
    _limit: u32,
) -> CmdResult<Vec<ItemWithProgress>> {
    todo!("backend-eng")
}

/// First unwatched item in a group's tree, ordered by `(group.position,
/// item.position)`. Falls back to the first item if all completed.
#[tauri::command]
pub fn get_next_item(_db: State<'_, Database>, _group_id: i64) -> CmdResult<Option<Item>> {
    todo!("backend-eng")
}

/// Case-insensitive `LIKE` over group + item titles. Up to 20 of each.
#[tauri::command]
pub fn search(_db: State<'_, Database>, _query: String) -> CmdResult<SearchResults> {
    todo!("backend-eng")
}

// ---- Playback (Player Engineer) -------------------------------------------

/// Spawn `mpv` for the given item. Returns immediately; progress is reported
/// via the `item-progress` event. A new call kills any in-flight session.
#[tauri::command]
pub fn play_item(
    _db: State<'_, Database>,
    _app: AppHandle,
    _item_id: i64,
) -> CmdResult<()> {
    todo!("player-eng")
}

// ---- Settings (Backend Engineer) ------------------------------------------

#[tauri::command]
pub fn get_setting(_db: State<'_, Database>, _key: String) -> CmdResult<Option<String>> {
    todo!("backend-eng")
}

#[tauri::command]
pub fn set_setting(
    _db: State<'_, Database>,
    _key: String,
    _value: String,
) -> CmdResult<()> {
    todo!("backend-eng")
}

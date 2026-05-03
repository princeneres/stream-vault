// CONTRACT: Tauri command surface area.
//
// Signatures are stable. Bodies are filled in by the specialist agents
// listed on each command. Errors crossing the Tauri boundary serialize as
// `Result<T, String>` (use `map_err(|e| e.to_string())` in implementations).
//
// Owner: Orchestrator. Specialists must NOT change a signature without
// flagging — the TS wrappers in `src/lib/api.ts` rely on these shapes.

use std::path::Path;

use tauri::{AppHandle, State};

use crate::db::Database;
use crate::models::{
    Group, GroupDetail, Item, ItemWithProgress, Library, LibraryContents,
    LibraryKind, ScanResult, SearchResults,
};
use crate::scanner;

pub type CmdResult<T> = std::result::Result<T, String>;

fn cmd_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---- Libraries (Backend Engineer) -----------------------------------------

/// List all configured libraries. Sets `available = false` if `root_path` is
/// missing on disk.
#[tauri::command]
pub fn list_libraries(db: State<'_, Database>) -> CmdResult<Vec<Library>> {
    let mut libs = db.list_libraries_raw().map_err(cmd_err)?;
    for l in &mut libs {
        l.available = Path::new(&l.root_path).is_dir();
    }
    Ok(libs)
}

/// Create a library row. Does not scan — caller must invoke `scan_library`.
#[tauri::command]
pub fn add_library(
    db: State<'_, Database>,
    name: String,
    root_path: String,
    kind: LibraryKind,
) -> CmdResult<Library> {
    let mut lib = db
        .insert_library(&name, &root_path, kind)
        .map_err(cmd_err)?;
    lib.available = Path::new(&lib.root_path).is_dir();
    Ok(lib)
}

/// Delete library + cascading groups/items/progress.
#[tauri::command]
pub fn remove_library(db: State<'_, Database>, library_id: i64) -> CmdResult<()> {
    db.delete_library_by_id(library_id).map_err(cmd_err)
}

// ---- Scanning (Backend Engineer) ------------------------------------------

/// Walk the library root and reconcile DB rows. Incremental: existing items
/// keyed by `file_path` keep their IDs and progress.
#[tauri::command]
pub fn scan_library(db: State<'_, Database>, library_id: i64) -> CmdResult<ScanResult> {
    let lib = db
        .get_library_by_id(library_id)
        .map_err(cmd_err)?
        .ok_or_else(|| format!("library {library_id} not found"))?;
    let result = scanner::scan(&lib, db.inner()).map_err(cmd_err)?;
    db.update_library_last_scanned(library_id, chrono::Utc::now())
        .map_err(cmd_err)?;
    // TODO(integrate-with-player-eng): after the Player Engineer's
    // `thumbnails::generate_thumbnail` / `generate_poster` are merged, call
    // them here for newly-added items / groups (best-effort, non-fatal).
    Ok(result)
}

// ---- Reads (Backend Engineer) ---------------------------------------------

/// Top-level groups (and top items for movies) for a library.
#[tauri::command]
pub fn get_library_contents(
    db: State<'_, Database>,
    library_id: i64,
) -> CmdResult<LibraryContents> {
    let mut library = db
        .get_library_by_id(library_id)
        .map_err(cmd_err)?
        .ok_or_else(|| format!("library {library_id} not found"))?;
    library.available = Path::new(&library.root_path).is_dir();
    let groups: Vec<Group> = db.list_top_level_groups(library_id).map_err(cmd_err)?;
    let top_items_raw: Vec<Item> = if matches!(library.kind, LibraryKind::Movies) {
        db.list_top_items_by_library(library_id).map_err(cmd_err)?
    } else {
        Vec::new()
    };
    let item_ids: Vec<i64> = top_items_raw.iter().map(|i| i.id).collect();
    let progress = db.map_progress_for_items(&item_ids).map_err(cmd_err)?;
    let top_items: Vec<ItemWithProgress> = top_items_raw
        .into_iter()
        .map(|item| ItemWithProgress {
            progress: progress.get(&item.id).cloned(),
            item,
        })
        .collect();
    Ok(LibraryContents {
        library,
        groups,
        top_items,
    })
}

/// Group + immediate sub-groups + items (with progress) for a course/series
/// detail view.
#[tauri::command]
pub fn get_group(db: State<'_, Database>, group_id: i64) -> CmdResult<GroupDetail> {
    let group = db
        .get_group_by_id(group_id)
        .map_err(cmd_err)?
        .ok_or_else(|| format!("group {group_id} not found"))?;
    let subgroups = db.list_subgroups(group_id).map_err(cmd_err)?;
    let items_raw = db.list_items_by_group(group_id).map_err(cmd_err)?;
    let item_ids: Vec<i64> = items_raw.iter().map(|i| i.id).collect();
    let progress = db.map_progress_for_items(&item_ids).map_err(cmd_err)?;
    let items: Vec<ItemWithProgress> = items_raw
        .into_iter()
        .map(|item| ItemWithProgress {
            progress: progress.get(&item.id).cloned(),
            item,
        })
        .collect();
    Ok(GroupDetail {
        group,
        subgroups,
        items,
    })
}

/// Most recently watched in-progress items, newest first.
#[tauri::command]
pub fn get_continue_watching(
    db: State<'_, Database>,
    limit: u32,
) -> CmdResult<Vec<ItemWithProgress>> {
    db.get_continue_watching(limit).map_err(cmd_err)
}

/// First unwatched item in a group's tree, ordered by `(group.position,
/// item.position)`. Falls back to the first item if all completed.
#[tauri::command]
pub fn get_next_item(db: State<'_, Database>, group_id: i64) -> CmdResult<Option<Item>> {
    db.get_next_item(group_id).map_err(cmd_err)
}

/// Case-insensitive `LIKE` over group + item titles. Up to 20 of each.
#[tauri::command]
pub fn search(db: State<'_, Database>, query: String) -> CmdResult<SearchResults> {
    db.search(query.trim(), 20).map_err(cmd_err)
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
pub fn get_setting(db: State<'_, Database>, key: String) -> CmdResult<Option<String>> {
    db.get_setting(&key).map_err(cmd_err)
}

#[tauri::command]
pub fn set_setting(
    db: State<'_, Database>,
    key: String,
    value: String,
) -> CmdResult<()> {
    db.set_setting(&key, &value).map_err(cmd_err)
}

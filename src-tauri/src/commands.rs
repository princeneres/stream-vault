// CONTRACT: Tauri command surface area.
//
// Signatures are stable. Bodies are filled in by the specialist agents
// listed on each command. Errors crossing the Tauri boundary serialize as
// `Result<T, String>` (use `map_err(|e| e.to_string())` in implementations).
//
// Owner: Orchestrator. Specialists must NOT change a signature without
// flagging — the TS wrappers in `src/lib/api.ts` rely on these shapes.

use std::path::Path;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::Database;
use crate::models::{
    Group, GroupDetail, Item, ItemWithProgress, Library, LibraryContents,
    LibraryKind, ScanResult, SearchResults,
};
use crate::{scanner, thumbnails};

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
/// keyed by `file_path` keep their IDs and progress. Artwork generation
/// (ffprobe duration + ffmpeg thumbnails + group posters) runs in the
/// background after this command returns; the frontend gets a
/// `library-artwork` event for each library when work completes.
#[tauri::command]
pub fn scan_library(
    db: State<'_, Database>,
    app: AppHandle,
    library_id: i64,
) -> CmdResult<ScanResult> {
    let lib = db
        .get_library_by_id(library_id)
        .map_err(cmd_err)?
        .ok_or_else(|| format!("library {library_id} not found"))?;
    let result = scanner::scan(&lib, db.inner()).map_err(cmd_err)?;
    db.update_library_last_scanned(library_id, chrono::Utc::now())
        .map_err(cmd_err)?;

    let db_h = db.inner().clone();
    let app_h = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = generate_artwork(&db_h, &app_h, library_id) {
            log::warn!("artwork generation for library {library_id}: {e}");
        }
    });

    Ok(result)
}

/// ffprobe duration + ffmpeg thumbnail for items missing them, then group
/// posters. Best-effort: missing ffmpeg/ffprobe is logged at warn level for
/// the first failure (so the user sees it once) and at debug afterwards.
/// Emits a `library-artwork` event every 8 artworks landed so the UI can
/// repaint progressively for big libraries.
fn generate_artwork(db: &Database, app: &AppHandle, library_id: i64) -> Result<(), String> {
    const EMIT_EVERY: u32 = 8;

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let thumb_dir = data_dir.join("thumbnails");
    let poster_dir = data_dir.join("posters");

    let items = db.list_items_by_library(library_id).map_err(cmd_err)?;
    let mut emit = ArtworkEmitter::new(app, library_id, EMIT_EVERY);
    let mut warned_ffmpeg = false;
    let mut warned_ffprobe = false;

    for item in &items {
        let needs_duration = item.duration_seconds.is_none();
        let needs_thumb = item
            .thumbnail_path
            .as_deref()
            .map(|p| !Path::new(p).is_file())
            .unwrap_or(true);
        if !needs_duration && !needs_thumb {
            continue;
        }

        if needs_duration {
            match thumbnails::probe_duration(Path::new(&item.file_path)) {
                Ok(d) => {
                    let _ = db.update_item_duration(item.id, Some(d));
                }
                Err(e) => {
                    if !warned_ffprobe {
                        log::warn!("probe_duration item {}: {e}", item.id);
                        warned_ffprobe = true;
                    } else {
                        log::debug!("probe_duration item {}: {e}", item.id);
                    }
                }
            }
        }

        if needs_thumb {
            let fresh = match db.get_item_by_id(item.id) {
                Ok(Some(i)) => i,
                _ => continue,
            };
            match thumbnails::generate_thumbnail(&fresh, &thumb_dir) {
                Ok(path) => {
                    let p = path.to_string_lossy().to_string();
                    let _ = db.update_item_thumbnail(item.id, Some(&p));
                    emit.tick();
                }
                Err(e) => {
                    if !warned_ffmpeg {
                        log::warn!("thumbnail item {}: {e}", item.id);
                        warned_ffmpeg = true;
                    } else {
                        log::debug!("thumbnail item {}: {e}", item.id);
                    }
                }
            }
        }
    }

    let groups = db.list_groups_by_library(library_id).map_err(cmd_err)?;
    for group in &groups {
        let on_disk_ok = group
            .poster_path
            .as_deref()
            .map(|p| Path::new(p).is_file())
            .unwrap_or(false);
        if on_disk_ok {
            continue;
        }
        let group_items = db.list_items_by_group(group.id).map_err(cmd_err)?;
        match thumbnails::generate_poster(group, &group_items, &poster_dir) {
            Ok(path) => {
                let p = path.to_string_lossy().to_string();
                let _ = db.update_group_poster(group.id, Some(&p));
                emit.tick();
            }
            Err(e) => log::debug!("poster group {}: {e}", group.id),
        }
    }

    emit.flush();
    Ok(())
}

struct ArtworkEmitter<'a> {
    app: &'a AppHandle,
    library_id: i64,
    every: u32,
    pending: u32,
    total: u32,
}

impl<'a> ArtworkEmitter<'a> {
    fn new(app: &'a AppHandle, library_id: i64, every: u32) -> Self {
        Self {
            app,
            library_id,
            every,
            pending: 0,
            total: 0,
        }
    }
    fn tick(&mut self) {
        self.pending += 1;
        self.total += 1;
        if self.pending >= self.every {
            self.emit();
        }
    }
    fn flush(&mut self) {
        if self.total > 0 {
            self.emit();
        }
    }
    fn emit(&mut self) {
        self.pending = 0;
        let _ = self.app.emit(
            "library-artwork",
            serde_json::json!({ "libraryId": self.library_id }),
        );
    }
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
    db: State<'_, Database>,
    state: State<'_, std::sync::Arc<crate::mpv::PlaybackState>>,
    app: AppHandle,
    item_id: i64,
) -> CmdResult<()> {
    let item = db
        .get_item_by_id(item_id)
        .map_err(cmd_err)?
        .ok_or_else(|| format!("item {item_id} not found"))?;
    let resume_seconds = db
        .get_progress_by_item(item_id)
        .map_err(cmd_err)?
        .map(|p| p.position_seconds)
        .unwrap_or(0.0);

    let db_handle = db.inner().clone();
    let state_handle = state.inner().clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            crate::mpv::play(item, resume_seconds, app_handle, db_handle, state_handle).await
        {
            log::error!("playback failed: {e}");
        }
    });
    Ok(())
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

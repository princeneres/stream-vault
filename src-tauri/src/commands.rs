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
    LibraryKind, Note, ProgressUpdate, ScanResult, SearchResults,
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
    app: AppHandle,
    name: String,
    root_path: String,
    kind: LibraryKind,
) -> CmdResult<Library> {
    let mut lib = db
        .insert_library(&name, &root_path, kind)
        .map_err(cmd_err)?;
    lib.available = Path::new(&lib.root_path).is_dir();
    if let Err(e) = app.asset_protocol_scope().allow_directory(&lib.root_path, true) {
        log::warn!(
            "asset scope allow library {:?} failed: {e}",
            lib.root_path
        );
    }
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
    spawn_play(&db, &state, &app, item_id, None)
}

/// Play `item_id` starting at an explicit offset (seconds). Used by
/// click-to-seek from notes when the target item is not the currently active
/// session — bypasses the saved-progress resume.
#[tauri::command]
pub fn play_item_at(
    db: State<'_, Database>,
    state: State<'_, std::sync::Arc<crate::mpv::PlaybackState>>,
    app: AppHandle,
    item_id: i64,
    start_seconds: f64,
) -> CmdResult<()> {
    spawn_play(&db, &state, &app, item_id, Some(start_seconds.max(0.0)))
}

fn spawn_play(
    db: &State<'_, Database>,
    state: &State<'_, std::sync::Arc<crate::mpv::PlaybackState>>,
    app: &AppHandle,
    item_id: i64,
    start_override: Option<f64>,
) -> CmdResult<()> {
    let item = db
        .get_item_by_id(item_id)
        .map_err(cmd_err)?
        .ok_or_else(|| format!("item {item_id} not found"))?;
    let resume_seconds = match start_override {
        Some(s) => s,
        None => db
            .get_progress_by_item(item_id)
            .map_err(cmd_err)?
            .map(|p| p.position_seconds)
            .unwrap_or(0.0),
    };

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

// ---- Progress toggles (Backend Engineer) ----------------------------------

/// Mark a single item as watched / unwatched. Watched sets progress to its
/// duration (or `1.0` if unknown) with `completed = 1`; unwatched clears
/// the progress row. Emits `item-progress` so all open views refresh.
#[tauri::command]
pub fn set_item_completed(
    db: State<'_, Database>,
    app: AppHandle,
    item_id: i64,
    completed: bool,
) -> CmdResult<()> {
    let item = db
        .get_item_by_id(item_id)
        .map_err(cmd_err)?
        .ok_or_else(|| format!("item {item_id} not found"))?;
    let duration = item.duration_seconds.unwrap_or(0.0);
    apply_completed(&db, item_id, completed, duration).map_err(cmd_err)?;
    let _ = app.emit(
        "item-progress",
        ProgressUpdate {
            item_id,
            position_seconds: if completed { duration } else { 0.0 },
            duration_seconds: duration,
        },
    );
    Ok(())
}

/// Cascade a watched / unwatched toggle to every leaf item in `group_id`'s
/// subtree. Emits a single `item-progress` event so the UI refreshes.
#[tauri::command]
pub fn set_group_completed(
    db: State<'_, Database>,
    app: AppHandle,
    group_id: i64,
    completed: bool,
) -> CmdResult<()> {
    let leaves = db
        .list_item_ids_in_group_subtree(group_id)
        .map_err(cmd_err)?;
    for (id, dur) in &leaves {
        apply_completed(&db, *id, completed, dur.unwrap_or(0.0)).map_err(cmd_err)?;
    }
    if let Some((id, dur)) = leaves.first() {
        let _ = app.emit(
            "item-progress",
            ProgressUpdate {
                item_id: *id,
                position_seconds: if completed { dur.unwrap_or(0.0) } else { 0.0 },
                duration_seconds: dur.unwrap_or(0.0),
            },
        );
    }
    Ok(())
}

fn apply_completed(
    db: &Database,
    item_id: i64,
    completed: bool,
    duration: f64,
) -> Result<(), anyhow::Error> {
    if completed {
        let pos = if duration > 0.0 { duration } else { 1.0 };
        db.upsert_progress(item_id, pos, true)
    } else {
        db.delete_progress(item_id)
    }
}

// ---- Artwork (Backend Engineer) -------------------------------------------

/// Replace a group's poster with a user-supplied image. Copies the source
/// file into the app's `posters/` data dir under a stable, unique filename
/// (so the asset protocol can serve it after the source is moved/deleted)
/// and persists the new path on the group row. Returns the new poster path.
#[tauri::command]
pub fn set_group_poster(
    db: State<'_, Database>,
    app: AppHandle,
    group_id: i64,
    source_path: String,
) -> CmdResult<String> {
    let src = std::path::PathBuf::from(&source_path);
    if !src.is_file() {
        return Err(format!("source image not found: {source_path}"));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_ascii_lowercase();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let poster_dir = data_dir.join("posters");
    std::fs::create_dir_all(&poster_dir).map_err(cmd_err)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = poster_dir.join(format!("group-{group_id}-{stamp}.{ext}"));
    std::fs::copy(&src, &dest).map_err(cmd_err)?;
    let dest_str = dest.to_string_lossy().to_string();
    db.update_group_poster(group_id, Some(&dest_str)).map_err(cmd_err)?;
    Ok(dest_str)
}

/// Re-run thumbnail / poster generation for a library. Only items missing
/// a usable thumbnail file on disk are processed (same logic as the post-
/// scan pass), so this is a safe retry button after installing ffmpeg or
/// fixing permissions.
#[tauri::command]
pub fn regenerate_library_artwork(
    db: State<'_, Database>,
    app: AppHandle,
    library_id: i64,
) -> CmdResult<()> {
    let db_h = db.inner().clone();
    let app_h = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = generate_artwork(&db_h, &app_h, library_id) {
            log::warn!("artwork regen for library {library_id}: {e}");
        }
    });
    Ok(())
}

// ---- Notes (Backend Engineer) ---------------------------------------------

/// Insert a timestamped note for an item. Emits `note-saved` so views refresh.
#[tauri::command]
pub fn add_note(
    db: State<'_, Database>,
    app: AppHandle,
    item_id: i64,
    timestamp_sec: f64,
    content: String,
) -> CmdResult<Note> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("note content cannot be empty".into());
    }
    let note = db.insert_note(item_id, timestamp_sec.max(0.0), trimmed).map_err(cmd_err)?;
    publish_note_op(&db, &app, crate::vault::VaultOp::Upsert(note.clone()));
    emit_note_saved(&app, "added", item_id, Some(note.id));
    Ok(note)
}

/// Replace an existing note's content. Timestamp is immutable.
#[tauri::command]
pub fn update_note(
    db: State<'_, Database>,
    app: AppHandle,
    note_id: i64,
    content: String,
) -> CmdResult<Note> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("note content cannot be empty".into());
    }
    let note = db.update_note(note_id, trimmed).map_err(cmd_err)?;
    publish_note_op(&db, &app, crate::vault::VaultOp::Upsert(note.clone()));
    emit_note_saved(&app, "updated", note.item_id, Some(note.id));
    Ok(note)
}

#[tauri::command]
pub fn delete_note(
    db: State<'_, Database>,
    app: AppHandle,
    note_id: i64,
) -> CmdResult<()> {
    let item_id_before = db
        .with_conn(|c| {
            Ok(c.query_row(
                "SELECT item_id FROM notes WHERE id = ?",
                [note_id],
                |r| r.get::<_, i64>(0),
            )
            .ok())
        })
        .map_err(cmd_err)?
        .unwrap_or(-1);
    db.delete_note(note_id).map_err(cmd_err)?;
    if item_id_before > 0 {
        publish_note_op(
            &db,
            &app,
            crate::vault::VaultOp::Delete {
                item_id: item_id_before,
                note_id,
            },
        );
    }
    emit_note_saved(&app, "deleted", item_id_before, Some(note_id));
    Ok(())
}

/// Re-publish every notes-bearing item into the configured Obsidian vault.
/// Used after the user changes the vault path. Returns the number of items
/// re-emitted.
#[tauri::command]
pub fn republish_vault(db: State<'_, Database>, app: AppHandle) -> CmdResult<u32> {
    let result = crate::vault::republish_all(db.inner()).map_err(cmd_err)?;
    let _ = app.emit(
        "vault-republished",
        serde_json::json!({ "count": result }),
    );
    Ok(result)
}

/// Best-effort vault publish. Logs warnings + emits a `vault-publish-failed`
/// event on error; never blocks the DB-side success path.
fn publish_note_op(db: &Database, app: &AppHandle, op: crate::vault::VaultOp) {
    if let Err(e) = crate::vault::publish(db, op) {
        log::warn!("vault publish failed: {e}");
        let _ = app.emit(
            "vault-publish-failed",
            serde_json::json!({ "error": e.to_string() }),
        );
    }
}

#[tauri::command]
pub fn list_notes_for_item(
    db: State<'_, Database>,
    item_id: i64,
) -> CmdResult<Vec<Note>> {
    db.list_notes_for_item(item_id).map_err(cmd_err)
}

#[tauri::command]
pub fn count_notes_for_items(
    db: State<'_, Database>,
    item_ids: Vec<i64>,
) -> CmdResult<std::collections::HashMap<i64, i64>> {
    db.count_notes_for_items(&item_ids).map_err(cmd_err)
}

fn emit_note_saved(app: &AppHandle, kind: &str, item_id: i64, note_id: Option<i64>) {
    let _ = app.emit(
        "note-saved",
        serde_json::json!({ "kind": kind, "itemId": item_id, "noteId": note_id }),
    );
}

// ---- mpv IPC (Player Engineer) --------------------------------------------

/// Live `time-pos` from the active mpv session, or `None` if no session.
#[tauri::command]
pub async fn mpv_get_position(
    state: State<'_, std::sync::Arc<crate::mpv::PlaybackState>>,
) -> CmdResult<Option<f64>> {
    crate::mpv::ipc_get_position(state.inner())
        .await
        .map_err(cmd_err)
}

/// Pause/resume the active session. No-op when nothing is playing.
#[tauri::command]
pub async fn mpv_set_paused(
    state: State<'_, std::sync::Arc<crate::mpv::PlaybackState>>,
    paused: bool,
) -> CmdResult<()> {
    crate::mpv::ipc_set_paused(state.inner(), paused)
        .await
        .map_err(cmd_err)
}

/// Absolute seek (seconds). No-op when nothing is playing.
#[tauri::command]
pub async fn mpv_seek(
    state: State<'_, std::sync::Arc<crate::mpv::PlaybackState>>,
    seconds: f64,
) -> CmdResult<()> {
    crate::mpv::ipc_seek(state.inner(), seconds)
        .await
        .map_err(cmd_err)
}

/// `Some(item_id)` when a session is active, else `None`. Lets the frontend
/// decide between in-place seek vs. starting playback at a timestamp.
#[tauri::command]
pub async fn mpv_current_item_id(
    state: State<'_, std::sync::Arc<crate::mpv::PlaybackState>>,
) -> CmdResult<Option<i64>> {
    Ok(crate::mpv::current_item_id(state.inner()).await)
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

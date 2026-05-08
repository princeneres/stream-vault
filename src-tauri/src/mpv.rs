// mpv playback orchestration.
//
// Spawns the external `mpv` binary with a unique JSON IPC socket, polls
// `time-pos` and `duration` every 3s, persists progress, and emits an
// `item-progress` Tauri event. A new `play()` kills the previous mpv
// instance (if any).
//
// Linux-only in MVP — the Unix socket path is `/tmp/streamvault-...sock`.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::db::Database;
use crate::models::{Item, ProgressUpdate};

#[cfg(target_os = "linux")]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(target_os = "linux")]
use tokio::net::UnixStream;
#[cfg(target_os = "linux")]
use tokio::process::Command;

/// Tauri-managed playback state. Holds the in-flight session, if any.
pub struct PlaybackState {
    pub inner: Mutex<Option<Session>>,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self { inner: Mutex::new(None) }
    }
}

pub struct Session {
    pub item_id: i64,
    #[cfg(target_os = "linux")]
    pub child: tokio::process::Child,
    pub task: tokio::task::JoinHandle<()>,
    pub socket_path: PathBuf,
}

#[cfg(target_os = "linux")]
pub async fn play(
    item: Item,
    resume_seconds: f64,
    app_handle: AppHandle,
    db: Database,
    state: Arc<PlaybackState>,
) -> Result<()> {
    kill_previous(&state).await;

    let socket_path = make_socket_path(item.id);
    let mut cmd = Command::new("mpv");
    cmd.arg(format!("--input-ipc-server={}", socket_path.display()))
        .arg(format!("--start={}", resume_seconds))
        .arg("--save-position-on-quit=no")
        .arg("--force-window=yes")
        .arg(&item.file_path)
        .kill_on_drop(true);

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(anyhow!(
                "mpv is not installed or not on PATH. Install it from https://mpv.io"
            ));
        }
        Err(e) => return Err(anyhow!("failed to spawn mpv: {e}")),
    };

    let item_id = item.id;
    let group_id = item.group_id;
    let task_app = app_handle.clone();
    let task_db = db.clone();
    let task_state = state.clone();
    let task_socket = socket_path.clone();

    let task = tokio::spawn(async move {
        progress_loop(task_socket, item_id, group_id, task_app, task_db, task_state).await;
    });

    let mut guard = state.inner.lock().await;
    *guard = Some(Session {
        item_id,
        child,
        task,
        socket_path,
    });
    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub async fn play(
    _item: Item,
    _resume_seconds: f64,
    _app_handle: AppHandle,
    _db: Database,
    _state: Arc<PlaybackState>,
) -> Result<()> {
    Err(anyhow!(
        "Stream Vault playback currently supports Linux only — see mpv.rs"
    ))
}

#[cfg(target_os = "linux")]
async fn kill_previous(state: &PlaybackState) {
    let mut guard = state.inner.lock().await;
    if let Some(mut prev) = guard.take() {
        prev.task.abort();
        let _ = prev.child.kill().await;
        let _ = std::fs::remove_file(&prev.socket_path);
    }
}

#[cfg(not(target_os = "linux"))]
async fn kill_previous(_state: &PlaybackState) {}

fn make_socket_path(item_id: i64) -> PathBuf {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    PathBuf::from(format!("/tmp/streamvault-{item_id}-{ts}.sock"))
}

#[cfg(target_os = "linux")]
async fn progress_loop(
    socket_path: PathBuf,
    item_id: i64,
    group_id: Option<i64>,
    app: AppHandle,
    db: Database,
    state: Arc<PlaybackState>,
) {
    let stream = match wait_for_socket(&socket_path).await {
        Some(s) => s,
        None => {
            log::warn!("mpv ipc socket never appeared at {}", socket_path.display());
            return;
        }
    };
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);

    let mut request_id: u64 = 0;
    let mut last_position = 0f64;
    let mut last_duration = 0f64;

    loop {
        request_id += 1;
        let pos_id = request_id;
        request_id += 1;
        let dur_id = request_id;

        let req_pos = format!(
            "{{\"command\":[\"get_property\",\"time-pos\"],\"request_id\":{pos_id}}}\n"
        );
        let req_dur = format!(
            "{{\"command\":[\"get_property\",\"duration\"],\"request_id\":{dur_id}}}\n"
        );
        if write.write_all(req_pos.as_bytes()).await.is_err() {
            break;
        }
        if write.write_all(req_dur.as_bytes()).await.is_err() {
            break;
        }

        // Drain incoming lines until we've seen both responses or timed out.
        let mut got_pos = false;
        let mut got_dur = false;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(800);
        while !(got_pos && got_dur) {
            let mut line = String::new();
            tokio::select! {
                res = reader.read_line(&mut line) => {
                    match res {
                        Ok(0) => {
                            // EOF — mpv exited
                            save_and_emit(&db, &app, item_id, last_position, last_duration);
                            maybe_auto_advance(
                                &db, &app, &state, item_id, group_id, last_position, last_duration,
                            );
                            return;
                        }
                        Ok(_) => {
                            if let Some((id, val)) = parse_property_response(&line) {
                                if id == pos_id {
                                    last_position = val;
                                    got_pos = true;
                                } else if id == dur_id {
                                    last_duration = val;
                                    got_dur = true;
                                }
                            }
                        }
                        Err(_) => {
                            save_and_emit(&db, &app, item_id, last_position, last_duration);
                            maybe_auto_advance(
                                &db, &app, &state, item_id, group_id, last_position, last_duration,
                            );
                            return;
                        }
                    }
                }
                _ = tokio::time::sleep_until(deadline) => break,
            }
        }

        save_and_emit(&db, &app, item_id, last_position, last_duration);
        tokio::time::sleep(Duration::from_secs(3)).await;
    }

    save_and_emit(&db, &app, item_id, last_position, last_duration);
    maybe_auto_advance(&db, &app, &state, item_id, group_id, last_position, last_duration);
}

/// If the just-finished item is completed, the user opted in to auto-advance,
/// and a next item exists in the same group, spawn a fresh `play()` for it.
/// Movies (group_id = None) and one-off generic items never auto-advance.
#[cfg(target_os = "linux")]
fn maybe_auto_advance(
    db: &Database,
    app: &AppHandle,
    state: &Arc<PlaybackState>,
    item_id: i64,
    group_id: Option<i64>,
    position_seconds: f64,
    duration_seconds: f64,
) {
    if !is_completed(position_seconds, duration_seconds) {
        return;
    }
    let Some(group_id) = group_id else { return };
    if !auto_advance_enabled(db) {
        return;
    }
    let next = match db.get_next_item(group_id) {
        Ok(Some(n)) if n.id != item_id => n,
        Ok(_) => return,
        Err(e) => {
            log::warn!("get_next_item failed during auto-advance: {e}");
            return;
        }
    };

    let app = app.clone();
    let db = db.clone();
    let state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = play(next, 0.0, app, db, state).await {
            log::warn!("auto-advance play failed: {e}");
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn maybe_auto_advance(
    _db: &Database,
    _app: &AppHandle,
    _state: &Arc<PlaybackState>,
    _item_id: i64,
    _group_id: Option<i64>,
    _position_seconds: f64,
    _duration_seconds: f64,
) {
}

pub(crate) fn auto_advance_enabled(db: &Database) -> bool {
    matches!(
        db.get_setting("auto_advance").ok().flatten().as_deref(),
        Some("true"),
    )
}

#[cfg(target_os = "linux")]
async fn wait_for_socket(socket_path: &PathBuf) -> Option<UnixStream> {
    let mut tries = 0;
    loop {
        match UnixStream::connect(socket_path).await {
            Ok(s) => return Some(s),
            Err(_) if tries < 60 => {
                tries += 1;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(_) => return None,
        }
    }
}

fn save_and_emit(
    db: &Database,
    app: &AppHandle,
    item_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) {
    let completed = is_completed(position_seconds, duration_seconds);
    if let Err(e) = db.upsert_progress(item_id, position_seconds, completed) {
        log::warn!("upsert_progress failed: {e}");
    }
    let payload = ProgressUpdate {
        item_id,
        position_seconds,
        duration_seconds,
    };
    if let Err(e) = app.emit("item-progress", payload) {
        log::warn!("emit item-progress failed: {e}");
    }
}

/// `>= 90% of duration` and `duration > 0`.
pub(crate) fn is_completed(position_seconds: f64, duration_seconds: f64) -> bool {
    duration_seconds > 0.0 && position_seconds >= 0.9 * duration_seconds
}

/// Extract `(request_id, data)` from a single mpv IPC response line.
/// `data` must be a number; non-number `data` (mpv may return null while
/// loading) and lines that aren't numeric responses (events) are filtered out.
pub(crate) fn parse_property_response(line: &str) -> Option<(u64, f64)> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let id = v.get("request_id")?.as_u64()?;
    let data = v.get("data")?.as_f64()?;
    Some((id, data))
}

// ---- Ad-hoc IPC commands (note capture, click-to-seek) -------------------
//
// The polling loop in `progress_loop` owns a long-lived connection to the mpv
// socket. mpv's JSON IPC is per-connection (request_id routing is per-fd), so
// ad-hoc commands open a second short-lived connection rather than sharing
// the loop's read/write halves. Avoids the actor refactor and stays
// backward-compatible with the existing flow.

/// Snapshot of the active session's socket path, if any.
pub async fn current_socket_path(state: &PlaybackState) -> Option<PathBuf> {
    let guard = state.inner.lock().await;
    guard.as_ref().map(|s| s.socket_path.clone())
}

/// Active session's item id, if any.
pub async fn current_item_id(state: &PlaybackState) -> Option<i64> {
    let guard = state.inner.lock().await;
    guard.as_ref().map(|s| s.item_id)
}

/// Live `time-pos` from mpv. `Ok(None)` when no session is active.
#[cfg(target_os = "linux")]
pub async fn ipc_get_position(state: &PlaybackState) -> Result<Option<f64>> {
    let Some(socket) = current_socket_path(state).await else {
        return Ok(None);
    };
    let req = serde_json::json!({"command": ["get_property", "time-pos"], "request_id": 9001});
    let resp = ipc_request(&socket, req, 9001).await?;
    Ok(resp)
}

#[cfg(not(target_os = "linux"))]
pub async fn ipc_get_position(_state: &PlaybackState) -> Result<Option<f64>> {
    Ok(None)
}

/// Pause/resume the active session. No-op if no session.
#[cfg(target_os = "linux")]
pub async fn ipc_set_paused(state: &PlaybackState, paused: bool) -> Result<()> {
    let Some(socket) = current_socket_path(state).await else {
        return Ok(());
    };
    let req = serde_json::json!({
        "command": ["set_property", "pause", paused],
        "request_id": 9002,
    });
    ipc_fire(&socket, req).await
}

#[cfg(not(target_os = "linux"))]
pub async fn ipc_set_paused(_state: &PlaybackState, _paused: bool) -> Result<()> {
    Ok(())
}

/// Absolute seek (seconds). No-op if no session.
#[cfg(target_os = "linux")]
pub async fn ipc_seek(state: &PlaybackState, seconds: f64) -> Result<()> {
    let Some(socket) = current_socket_path(state).await else {
        return Ok(());
    };
    let req = serde_json::json!({
        "command": ["seek", seconds, "absolute"],
        "request_id": 9003,
    });
    ipc_fire(&socket, req).await
}

#[cfg(not(target_os = "linux"))]
pub async fn ipc_seek(_state: &PlaybackState, _seconds: f64) -> Result<()> {
    Ok(())
}

/// Issue a `get_property`-style request, returning the matching numeric
/// `data`. Drains lines for up to 800ms.
#[cfg(target_os = "linux")]
async fn ipc_request(
    socket: &std::path::Path,
    body: Value,
    expected_id: u64,
) -> Result<Option<f64>> {
    let stream = UnixStream::connect(socket)
        .await
        .map_err(|e| anyhow!("connect mpv socket: {e}"))?;
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);
    let line = format!("{}\n", body);
    write
        .write_all(line.as_bytes())
        .await
        .map_err(|e| anyhow!("write mpv ipc: {e}"))?;

    let deadline = tokio::time::Instant::now() + Duration::from_millis(800);
    loop {
        let mut buf = String::new();
        tokio::select! {
            res = reader.read_line(&mut buf) => {
                match res {
                    Ok(0) => return Ok(None),
                    Ok(_) => {
                        if let Some((id, val)) = parse_property_response(&buf) {
                            if id == expected_id {
                                return Ok(Some(val));
                            }
                        }
                    }
                    Err(e) => return Err(anyhow!("read mpv ipc: {e}")),
                }
            }
            _ = tokio::time::sleep_until(deadline) => return Ok(None),
        }
    }
}

/// Fire-and-forget command; ignores any reply.
#[cfg(target_os = "linux")]
async fn ipc_fire(socket: &std::path::Path, body: Value) -> Result<()> {
    let stream = UnixStream::connect(socket)
        .await
        .map_err(|e| anyhow!("connect mpv socket: {e}"))?;
    let (_read, mut write) = stream.into_split();
    let line = format!("{}\n", body);
    write
        .write_all(line.as_bytes())
        .await
        .map_err(|e| anyhow!("write mpv ipc: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_completed_threshold() {
        assert!(!is_completed(0.0, 100.0));
        assert!(!is_completed(80.0, 100.0));
        assert!(is_completed(90.0, 100.0));
        assert!(is_completed(95.0, 100.0));
        assert!(!is_completed(50.0, 0.0));
    }

    #[test]
    fn parse_response_extracts_id_and_value() {
        let line =
            r#"{"data": 12.5, "request_id": 7, "error": "success"}"#;
        assert_eq!(parse_property_response(line), Some((7, 12.5)));
    }

    #[test]
    fn parse_response_handles_integer_data() {
        let line = r#"{"data": 100, "request_id": 3, "error": "success"}"#;
        assert_eq!(parse_property_response(line), Some((3, 100.0)));
    }

    #[test]
    fn parse_response_rejects_events() {
        let line = r#"{"event": "playback-restart"}"#;
        assert_eq!(parse_property_response(line), None);
    }

    #[test]
    fn parse_response_rejects_null_data() {
        let line = r#"{"data": null, "request_id": 1, "error": "property unavailable"}"#;
        assert_eq!(parse_property_response(line), None);
    }

    #[test]
    fn auto_advance_setting_only_true_string_enables() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(&dir.path().join("t.db")).unwrap();
        assert!(!auto_advance_enabled(&db));
        db.set_setting("auto_advance", "false").unwrap();
        assert!(!auto_advance_enabled(&db));
        db.set_setting("auto_advance", "true").unwrap();
        assert!(auto_advance_enabled(&db));
        db.set_setting("auto_advance", "1").unwrap();
        assert!(!auto_advance_enabled(&db));
    }
}

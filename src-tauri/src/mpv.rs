// TODO(player-eng): mpv spawn + JSON IPC progress polling.
//
// Public API:
//   pub async fn play(item: Item, resume_seconds: f64, app_handle: AppHandle, db: Database) -> Result<()>
//
// - Unique socket /tmp/streamvault-{item_id}-{ts}.sock (Linux MVP).
// - Spawn `mpv --input-ipc-server=<sock> --start=<resume> --save-position-on-quit=no --force-window=yes <file>`.
// - Kill prior mpv child if any (state-tracked).
// - Tokio task: every 3s `get_property time-pos` + `duration` via socket → write
//   progress to DB; emit `item-progress` event. Mark completed at >= 90%.
// - On exit: final save + last event.
// - mpv missing => map ErrorKind::NotFound to a clear user-facing string.
//
// See plan, Agent D.

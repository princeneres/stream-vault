pub mod commands;
pub mod db;
pub mod models;
pub mod mpv;
pub mod scanner;
pub mod thumbnails;

use tauri::Manager;

use crate::db::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::try_init().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir resolves on supported platforms");
            let db_path = data_dir.join("streamvault.db");
            let db = Database::new(&db_path)
                .expect("failed to open/migrate streamvault.db");

            // Asset protocol scope. The static `assetProtocol.scope` glob in
            // tauri.conf.json doesn't match absolute paths under `glob` with
            // `require_literal_separator: true`, so register paths
            // programmatically: our own data dir (thumbnails + posters) plus
            // every library root that already exists in the DB. New
            // libraries extend the scope from `commands::add_library`.
            let asset_scope = app.asset_protocol_scope();
            if let Err(e) = asset_scope.allow_directory(&data_dir, true) {
                log::warn!("asset scope allow data_dir failed: {e}");
            }
            if let Ok(libs) = db.list_libraries_raw() {
                for lib in libs {
                    if let Err(e) = asset_scope.allow_directory(&lib.root_path, true) {
                        log::warn!(
                            "asset scope allow library {:?} failed: {e}",
                            lib.root_path
                        );
                    }
                }
            }

            app.manage(db);
            app.manage(std::sync::Arc::new(crate::mpv::PlaybackState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_libraries,
            commands::add_library,
            commands::remove_library,
            commands::scan_library,
            commands::get_library_contents,
            commands::get_group,
            commands::get_continue_watching,
            commands::get_next_item,
            commands::search,
            commands::play_item,
            commands::set_item_completed,
            commands::set_group_completed,
            commands::set_group_poster,
            commands::regenerate_library_artwork,
            commands::get_setting,
            commands::set_setting,
            commands::play_item_at,
            commands::add_note,
            commands::update_note,
            commands::delete_note,
            commands::list_notes_for_item,
            commands::count_notes_for_items,
            commands::mpv_get_position,
            commands::mpv_set_paused,
            commands::mpv_seek,
            commands::mpv_current_item_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

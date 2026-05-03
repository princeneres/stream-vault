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
            app.manage(db);
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
            commands::get_setting,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

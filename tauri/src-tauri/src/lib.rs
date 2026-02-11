mod api;
mod flow;
mod commands;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            login_account,
            get_local_flows,
            get_cloud_flows,
            migrate_flows,
            delete_local_flows,
            delete_cloud_flows,
            save_config,
            load_config,
            check_for_update,
            download_update,
            open_file_and_exit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


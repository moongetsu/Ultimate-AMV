use std::{fs, path::Path};

use serde::Serialize;
use serde_json::json;
use tauri::Manager;

use crate::{log_error, log_info, run_audio_cli};

#[derive(Serialize)]
pub(crate) struct ClearCacheReport {
    pub files_removed: u64,
    pub bytes_freed: u64,
}

pub(crate) fn dir_file_stats(dir: &Path) -> (u64, u64) {
    let mut files: u64 = 0;
    let mut bytes: u64 = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    let (sub_files, sub_bytes) = dir_file_stats(&path);
                    files += sub_files;
                    bytes += sub_bytes;
                } else {
                    files += 1;
                    bytes += meta.len();
                }
            }
        }
    }
    (files, bytes)
}

#[tauri::command]
pub(crate) async fn clear_app_cache(window: tauri::Window) -> Result<ClearCacheReport, String> {
    let app_data_dir = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    log_info(
        "cache.clear.start",
        "Clearing app caches",
        json!({ "app_data_dir": app_data_dir.display().to_string() }),
    );

    let report = tauri::async_runtime::spawn_blocking(move || -> Result<ClearCacheReport, String> {
        // All three are regenerated on demand, so wiping them is safe.
        // Don't touch `backgrounds/`, `logs/`, `*.json`, or the WebView2
        // browser data — those are user data, not cache.
        const CACHE_DIRS: &[&str] = &["clip_previews", "scene_clips", "clip_compat_cache"];

        let mut total_files = 0u64;
        let mut total_bytes = 0u64;
        let mut first_error: Option<String> = None;

        for name in CACHE_DIRS {
            let dir = app_data_dir.join(name);
            if !dir.exists() {
                continue;
            }
            let (files, bytes) = dir_file_stats(&dir);
            match fs::remove_dir_all(&dir) {
                Ok(()) => {
                    total_files += files;
                    total_bytes += bytes;
                }
                Err(error) => {
                    let msg = format!("Could not remove {name}: {error}");
                    log_error("cache.clear.dir_error", &msg, json!({ "dir": name }));
                    if first_error.is_none() {
                        first_error = Some(msg);
                    }
                }
            }
        }

        if let Some(error) = first_error {
            return Err(error);
        }
        Ok(ClearCacheReport {
            files_removed: total_files,
            bytes_freed: total_bytes,
        })
    })
    .await
    .map_err(|error| error.to_string())??;

    log_info(
        "cache.clear.complete",
        "App caches cleared",
        json!({
            "files_removed": report.files_removed,
            "bytes_freed": report.bytes_freed,
        }),
    );

    Ok(report)
}

#[tauri::command]
pub(crate) async fn get_config() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_audio_cli(&["config"]))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn set_config(key: String, value: String) -> Result<String, String> {
    log_info(
        "config.set.start",
        "Updating app configuration",
        json!({ "key": &key, "value": &value }),
    );
    let log_key = key.clone();
    let result = tauri::async_runtime::spawn_blocking(move || run_audio_cli(&["set-config", &key, &value]))
        .await
        .map_err(|error| error.to_string())?;
    match &result {
        Ok(_) => log_info("config.set.complete", "App configuration updated", json!({ "key": log_key })),
        Err(error) => log_error("config.set.error", "App configuration update failed", json!({ "key": log_key, "error": error })),
    }
    result
}

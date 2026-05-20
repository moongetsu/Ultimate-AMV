use std::{fs, path::{Path, PathBuf}};

use serde_json::{json, Value};
use tauri::Manager;

use crate::log_info;

fn background_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?
        .join("backgrounds");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Could not create backgrounds directory: {error}"))?;
    }
    Ok(dir)
}

fn purge_background_files(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("bg_") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn save_background_image(
    app: tauri::AppHandle,
    source: String,
) -> Result<String, String> {
    let dir = background_dir(&app)?;
    let source_path = PathBuf::from(&source);
    if !source_path.is_file() {
        return Err(format!("Image not found: {source}"));
    }
    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("img")
        .to_lowercase();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = dir.join(format!("bg_{stamp}.{extension}"));

    let target_for_blocking = target.clone();
    let dir_for_blocking = dir.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        purge_background_files(&dir_for_blocking);
        fs::copy(&source_path, &target_for_blocking)
            .map_err(|error| format!("Could not copy background image: {error}"))?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;

    log_info(
        "background.image.saved",
        "Background image saved",
        json!({ "path": target.display().to_string() }),
    );
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) async fn clear_background_image(app: tauri::AppHandle) -> Result<(), String> {
    let dir = background_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        purge_background_files(&dir);
    })
    .await
    .map_err(|error| error.to_string())?;
    log_info("background.image.cleared", "Background image cleared", Value::Null);
    Ok(())
}

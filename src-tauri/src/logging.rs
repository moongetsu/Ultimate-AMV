use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};

use chrono::Local;
use serde_json::Value;

pub(crate) fn truncate_log_text(value: impl AsRef<str>) -> String {
    const MAX_LEN: usize = 12 * 1024;
    let value = value.as_ref();
    if value.len() <= MAX_LEN {
        return value.to_string();
    }
    let keep_from = value.len().saturating_sub(MAX_LEN);
    format!("[truncated]\n{}", &value[keep_from..])
}

pub(crate) fn app_state_dir() -> PathBuf {
    if let Ok(path) = std::env::var("ULTIMATE_AMV_STATE_DIR") {
        return PathBuf::from(path);
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(path) = std::env::var("APPDATA") {
            return PathBuf::from(path).join("com.elishapervez.ultimateamv");
        }
        if let Ok(path) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(path).join("com.elishapervez.ultimateamv");
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(path) = std::env::var("XDG_DATA_HOME") {
            return PathBuf::from(path).join("ultimate-amv");
        }
        if let Ok(path) = std::env::var("HOME") {
            return PathBuf::from(path).join(".local").join("share").join("ultimate-amv");
        }
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".ultimate-amv-state")
}

pub(crate) fn append_app_log(level: &str, event: &str, message: &str, details: Value) {
    let path = app_state_dir().join("logs").join("ultimate-amv.log");
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let created_at = Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z");
    let detail_text = if details.is_null() {
        String::new()
    } else {
        format!(
            "\n    details: {}",
            truncate_log_text(serde_json::to_string(&details).unwrap_or_else(|_| "{}".to_string()))
        )
    };
    let line = format!(
        "[{created_at}] [{}] {event}: {}{detail_text}\n",
        level.to_ascii_uppercase(),
        truncate_log_text(message)
    );

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

pub(crate) fn reset_app_logs() {
    let state_dir = app_state_dir();
    let text_path = state_dir.join("logs").join("ultimate-amv.log");
    if let Some(parent) = text_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(text_path);
    let _ = fs::create_dir_all(&state_dir);
    let _ = fs::write(state_dir.join("app_logs.json"), "[]\n");
}

pub(crate) fn log_info(event: &str, message: &str, details: Value) {
    append_app_log("info", event, message, details);
}

pub(crate) fn log_warn(event: &str, message: &str, details: Value) {
    append_app_log("warn", event, message, details);
}

pub(crate) fn log_error(event: &str, message: &str, details: Value) {
    append_app_log("error", event, message, details);
}

#[tauri::command]
pub(crate) async fn app_logs() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::run_audio_cli(&["logs"]))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn clear_app_logs() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(reset_app_logs)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn frontend_log(
    level: String,
    event: String,
    message: String,
    details: Option<Value>,
) -> Result<(), String> {
    let level = match level.as_str() {
        "debug" | "info" | "warn" | "error" => level,
        _ => "info".to_string(),
    };
    append_app_log(&level, &event, &message, details.unwrap_or(Value::Null));
    Ok(())
}

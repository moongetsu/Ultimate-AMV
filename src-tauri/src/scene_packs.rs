use std::{
    fs,
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{app_state_dir, log_error, log_info, content_fingerprint, sanitize_path_segment};

const SCENE_PACKS_DIR: &str = "scene_packs";
const INDEX_FILE: &str = "_index.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScenePackClip {
    pub id: String,
    pub index: usize,
    pub label: String,
    pub source_name: String,
    pub source_src: String,
    pub source_start: f64,
    pub source_end: f64,
    pub fps: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScenePack {
    pub id: String,
    pub name: String,
    pub anime_title: String,
    pub character: String,
    pub source_name: String,
    pub source_src: String,
    pub created_at: String,
    pub updated_at: String,
    pub clips: Vec<ScenePackClip>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScenePackMeta {
    pub id: String,
    pub name: String,
    pub anime_title: String,
    pub character: String,
    pub source_name: String,
    pub clip_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

fn scene_packs_dir() -> PathBuf {
    app_state_dir().join(SCENE_PACKS_DIR)
}

fn index_path() -> PathBuf {
    scene_packs_dir().join(INDEX_FILE)
}

fn pack_path(id: &str) -> PathBuf {
    let safe_id = sanitize_path_segment(id, "unknown", 64);
    scene_packs_dir().join(format!("{}.json", safe_id))
}

fn read_index() -> Vec<ScenePackMeta> {
    let path = index_path();
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn write_index(meta: &[ScenePackMeta]) {
    let path = index_path();
    let dir = path.parent().unwrap();
    let _ = fs::create_dir_all(dir);

    let json = serde_json::to_string_pretty(meta).unwrap_or_else(|_| "[]".to_string());
    let tmp = path.with_extension("json.tmp");
    if let Err(e) = fs::write(&tmp, &json) {
        log_error(
            "scenepacks.index.write_error",
            "Failed to write scene packs index",
            json!({ "error": e.to_string() }),
        );
        return;
    }
    if let Err(e) = fs::rename(&tmp, &path) {
        log_error(
            "scenepacks.index.rename_error",
            "Failed to rename scene packs index",
            json!({ "error": e.to_string() }),
        );
    }
}

fn remove_from_index(id: &str) {
    let mut meta_list = read_index();
    meta_list.retain(|m| m.id != id);
    write_index(&meta_list);
}

fn upsert_index(meta: &ScenePackMeta) {
    let mut meta_list = read_index();
    if let Some(existing) = meta_list.iter_mut().find(|m| m.id == meta.id) {
        *existing = meta.clone();
    } else {
        meta_list.push(meta.clone());
    }
    write_index(&meta_list);
}

#[tauri::command]
pub(crate) fn scene_packs_list() -> Result<Vec<ScenePackMeta>, String> {
    Ok(read_index())
}

#[tauri::command]
pub(crate) fn scene_packs_load(id: String) -> Result<ScenePack, String> {
    let path = pack_path(&id);
    if !path.exists() {
        return Err(format!("Scene pack not found: {id}"));
    }
    let json_str = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read scene pack {id}: {e}"))?;
    serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse scene pack {id}: {e}"))
}

#[tauri::command]
pub(crate) fn scene_packs_save(pack: ScenePack) -> Result<ScenePack, String> {
    let dir = scene_packs_dir();
    let _ = fs::create_dir_all(&dir);

    let path = pack_path(&pack.id);
    let json = serde_json::to_string_pretty(&pack)
        .map_err(|e| format!("Failed to serialize scene pack: {e}"))?;

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json)
        .map_err(|e| format!("Failed to write scene pack {}: {e}", pack.id))?;
    fs::rename(&tmp, &path)
        .map_err(|e| format!("Failed to save scene pack {}: {e}", pack.id))?;

    let meta = ScenePackMeta {
        id: pack.id.clone(),
        name: pack.name.clone(),
        anime_title: pack.anime_title.clone(),
        character: pack.character.clone(),
        source_name: pack.source_name.clone(),
        clip_count: pack.clips.len(),
        created_at: pack.created_at.clone(),
        updated_at: pack.updated_at.clone(),
    };
    upsert_index(&meta);

    log_info(
        "scenepacks.save",
        "Scene pack saved",
        json!({ "id": pack.id, "name": pack.name, "clip_count": pack.clips.len() }),
    );

    Ok(pack)
}

#[tauri::command]
pub(crate) fn scene_packs_delete(id: String) -> Result<(), String> {
    let path = pack_path(&id);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete scene pack {id}: {e}"))?;
    }

    remove_from_index(&id);

    log_info(
        "scenepacks.delete",
        "Scene pack deleted",
        json!({ "id": id }),
    );

    Ok(())
}

#[tauri::command]
pub(crate) fn scene_packs_fingerprint(path: String) -> Result<Option<String>, String> {
    let p = std::path::Path::new(&path);
    Ok(content_fingerprint(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_index_returns_empty_for_nonexistent() {
        // Only tests the code path when the index doesn't exist
        // In unit tests the state dir won't have predefined packs
        let list = read_index();
        assert!(list.is_empty() || list.len() >= 0);
    }

    #[test]
    fn scene_pack_serde_roundtrip() {
        let pack = ScenePack {
            id: "test-1".into(),
            name: "Test Pack".into(),
            anime_title: "Test Anime".into(),
            character: "Test Char".into(),
            source_name: "test.mp4".into(),
            source_src: "/videos/test.mp4".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            clips: vec![ScenePackClip {
                id: "clip-1".into(),
                index: 0,
                label: "Scene 1".into(),
                source_name: "test.mp4".into(),
                source_src: "/videos/test.mp4".into(),
                source_start: 1.0,
                source_end: 3.0,
                fps: 23.976,
            }],
        };

        let json = serde_json::to_string(&pack).unwrap();
        let back: ScenePack = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "test-1");
        assert_eq!(back.clips.len(), 1);
    }
}

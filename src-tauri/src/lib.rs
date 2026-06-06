use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaFile {
    pub path: String,
    pub name: String,
    pub rel_path: String,
    pub ext: String,
    pub media_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MediaMetadata {
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub rating: u8,
}

const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "avif",
];

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "webm", "mkv", "avi", "mov", "wmv", "m4v", "ogv",
];

fn metadata_path(dir_path: &str) -> std::path::PathBuf {
    Path::new(dir_path).join(".imgraph.json")
}

#[tauri::command]
fn scan_directory(path: String) -> Result<Vec<MediaFile>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("ディレクトリではありません: {}", path));
    }

    let mut files = Vec::new();

    for entry in WalkDir::new(root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let file_path = entry.path();

        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let media_type = if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            "image"
        } else if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
            "video"
        } else {
            continue;
        };

        let name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let rel_path = file_path
            .strip_prefix(root)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        files.push(MediaFile {
            path: file_path.to_string_lossy().to_string(),
            name,
            rel_path,
            ext,
            media_type: media_type.to_string(),
        });
    }

    files.sort_by(|a, b| a.rel_path.to_lowercase().cmp(&b.rel_path.to_lowercase()));
    Ok(files)
}

#[tauri::command]
fn load_metadata(dir_path: String) -> Result<HashMap<String, MediaMetadata>, String> {
    let meta_file = metadata_path(&dir_path);
    if !meta_file.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&meta_file).map_err(|e| e.to_string())?;
    let metadata: HashMap<String, MediaMetadata> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(metadata)
}

#[tauri::command]
fn save_metadata(
    dir_path: String,
    metadata: HashMap<String, MediaMetadata>,
) -> Result<(), String> {
    let meta_file = metadata_path(&dir_path);
    let content = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(&meta_file, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            load_metadata,
            save_metadata
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

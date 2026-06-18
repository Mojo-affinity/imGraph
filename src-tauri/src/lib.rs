mod annotation;
mod dataset;
mod face_inference;
mod inference;
mod nsfw;
mod training;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

// ─── バンドル済みスクリプトパス ───────────────────────────────

#[derive(Debug, Serialize, Clone)]
struct BundledScripts {
    detect_faces_py: String,
    train_py: String,
}

#[tauri::command]
fn get_bundled_scripts(app: tauri::AppHandle) -> Result<BundledScripts, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("リソースディレクトリが取得できません: {}", e))?;
    Ok(BundledScripts {
        detect_faces_py: resource_dir
            .join("scripts")
            .join("detect_faces.py")
            .to_string_lossy()
            .to_string(),
        train_py: resource_dir
            .join("scripts")
            .join("train.py")
            .to_string_lossy()
            .to_string(),
    })
}

// ─── モデル設定 ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct ModelConfig {
    #[serde(default)]
    face_script_path: String,
    #[serde(default)]
    face_model_dir: String,
    #[serde(default)]
    object_model_path: String,
    #[serde(default)]
    object_class_names_path: String,
    #[serde(default = "default_object_conf")]
    object_conf_threshold: f32,
    // Rust ONNX 顔検出 (空の場合は Python fallback)
    #[serde(default)]
    face_det_model_path: String,
    #[serde(default)]
    face_genderage_model_path: String,
    // NudeNet 部位検出
    #[serde(default)]
    nudenet_model_path: String,
    #[serde(default = "default_nudenet_conf")]
    nudenet_conf_threshold: f32,
    // NSFW 画像分類
    #[serde(default)]
    nsfw_model_path: String,
    #[serde(default)]
    nsfw_class_names_path: String,
}

fn default_nudenet_conf() -> f32 { 0.2 }
fn default_object_conf()  -> f32 { 0.25 }

fn model_config_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".imgraph").join("model_config.json")
}

#[tauri::command]
fn save_model_config(config: ModelConfig) -> Result<(), String> {
    let path = model_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_model_config() -> Result<ModelConfig, String> {
    let path = model_config_path();
    if !path.exists() {
        return Ok(ModelConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

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

fn metadata_path(dir_path: &str) -> PathBuf {
    Path::new(dir_path).join(".imgraph.json")
}

fn make_media_file(file_path: &Path, root: &Path) -> Option<MediaFile> {
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
        return None;
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

    Some(MediaFile {
        path: file_path.to_string_lossy().to_string(),
        name,
        rel_path,
        ext,
        media_type: media_type.to_string(),
    })
}

// バックグラウンドで再帰スキャンし、BATCH_SIZE件ごとにイベントを emit する。
// 完了時に scan-complete イベントを emit する。
#[tauri::command]
async fn scan_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("ディレクトリではありません: {}", path));
    }

    tauri::async_runtime::spawn(async move {
        const BATCH_SIZE: usize = 200;
        let mut batch: Vec<MediaFile> = Vec::with_capacity(BATCH_SIZE);

        for entry in WalkDir::new(&root)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            if let Some(file) = make_media_file(entry.path(), &root) {
                batch.push(file);
                if batch.len() >= BATCH_SIZE {
                    app.emit("scan-batch", &batch).ok();
                    batch.clear();
                }
            }
        }

        if !batch.is_empty() {
            app.emit("scan-batch", &batch).ok();
        }
        app.emit("scan-complete", ()).ok();
    });

    Ok(())
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

// ─── アノテーションコマンド ───────────────────────────────────

#[tauri::command]
async fn save_annotation(
    image_path: String,
    boxes: Vec<inference::BoundingBox>,
) -> Result<(), String> {
    annotation::save_annotation(&image_path, &boxes)
}

#[tauri::command]
async fn load_annotation(image_path: String) -> Result<Vec<inference::BoundingBox>, String> {
    annotation::load_annotation(&image_path)
}

#[tauri::command]
async fn load_classes(dir_path: String) -> Result<Vec<String>, String> {
    annotation::load_classes(&dir_path)
}

// ─── 学習コマンド ─────────────────────────────────────────────

#[tauri::command]
async fn start_training(
    app: tauri::AppHandle,
    script_path: String,
    dataset_path: String,
    extra_args: Vec<String>,
) -> Result<(), String> {
    training::start(app, script_path, dataset_path, extra_args)
}

#[tauri::command]
fn get_is_training() -> bool {
    training::is_training()
}

// ─── データセット生成コマンド ─────────────────────────────────

#[tauri::command]
fn generate_dataset(
    source_dir: String,
    output_dir: String,
    val_ratio: f32,
) -> Result<dataset::DatasetInfo, String> {
    dataset::generate(&source_dir, &output_dir, val_ratio)
}

// ─── サムネイル生成 ───────────────────────────────────────────

#[tauri::command]
async fn get_thumbnail(path: String, size: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let img = image::open(&path).map_err(|e| e.to_string())?;
        let thumb = img.thumbnail(size, size);
        let mut buf = Vec::new();
        thumb
            .write_to(
                &mut std::io::Cursor::new(&mut buf),
                image::ImageFormat::Jpeg,
            )
            .map_err(|e| e.to_string())?;
        Ok(format!("data:image/jpeg;base64,{}", BASE64.encode(&buf)))
    })
    .await
    .map_err(|e| format!("スレッドエラー: {}", e))?
}

// ─── ログイベント ─────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct AppLogEvent {
    level: String,
    message: String,
}

fn emit_log(app: &tauri::AppHandle, level: &str, message: impl Into<String>) {
    app.emit("app-log", AppLogEvent {
        level: level.to_string(),
        message: message.into(),
    }).ok();
}

// ─── 推論コマンド ─────────────────────────────────────────────

#[tauri::command]
async fn detect_objects(
    app: tauri::AppHandle,
    image_path: String,
    model_path: String,
    class_names_path: String,
    conf_threshold: f32,
) -> Result<Vec<inference::BoundingBox>, String> {
    let fname = std::path::Path::new(&image_path)
        .file_name().and_then(|n| n.to_str()).unwrap_or(&image_path).to_string();
    emit_log(&app, "info", format!("[物体検出] 開始: {} (閾値={:.2})", fname, conf_threshold));

    match inference::run_object_detection(&image_path, &model_path, &class_names_path, conf_threshold).await {
        Ok(boxes) => {
            emit_log(&app, "info", format!("[物体検出] 完了: {}個検出", boxes.len()));
            Ok(boxes)
        }
        Err(e) => {
            emit_log(&app, "error", format!("[物体検出] エラー: {}", e));
            Err(e)
        }
    }
}

#[tauri::command]
async fn detect_faces_and_age(
    app: tauri::AppHandle,
    image_path: String,
    script_path: String,
    model_dir: String,
    face_det_model_path: String,
    face_genderage_model_path: String,
) -> Result<Vec<inference::BoundingBox>, String> {
    let fname = std::path::Path::new(&image_path)
        .file_name().and_then(|n| n.to_str()).unwrap_or(&image_path).to_string();

    if !face_det_model_path.is_empty() {
        let mode = if face_genderage_model_path.is_empty() { "顔検出のみ" } else { "顔検出+年齢推定" };
        emit_log(&app, "info", format!("[ONNX/{}] 開始: {}", mode, fname));
        let result = tauri::async_runtime::spawn_blocking(move || {
            face_inference::run_face_detection_onnx(
                &image_path, &face_det_model_path, &face_genderage_model_path,
            )
        })
        .await
        .map_err(|e| format!("タスク実行エラー: {}", e))?;

        match result {
            Ok(boxes) => {
                let summary: Vec<String> = boxes.iter().map(|b| {
                    let age = b.age.map(|a| format!(" age={}", a)).unwrap_or_default();
                    format!("{}{}", b.label, age)
                }).collect();
                emit_log(&app, "info", format!("[ONNX/{}] 完了: {}個 [{}]",
                    mode, boxes.len(), summary.join(", ")));
                Ok(boxes)
            }
            Err(e) => {
                emit_log(&app, "error", format!("[顔検出/ONNX] エラー: {}", e));
                Err(e)
            }
        }
    } else if !face_genderage_model_path.is_empty() {
        // 年齢・性別モデル単体モード（顔検出モデル不要）
        emit_log(&app, "info", format!("[age-gender/単体] 開始: {}", fname));
        let result = tauri::async_runtime::spawn_blocking(move || {
            face_inference::run_age_gender_whole_image(&image_path, &face_genderage_model_path)
        })
        .await
        .map_err(|e| format!("タスク実行エラー: {}", e))?;

        match result {
            Ok(boxes) => {
                let summary: Vec<String> = boxes.iter().map(|b| {
                    let age = b.age.map(|a| format!(" age={}", a)).unwrap_or_default();
                    format!("{}{}", b.label, age)
                }).collect();
                emit_log(&app, "info", format!("[age-gender/単体] 完了: [{}]", summary.join(", ")));
                Ok(boxes)
            }
            Err(e) => {
                emit_log(&app, "error", format!("[age-gender/単体] エラー: {}", e));
                Err(e)
            }
        }
    } else {
        emit_log(&app, "info", format!("[顔検出/Python] 開始: {}", fname));
        match inference::run_face_detection(&image_path, &script_path, &model_dir).await {
            Ok(boxes) => {
                emit_log(&app, "info", format!("[顔検出/Python] 完了: {}個検出", boxes.len()));
                Ok(boxes)
            }
            Err(e) => {
                emit_log(&app, "error", format!("[顔検出/Python] エラー: {}", e));
                Err(e)
            }
        }
    }
}

#[tauri::command]
async fn detect_nudenet(
    app: tauri::AppHandle,
    image_path: String,
    model_path: String,
    conf_threshold: f32,
) -> Result<Vec<inference::BoundingBox>, String> {
    let fname = std::path::Path::new(&image_path)
        .file_name().and_then(|n| n.to_str()).unwrap_or(&image_path).to_string();
    emit_log(&app, "info", format!("[NudeNet] 開始: {} (閾値={:.2})", fname, conf_threshold));

    match inference::run_nudenet_detection(&image_path, &model_path, conf_threshold).await {
        Ok(boxes) => {
            let summary: Vec<String> = boxes.iter()
                .map(|b| format!("{} ({:.0}%)", b.label, b.confidence * 100.0))
                .collect();
            emit_log(&app, "info", format!("[NudeNet] 完了: {}個 [{}]",
                boxes.len(), summary.join(", ")));
            Ok(boxes)
        }
        Err(e) => {
            emit_log(&app, "error", format!("[NudeNet] エラー: {}", e));
            Err(e)
        }
    }
}

#[tauri::command]
async fn classify_nsfw(
    app: tauri::AppHandle,
    image_path: String,
    model_path: String,
    class_names_path: String,
) -> Result<nsfw::NsfwResult, String> {
    let fname = std::path::Path::new(&image_path)
        .file_name().and_then(|n| n.to_str()).unwrap_or(&image_path).to_string();
    emit_log(&app, "info", format!("[NSFW] 開始: {}", fname));

    let result = tauri::async_runtime::spawn_blocking(move || {
        nsfw::run_nsfw_classification(&image_path, &model_path, &class_names_path)
    })
    .await
    .map_err(|e| format!("タスク実行エラー: {}", e))?;

    match result {
        Ok(r) => {
            emit_log(&app, "info", format!("[NSFW] 完了: {} ({:.0}%)", r.label, r.score * 100.0));
            Ok(r)
        }
        Err(e) => {
            emit_log(&app, "error", format!("[NSFW] エラー: {}", e));
            Err(e)
        }
    }
}

// InsightFace キャッシュから genderage.onnx を自動検索
#[tauri::command]
fn find_insightface_genderage() -> Option<String> {
    face_inference::find_insightface_genderage()
}

// ─── Python ランナー ──────────────────────────────────────────
//
// uv が PATH 上にあれば `uv run <script>` を使い、隔離環境で実行する。
// ない場合は `python3`（Windows では `python`）にフォールバックする。

pub(crate) fn resolve_python_cmd(script_path: &str) -> (String, Vec<String>) {
    let uv_available = std::process::Command::new("uv")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if uv_available {
        ("uv".to_string(), vec!["run".to_string(), script_path.to_string()])
    } else {
        let python = if cfg!(target_os = "windows") { "python" } else { "python3" };
        (python.to_string(), vec![script_path.to_string()])
    }
}

// ─── アプリ起動 ───────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            load_metadata,
            save_metadata,
            save_annotation,
            load_annotation,
            load_classes,
            start_training,
            get_is_training,
            detect_objects,
            detect_faces_and_age,
            detect_nudenet,
            classify_nsfw,
            find_insightface_genderage,
            save_model_config,
            load_model_config,
            generate_dataset,
            get_bundled_scripts,
            get_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static BOX_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> String {
    format!("bbox-{}", BOX_ID.fetch_add(1, Ordering::Relaxed))
}

// フロントエンドの BoundingBox 型と 1:1 対応
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoundingBox {
    pub id: String,
    /// 元画像幅に対する正規化座標 (0.0-1.0)
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub label: String,
    /// 推論信頼度 (0.0-1.0)
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age: Option<u32>,
}

// ─── 物体検出 ─────────────────────────────────────────────────
//
// TODO: ort (ONNX Runtime) による実推論に置き換える。
//   推奨モデル: YOLOv8n (ONNX) — https://github.com/ultralytics/ultralytics
//
pub async fn run_object_detection(image_path: &str) -> Result<Vec<BoundingBox>, String> {
    validate_image_path(image_path)?;

    Ok(vec![
        BoundingBox {
            id: next_id(),
            x: 0.05, y: 0.10, width: 0.30, height: 0.55,
            label: "person".to_string(),
            confidence: 0.91,
            age: None,
        },
        BoundingBox {
            id: next_id(),
            x: 0.55, y: 0.30, width: 0.35, height: 0.28,
            label: "car".to_string(),
            confidence: 0.76,
            age: None,
        },
    ])
}

// ─── 顔検出 + 年齢推定（Python subprocess） ──────────────────
//
// scripts/detect_faces.py を python3 で呼び出し、
// stdout の JSON を Vec<BoundingBox> にパースして返す。
//
pub async fn run_face_detection(
    image_path: &str,
    script_path: &str,
    model_dir: &str,
) -> Result<Vec<BoundingBox>, String> {
    validate_image_path(image_path)?;

    if script_path.is_empty() {
        return Err(
            "顔検出スクリプトが設定されていません。\
             Toolbar の ⚙ から detect_faces.py のパスを設定してください。"
                .to_string(),
        );
    }
    if !Path::new(script_path).exists() {
        return Err(format!("スクリプトが見つかりません: {}", script_path));
    }

    let image_path = image_path.to_string();
    let script_path = script_path.to_string();
    let model_dir = model_dir.to_string();

    // ブロッキング処理を spawn_blocking で非同期化
    let result = tauri::async_runtime::spawn_blocking(move || {
        let python = if cfg!(target_os = "windows") { "python" } else { "python3" };
        let mut cmd = std::process::Command::new(python);
        cmd.arg(&script_path).arg("--image").arg(&image_path);
        if !model_dir.is_empty() {
            cmd.arg("--model-dir").arg(&model_dir);
        }
        cmd.output()
    })
    .await
    .map_err(|e| format!("タスク実行エラー: {}", e))?
    .map_err(|e| format!("Python 起動エラー: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("スクリプトエラー:\n{}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&result.stdout);
    let mut boxes: Vec<BoundingBox> =
        serde_json::from_str(&stdout).map_err(|e| format!("JSON パースエラー: {}", e))?;

    // スクリプト側の仮 ID をアトミックカウンタ由来の一意 ID に差し替え
    for b in &mut boxes {
        b.id = next_id();
    }

    Ok(boxes)
}

// ─── 共通バリデーション ───────────────────────────────────────

fn validate_image_path(image_path: &str) -> Result<(), String> {
    let path = Path::new(image_path);
    if !path.exists() {
        return Err(format!("ファイルが見つかりません: {}", image_path));
    }
    if !path.is_file() {
        return Err(format!("ファイルではありません: {}", image_path));
    }
    Ok(())
}

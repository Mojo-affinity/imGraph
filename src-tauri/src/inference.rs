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
// TODO: candle-core / ort (ONNX Runtime) による実推論に置き換える。
//   推奨モデル: YOLOv8n (ONNX) — https://github.com/ultralytics/ultralytics
//   Cargo.toml に以下を追加:
//     ort = { version = "2", features = ["load-dynamic"] }
//     image = { version = "0.25", default-features = false, features = ["jpeg","png","webp"] }
//
pub async fn run_object_detection(image_path: &str) -> Result<Vec<BoundingBox>, String> {
    validate_image_path(image_path)?;

    // ── ダミー結果 ───────────────────────────────────────────
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

// ─── 顔検出 + 年齢推定 ────────────────────────────────────────
//
// TODO: 顔検出 (RetinaFace / MediaPipe Face Detection ONNX) +
//       年齢推定モデル (SSR-Net 等) に置き換える。
//
pub async fn run_face_detection(image_path: &str) -> Result<Vec<BoundingBox>, String> {
    validate_image_path(image_path)?;

    // ── ダミー結果 ───────────────────────────────────────────
    Ok(vec![
        BoundingBox {
            id: next_id(),
            x: 0.28, y: 0.08, width: 0.22, height: 0.30,
            label: "face".to_string(),
            confidence: 0.97,
            age: Some(28),
        },
        BoundingBox {
            id: next_id(),
            x: 0.60, y: 0.12, width: 0.18, height: 0.26,
            label: "face".to_string(),
            confidence: 0.85,
            age: Some(42),
        },
    ])
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

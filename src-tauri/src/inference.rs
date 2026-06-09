use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static BOX_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn next_id() -> String {
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

// NudeNet v3 組み込みクラス名（class_names_path が空の場合に使用）
pub const NUDENET_CLASSES: &[&str] = &[
    "FEMALE_GENITALIA_COVERED",
    "FEMALE_FACE",
    "BUTTOCKS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_BREAST_EXPOSED",
    "ANUS_EXPOSED",
    "FEET_EXPOSED",
    "BELLY_COVERED",
    "FEET_COVERED",
    "ARMPITS_COVERED",
    "ARMPITS_EXPOSED",
    "FACE_MALE",
    "BELLY_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
];

// ─── 物体検出（YOLOv8 ONNX + ort） ───────────────────────────────
pub async fn run_object_detection(
    image_path: &str,
    model_path: &str,
    class_names_path: &str,
) -> Result<Vec<BoundingBox>, String> {
    validate_image_path(image_path)?;

    if model_path.is_empty() {
        return Err(
            "物体検出モデルが設定されていません。\
             Toolbar の ⚙ から ONNX モデルパスを設定してください。"
                .to_string(),
        );
    }
    if !Path::new(model_path).exists() {
        return Err(format!("モデルが見つかりません: {}", model_path));
    }

    let image_path = image_path.to_string();
    let model_path = model_path.to_string();
    let class_names_path = class_names_path.to_string();

    tauri::async_runtime::spawn_blocking(move || {
        yolo_detect(&image_path, &model_path, &class_names_path, 0.25)
    })
    .await
    .map_err(|e| format!("タスク実行エラー: {}", e))?
}

// ─── 部位検出（NudeNet v3 ONNX） ──────────────────────────────────
pub async fn run_nudenet_detection(
    image_path: &str,
    model_path: &str,
    conf_threshold: f32,
) -> Result<Vec<BoundingBox>, String> {
    validate_image_path(image_path)?;

    if model_path.is_empty() {
        return Err(
            "NudeNet モデルが設定されていません。\
             Toolbar の ⚙ から 640m.onnx のパスを設定してください。"
                .to_string(),
        );
    }
    if !Path::new(model_path).exists() {
        return Err(format!("モデルが見つかりません: {}", model_path));
    }

    let image_path = image_path.to_string();
    let model_path = model_path.to_string();

    tauri::async_runtime::spawn_blocking(move || {
        yolo_detect_nudenet(&image_path, &model_path, conf_threshold)
    })
    .await
    .map_err(|e| format!("タスク実行エラー: {}", e))?
}

fn yolo_detect(
    image_path: &str,
    model_path: &str,
    class_names_path: &str,
    conf_threshold: f32,
) -> Result<Vec<BoundingBox>, String> {
    use ndarray::Array4;
    use ort::{session::Session, value::Tensor};

    let class_names = load_class_names(class_names_path);

    // 画像読み込み
    let img =
        image::open(image_path).map_err(|e| format!("画像読み込みエラー: {}", e))?;
    let orig_w = img.width() as f32;
    let orig_h = img.height() as f32;
    let img_rgb = img.into_rgb8();

    // letterbox リサイズ（640×640 に収める）
    const SZ: u32 = 640;
    let scale = (SZ as f32 / orig_w).min(SZ as f32 / orig_h);
    let new_w = (orig_w * scale).round() as u32;
    let new_h = (orig_h * scale).round() as u32;
    let pad_x = ((SZ - new_w) / 2) as f32;
    let pad_y = ((SZ - new_h) / 2) as f32;

    let resized = image::imageops::resize(
        &img_rgb,
        new_w,
        new_h,
        image::imageops::FilterType::Triangle, // Bilinear 相当
    );

    // [1, 3, 640, 640] float32 テンソル（RGB, 0.0-1.0, CHW）
    let mut input = Array4::<f32>::zeros((1, 3, SZ as usize, SZ as usize));
    for y in 0..new_h {
        for x in 0..new_w {
            let p = resized.get_pixel(x, y);
            let px = (x as f32 + pad_x) as usize;
            let py = (y as f32 + pad_y) as usize;
            input[[0, 0, py, px]] = p[0] as f32 / 255.0;
            input[[0, 1, py, px]] = p[1] as f32 / 255.0;
            input[[0, 2, py, px]] = p[2] as f32 / 255.0;
        }
    }

    // ONNX セッション構築
    let mut session = Session::builder()
        .map_err(|e| format!("ORT 初期化エラー: {}", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("モデル読み込みエラー: {}", e))?;

    // Tensor 構築と推論実行
    let tensor = Tensor::<f32>::from_array(input)
        .map_err(|e| format!("テンソル構築エラー: {}", e))?;

    let outputs = session
        .run(ort::inputs![tensor])
        .map_err(|e| format!("推論エラー: {}", e))?;

    // 出力テンソルを ndarray として取得: shape = [1, 4+num_classes, 8400]
    let output = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("出力取得エラー: {}", e))?;

    let shape = output.shape();
    if shape.len() != 3 || shape[0] != 1 || shape[2] < 1 {
        return Err(format!(
            "予期しない出力形状: {:?}（YOLOv8 ONNX モデルか確認してください）",
            shape
        ));
    }
    let num_outputs = shape[1];
    let num_anchors = shape[2];
    if num_outputs < 5 {
        return Err(format!(
            "出力チャンネル数 {} が不正です（4 + クラス数 ≥ 5 が必要）",
            num_outputs
        ));
    }
    let num_classes = num_outputs - 4;

    const IOU_THRESHOLD: f32 = 0.45;

    // (cx, cy, w, h, class_id, confidence) — 入力画像（640×640）のピクセル座標
    let mut dets: Vec<(f32, f32, f32, f32, usize, f32)> = Vec::new();

    for i in 0..num_anchors {
        let cx = output[[0, 0, i]];
        let cy = output[[0, 1, i]];
        let w  = output[[0, 2, i]];
        let h  = output[[0, 3, i]];

        let mut best_conf = 0.0f32;
        let mut best_cls = 0usize;
        for c in 0..num_classes {
            let conf = output[[0, 4 + c, i]];
            if conf > best_conf {
                best_conf = conf;
                best_cls = c;
            }
        }

        if best_conf >= conf_threshold {
            dets.push((cx, cy, w, h, best_cls, best_conf));
        }
    }

    // クラス別 Greedy NMS
    let class_ids: std::collections::HashSet<usize> = dets.iter().map(|d| d.4).collect();
    let mut result: Vec<BoundingBox> = Vec::new();

    for cid in class_ids {
        let mut cls_dets: Vec<_> = dets.iter().filter(|d| d.4 == cid).cloned().collect();
        cls_dets.sort_by(|a, b| b.5.partial_cmp(&a.5).unwrap_or(std::cmp::Ordering::Equal));

        let mut keep = vec![true; cls_dets.len()];
        for i in 0..cls_dets.len() {
            if !keep[i] {
                continue;
            }
            for j in (i + 1)..cls_dets.len() {
                if !keep[j] {
                    continue;
                }
                let (a, b) = (&cls_dets[i], &cls_dets[j]);
                if iou(a.0, a.1, a.2, a.3, b.0, b.1, b.2, b.3) > IOU_THRESHOLD {
                    keep[j] = false;
                }
            }
        }

        for (det, k) in cls_dets.iter().zip(keep) {
            if !k {
                continue;
            }
            let (cx, cy, w, h, class_id, conf) = *det;

            // letterbox ピクセル座標 → 元画像正規化座標
            let x1 = (cx - w / 2.0 - pad_x) / scale;
            let y1 = (cy - h / 2.0 - pad_y) / scale;
            let bw = w / scale;
            let bh = h / scale;

            let nx = (x1 / orig_w).clamp(0.0, 1.0);
            let ny = (y1 / orig_h).clamp(0.0, 1.0);
            let nw = (bw / orig_w).clamp(0.0, 1.0 - nx);
            let nh = (bh / orig_h).clamp(0.0, 1.0 - ny);

            let label = class_names
                .get(class_id)
                .cloned()
                .unwrap_or_else(|| format!("class_{}", class_id));

            result.push(BoundingBox {
                id: next_id(),
                x: nx as f64,
                y: ny as f64,
                width: nw as f64,
                height: nh as f64,
                label,
                confidence: conf as f64,
                age: None,
            });
        }
    }

    Ok(result)
}

// CX/CY/W/H 形式同士の IoU（中心座標 + 幅高さ）
pub(crate) fn iou(cx1: f32, cy1: f32, w1: f32, h1: f32, cx2: f32, cy2: f32, w2: f32, h2: f32) -> f32 {
    let (x1, y1, x2, y2) = (cx1 - w1 / 2.0, cy1 - h1 / 2.0, cx1 + w1 / 2.0, cy1 + h1 / 2.0);
    let (x3, y3, x4, y4) = (cx2 - w2 / 2.0, cy2 - h2 / 2.0, cx2 + w2 / 2.0, cy2 + h2 / 2.0);
    let inter = (x2.min(x4) - x1.max(x3)).max(0.0) * (y2.min(y4) - y1.max(y3)).max(0.0);
    let union = w1 * h1 + w2 * h2 - inter;
    if union <= 0.0 { 0.0 } else { inter / union }
}

fn load_class_names(path: &str) -> Vec<String> {
    if path.is_empty() {
        return Vec::new();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => content
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        Err(_) => Vec::new(),
    }
}

// ─── NudeNet 専用検出（組み込みクラス名 + 可変閾値） ─────────────────
fn yolo_detect_nudenet(
    image_path: &str,
    model_path: &str,
    conf_threshold: f32,
) -> Result<Vec<BoundingBox>, String> {
    // クラス名ファイルは使わず組み込み定数を使用
    let dummy_class_names_path = "";
    let mut result = yolo_detect(image_path, model_path, dummy_class_names_path, conf_threshold)?;

    // クラス名を組み込み定数で上書き（yolo_detect が class_N フォールバックを返す場合に対応）
    for b in &mut result {
        if b.label.starts_with("class_") {
            if let Ok(idx) = b.label["class_".len()..].parse::<usize>() {
                if let Some(name) = NUDENET_CLASSES.get(idx) {
                    b.label = name.to_string();
                }
            }
        }
    }

    Ok(result)
}

// ─── 顔検出 + 年齢推定（Python subprocess） ──────────────────────
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

    // ライブラリが stdout に余分な行を混入する場合があるため、
    // '[' で始まる最後の行を JSON として扱う
    let json_str = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('['))
        .ok_or_else(|| {
            let stderr = String::from_utf8_lossy(&result.stderr);
            format!(
                "JSON 出力が見つかりません\nstdout: {}\nstderr: {}",
                stdout.trim(),
                stderr.trim()
            )
        })?;

    let mut boxes: Vec<BoundingBox> =
        serde_json::from_str(json_str).map_err(|e| format!("JSON パースエラー: {}", e))?;

    for b in &mut boxes {
        b.id = next_id();
    }

    Ok(boxes)
}

// ─── 共通バリデーション ───────────────────────────────────────────

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

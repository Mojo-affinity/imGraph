/// YOLOv8-face ONNX + (オプション) 2次モデルによる顔検出・年齢推定
///
/// 顔検出モデル出力形状:
///   [1, ch>=20, N]: YOLOv8-face (bbox + 5 keypoints) → Umeyama 顔アライン
///   [1, 5<=ch<20, N]: bbox + conf のみ             → 単純クロップ
///
/// 2次モデル (genderage_model_path) は入出力形状から自動判別:
///   NCHW [1, 3, H, W] + 出力 [1, 3]:    InsightFace genderage.onnx → female/male/age
///   NHWC [1, H, W, 3] + 出力 [1, 1]:    MobileNetV2 年齢回帰モデル → age only
///   NCHW [1, 3, H, W] + 出力×2:         age-gender-prediction-ONNX
///                                          出力0=age(スカラー or 分布), 出力1=gender[2]
///   ※ パス未設定なら顔検出のみ (label="face", age=None)

use image::RgbImage;
use ndarray::Array4;
use ort::{session::Session, value::Tensor};
use std::sync::{Mutex, OnceLock};

use crate::inference::{iou, next_id, BoundingBox};

// InsightFace ArcFace reference landmarks (112×112 space)
const ARCFACE_REF_112: [[f32; 2]; 5] = [
    [38.2946, 51.6963], // left eye
    [73.5318, 51.5014], // right eye
    [56.0252, 71.7366], // nose
    [41.5493, 92.3655], // left mouth corner
    [70.7299, 92.2041], // right mouth corner
];

// ─── セッションキャッシュ ─────────────────────────────────────────

struct SessionCache {
    path: String,
    session: Session,
}

static FACE_SESS: OnceLock<Mutex<Option<SessionCache>>> = OnceLock::new();
static GA_SESS:   OnceLock<Mutex<Option<SessionCache>>> = OnceLock::new();

fn get_session(
    cell: &'static OnceLock<Mutex<Option<SessionCache>>>,
    model_path: &str,
) -> Result<std::sync::MutexGuard<'static, Option<SessionCache>>, String> {
    let mutex = cell.get_or_init(|| Mutex::new(None));
    let mut guard = mutex.lock().map_err(|e| format!("lock: {}", e))?;
    let needs_reload = guard.as_ref().map(|c| c.path != model_path).unwrap_or(true);
    if needs_reload {
        let session = Session::builder()
            .map_err(|e| format!("ORT 初期化: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("モデル読み込み ({}): {}", model_path, e))?;
        *guard = Some(SessionCache { path: model_path.to_string(), session });
    }
    Ok(guard)
}

// ─── Umeyama 類似変換 (5 点対) ───────────────────────────────────
//
// src: 出力空間 (ArcFace 基準点)、dst: 入力画像空間 (検出 kps)
// 戻り値 [a, b, tx, ty]: xd = a·xs - b·ys + tx, yd = b·xs + a·ys + ty

fn estimate_similarity(src: &[[f32; 2]; 5], dst: &[[f32; 2]; 5]) -> [f64; 4] {
    let mut ata = [[0f64; 4]; 4];
    let mut atb = [0f64; 4];
    for i in 0..5 {
        let (xs, ys) = (src[i][0] as f64, src[i][1] as f64);
        let (xd, yd) = (dst[i][0] as f64, dst[i][1] as f64);
        let r0 = [xs, -ys, 1.0, 0.0f64];
        let r1 = [ys,  xs, 0.0, 1.0f64];
        for j in 0..4 {
            for k in 0..4 {
                ata[j][k] += r0[j] * r0[k] + r1[j] * r1[k];
            }
            atb[j] += r0[j] * xd + r1[j] * yd;
        }
    }
    gauss4(&ata, &atb)
}

fn gauss4(a: &[[f64; 4]; 4], b: &[f64; 4]) -> [f64; 4] {
    let mut m = [[0f64; 5]; 4];
    for i in 0..4 {
        for j in 0..4 { m[i][j] = a[i][j]; }
        m[i][4] = b[i];
    }
    for col in 0..4usize {
        let mut pivot = col;
        for row in (col + 1)..4 {
            if m[row][col].abs() > m[pivot][col].abs() { pivot = row; }
        }
        m.swap(col, pivot);
        let p = m[col][col];
        if p.abs() < 1e-12 { continue; }
        for row in 0..4 {
            if row == col { continue; }
            let f = m[row][col] / p;
            for k in 0..5 { m[row][k] -= f * m[col][k]; }
        }
    }
    std::array::from_fn(|i| {
        if m[i][i].abs() < 1e-12 { 0.0 } else { m[i][4] / m[i][i] }
    })
}

// ─── 顔クロップ ──────────────────────────────────────────────────

// Umeyama アライン版: output(ox,oy) → input(ix,iy) バイリニア補間
// estimate_similarity が返す [a,b,tx,ty] は template→image の順方向写像なので
// そのまま ix = a*ox - b*oy + tx, iy = b*ox + a*oy + ty で input 座標を得る
fn warp_face_umeyama(img: &RgbImage, params: &[f64; 4], size: usize) -> Array4<f32> {
    let (a, b, tx, ty) = (params[0], params[1], params[2], params[3]);
    let (iw, ih) = (img.width() as i64, img.height() as i64);
    let mut out = Array4::<f32>::zeros((1, 3, size, size));

    for oy in 0..size {
        for ox in 0..size {
            let ix = a * ox as f64 - b * oy as f64 + tx;
            let iy = b * ox as f64 + a * oy as f64 + ty;
            let x0 = ix.floor() as i64;
            let y0 = iy.floor() as i64;
            let fx = (ix - x0 as f64) as f32;
            let fy = (iy - y0 as f64) as f32;

            let pix = |px: i64, py: i64| -> [f32; 3] {
                if px < 0 || py < 0 || px >= iw || py >= ih { return [0.0; 3]; }
                let p = img.get_pixel(px as u32, py as u32);
                [p[0] as f32, p[1] as f32, p[2] as f32]
            };
            let p00 = pix(x0, y0); let p10 = pix(x0+1, y0);
            let p01 = pix(x0, y0+1); let p11 = pix(x0+1, y0+1);
            for c in 0..3 {
                let top = p00[c] + (p10[c] - p00[c]) * fx;
                let bot = p01[c] + (p11[c] - p01[c]) * fx;
                out[[0, c, oy, ox]] = top + (bot - top) * fy;
            }
        }
    }
    out
}

// ─── 2次モデル自動判別 ────────────────────────────────────────────

#[derive(Clone, Copy)]
enum SecondaryModelKind {
    /// InsightFace genderage: NCHW [1,3,H,W] [0,255], 出力 [1,3]=[f,m,age/100]
    Genderage { size: usize },
    /// MobileNetV2 age regression: NHWC [1,H,W,3] [0,1], 出力 [1,1]=age
    AgeRegression { size: usize },
    /// age-gender-prediction-ONNX: NCHW [1,3,H,W] ImageNet正規化,
    ///   出力0=age (スカラー or 確率分布), 出力1=gender [female_prob, male_prob]
    AgeGenderPrediction { size: usize },
}

// ImageNet mean / std (RGB)
const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const IMAGENET_STD:  [f32; 3] = [0.229, 0.224, 0.225];

fn detect_secondary_kind(session: &Session) -> SecondaryModelKind {
    let inputs  = session.inputs();
    let outputs = session.outputs();

    // 出力テンソルが 2 本 → AgeGenderPrediction
    if outputs.len() >= 2 {
        let size = inputs.first()
            .and_then(|o| {
                if let ort::value::ValueType::Tensor { ref shape, .. } = o.dtype() {
                    if shape.len() == 4 { let d = shape[2]; if d > 4 { return Some(d as usize); } }
                }
                None
            })
            .unwrap_or(224);
        return SecondaryModelKind::AgeGenderPrediction { size: size.max(1) };
    }

    // 出力チャンネル数で種別判定
    let out_ch = outputs.first()
        .and_then(|o| {
            if let ort::value::ValueType::Tensor { ref shape, .. } = o.dtype() {
                shape.last().copied().filter(|&d| d > 0).map(|d| d as usize)
            } else { None }
        })
        .unwrap_or(3);

    // 入力形状から NHWC/NCHW とサイズを判定
    let (is_nhwc, size) = inputs.first()
        .and_then(|o| {
            if let ort::value::ValueType::Tensor { ref shape, .. } = o.dtype() {
                if shape.len() != 4 { return None; }
                let d1 = shape[1]; // NCHW: channels (=3), NHWC: height
                let d3 = shape[3]; // NHWC: channels (=3), NCHW: width
                if d3 > 0 && d3 <= 4 {
                    Some((true, d1.max(0) as usize))
                } else if d1 > 0 && d1 <= 4 {
                    Some((false, shape[2].max(0) as usize))
                } else {
                    None
                }
            } else { None }
        })
        .unwrap_or((false, 96));

    match (is_nhwc, out_ch) {
        (true, 1) => SecondaryModelKind::AgeRegression { size: size.max(1) },
        _         => SecondaryModelKind::Genderage     { size: size.max(1) },
    }
}


// 単純クロップ版: image クレートの resize を使用（SIMD 最適化済み）
fn crop_face_simple(img: &RgbImage, x1: f32, y1: f32, bw: f32, bh: f32, size: usize) -> Array4<f32> {
    let iw = img.width() as f32;
    let ih = img.height() as f32;
    // 中心を基準に正方形クロップ
    let cx = (x1 + bw / 2.0).clamp(0.0, iw);
    let cy = (y1 + bh / 2.0).clamp(0.0, ih);
    let half = (bw.max(bh) / 2.0)
        .min(cx).min(cy)
        .min(iw - cx).min(ih - cy)
        .max(1.0);
    let crop_x = (cx - half) as u32;
    let crop_y = (cy - half) as u32;
    let crop_s = ((half * 2.0) as u32)
        .min(img.width().saturating_sub(crop_x))
        .min(img.height().saturating_sub(crop_y))
        .max(1);

    let crop = image::imageops::crop_imm(img, crop_x, crop_y, crop_s, crop_s);
    let resized = image::imageops::resize(
        &*crop, size as u32, size as u32, image::imageops::FilterType::Triangle,
    );

    let mut out = Array4::<f32>::zeros((1, 3, size, size));
    for (x, y, p) in resized.enumerate_pixels() {
        out[[0, 0, y as usize, x as usize]] = p[0] as f32;
        out[[0, 1, y as usize, x as usize]] = p[1] as f32;
        out[[0, 2, y as usize, x as usize]] = p[2] as f32;
    }
    out
}

// NHWC クロップ版: age regression モデル用 [0,1] 正規化
fn crop_face_nhwc(img: &RgbImage, x1: f32, y1: f32, bw: f32, bh: f32, size: usize) -> Array4<f32> {
    let iw = img.width() as f32;
    let ih = img.height() as f32;
    let cx = (x1 + bw / 2.0).clamp(0.0, iw);
    let cy = (y1 + bh / 2.0).clamp(0.0, ih);
    let half = (bw.max(bh) / 2.0)
        .min(cx).min(cy)
        .min(iw - cx).min(ih - cy)
        .max(1.0);
    let crop_x = (cx - half) as u32;
    let crop_y = (cy - half) as u32;
    let crop_s = ((half * 2.0) as u32)
        .min(img.width().saturating_sub(crop_x))
        .min(img.height().saturating_sub(crop_y))
        .max(1);

    let crop = image::imageops::crop_imm(img, crop_x, crop_y, crop_s, crop_s);
    let resized = image::imageops::resize(
        &*crop, size as u32, size as u32, image::imageops::FilterType::Triangle,
    );

    // NHWC: [1, size, size, 3], [0, 1] 正規化
    let mut out = Array4::<f32>::zeros((1, size, size, 3));
    for (x, y, p) in resized.enumerate_pixels() {
        out[[0, y as usize, x as usize, 0]] = p[0] as f32 / 255.0;
        out[[0, y as usize, x as usize, 1]] = p[1] as f32 / 255.0;
        out[[0, y as usize, x as usize, 2]] = p[2] as f32 / 255.0;
    }
    out
}

// NCHW クロップ版: age-gender-prediction-ONNX 用 ImageNet 正規化
fn crop_face_nchw_imagenet(img: &RgbImage, x1: f32, y1: f32, bw: f32, bh: f32, size: usize) -> Array4<f32> {
    let iw = img.width() as f32;
    let ih = img.height() as f32;
    let cx = (x1 + bw / 2.0).clamp(0.0, iw);
    let cy = (y1 + bh / 2.0).clamp(0.0, ih);
    let half = (bw.max(bh) / 2.0)
        .min(cx).min(cy)
        .min(iw - cx).min(ih - cy)
        .max(1.0);
    let crop_x = (cx - half) as u32;
    let crop_y = (cy - half) as u32;
    let crop_s = ((half * 2.0) as u32)
        .min(img.width().saturating_sub(crop_x))
        .min(img.height().saturating_sub(crop_y))
        .max(1);

    let crop = image::imageops::crop_imm(img, crop_x, crop_y, crop_s, crop_s);
    let resized = image::imageops::resize(
        &*crop, size as u32, size as u32, image::imageops::FilterType::Triangle,
    );

    let mut out = Array4::<f32>::zeros((1, 3, size, size));
    for (x, y, p) in resized.enumerate_pixels() {
        for c in 0..3 {
            out[[0, c, y as usize, x as usize]] =
                (p[c] as f32 / 255.0 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
        }
    }
    out
}

// age logits/probs から softmax 加重期待値で年齢を推定
fn softmax_weighted_age(values: &[f32]) -> u32 {
    if values.is_empty() { return 0; }
    if values.len() == 1 {
        let v = values[0];
        return if v <= 1.0 { (v * 100.0).round() as u32 } else { v.round().max(0.0) as u32 };
    }
    // softmax (数値安定化のため max を引く)
    let max = values.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = values.iter().map(|&v| (v - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    if sum <= 0.0 { return 0; }
    // 加重期待値: E[age] = Σ i * softmax(logits)[i]
    (exps.iter().enumerate()
        .map(|(i, &e)| i as f32 * e / sum)
        .sum::<f32>())
    .round() as u32
}

// ─── 内部 Detection 構造体 ────────────────────────────────────────

struct Det {
    cx: f32, cy: f32, w: f32, h: f32,
    score: f32,
    kps: Option<[[f32; 2]; 5]>,
}

// ─── 年齢・性別モデル単体実行（顔検出モデル不要）──────────────────
//
// 画像全体（中央寄せ正方形クロップ → リサイズ）をそのままモデルに渡す。
// 顔がアップで写っている画像や、既にトリミング済みの顔画像向け。

pub fn run_age_gender_whole_image(
    image_path: &str,
    model_path: &str,
) -> Result<Vec<BoundingBox>, String> {
    let img = image::open(image_path)
        .map_err(|e| format!("画像読み込みエラー: {}", e))?;
    let orig_w = img.width() as f32;
    let orig_h = img.height() as f32;
    let img_rgb = img.to_rgb8();

    let mut ga_guard = get_session(&GA_SESS, model_path)?;

    // モデル種別・入力サイズを不変借用ブロック内で取得
    let (kind, size) = {
        let sess = ga_guard.as_ref().unwrap();
        let k = detect_secondary_kind(&sess.session);
        let s = match k {
            SecondaryModelKind::Genderage { size }
            | SecondaryModelKind::AgeRegression { size }
            | SecondaryModelKind::AgeGenderPrediction { size } => size,
        };
        (k, s)
    };

    // 画像全体を各モデル向けに前処理（正方形センタークロップ → リサイズ）
    let face_input: Array4<f32> = match kind {
        SecondaryModelKind::AgeRegression { .. } =>
            crop_face_nhwc(&img_rgb, 0.0, 0.0, orig_w, orig_h, size),
        SecondaryModelKind::Genderage { .. } =>
            crop_face_simple(&img_rgb, 0.0, 0.0, orig_w, orig_h, size),
        SecondaryModelKind::AgeGenderPrediction { .. } =>
            crop_face_nchw_imagenet(&img_rgb, 0.0, 0.0, orig_w, orig_h, size),
    };

    let ga_sess = ga_guard.as_mut().unwrap();
    let ga_tensor = Tensor::<f32>::from_array(face_input)
        .map_err(|e| format!("テンソル構築: {}", e))?;
    let ga_out = ga_sess.session
        .run(ort::inputs![ga_tensor])
        .map_err(|e| format!("age-gender 推論: {}", e))?;

    let (label, age) = match kind {
        SecondaryModelKind::Genderage { .. } => {
            let arr = ga_out[0]
                .try_extract_array::<f32>()
                .map_err(|e| format!("genderage 出力: {}", e))?;
            if arr.shape().get(1).copied().unwrap_or(0) >= 3 {
                let (f, m) = (arr[[0, 0]], arr[[0, 1]]);
                let age = (arr[[0, 2]] * 100.0).round() as u32;
                let g = if m > f { "male" } else { "female" };
                (g.to_string(), Some(age))
            } else {
                ("face".to_string(), None)
            }
        }
        SecondaryModelKind::AgeRegression { .. } => {
            let arr = ga_out[0]
                .try_extract_array::<f32>()
                .map_err(|e| format!("年齢回帰出力: {}", e))?;
            let age = arr.first().copied().unwrap_or(0.0).round().max(0.0) as u32;
            ("face".to_string(), Some(age))
        }
        SecondaryModelKind::AgeGenderPrediction { .. } => {
            let flat0: Vec<f32> = ga_out[0]
                .try_extract_array::<f32>()
                .map_err(|e| format!("出力0取得: {}", e))?
                .iter().cloned().collect();
            let (age_flat, gender_flat) = if ga_out.len() >= 2 {
                let flat1: Vec<f32> = ga_out[1]
                    .try_extract_array::<f32>()
                    .map_err(|e| format!("出力1取得: {}", e))?
                    .iter().cloned().collect();
                if flat0.len() >= flat1.len() { (flat0, flat1) } else { (flat1, flat0) }
            } else {
                (flat0, vec![])
            };
            let age = softmax_weighted_age(&age_flat);
            let g = if gender_flat.len() >= 2 && gender_flat[1] > gender_flat[0] {
                "male"
            } else if gender_flat.len() >= 2 {
                "female"
            } else {
                "face"
            };
            (g.to_string(), Some(age))
        }
    };

    Ok(vec![BoundingBox {
        id: next_id(),
        x: 0.0, y: 0.0, width: 1.0, height: 1.0,
        label,
        confidence: 1.0,
        age,
    }])
}

// ─── 公開エントリポイント ────────────────────────────────────────

pub fn run_face_detection_onnx(
    image_path: &str,
    face_model_path: &str,
    genderage_model_path: &str,  // 空文字 = 顔検出のみ
) -> Result<Vec<BoundingBox>, String> {
    // ── 1. 画像読み込み ──────────────────────────────────────
    let img = image::open(image_path)
        .map_err(|e| format!("画像読み込みエラー: {}", e))?;
    let orig_w = img.width() as f32;
    let orig_h = img.height() as f32;
    let img_rgb = img.to_rgb8();

    // ── 2. Letterbox 640×640 ────────────────────────────────
    const SZ: u32 = 640;
    let scale = (SZ as f32 / orig_w).min(SZ as f32 / orig_h);
    let new_w = (orig_w * scale).round() as u32;
    let new_h = (orig_h * scale).round() as u32;
    let pad_x = ((SZ - new_w) / 2) as f32;
    let pad_y = ((SZ - new_h) / 2) as f32;

    let resized = image::imageops::resize(
        &img_rgb, new_w, new_h, image::imageops::FilterType::Triangle,
    );
    let mut input = Array4::<f32>::zeros((1, 3, SZ as usize, SZ as usize));
    for (x, y, p) in resized.enumerate_pixels() {
        let px = (x as f32 + pad_x) as usize;
        let py = (y as f32 + pad_y) as usize;
        input[[0, 0, py, px]] = p[0] as f32 / 255.0;
        input[[0, 1, py, px]] = p[1] as f32 / 255.0;
        input[[0, 2, py, px]] = p[2] as f32 / 255.0;
    }

    // ── 3. 顔検出推論 ───────────────────────────────────────
    let mut face_guard = get_session(&FACE_SESS, face_model_path)?;
    let face_sess = face_guard.as_mut().unwrap();

    let face_tensor = Tensor::<f32>::from_array(input)
        .map_err(|e| format!("テンソル構築: {}", e))?;
    let face_out = face_sess.session
        .run(ort::inputs![face_tensor])
        .map_err(|e| format!("顔検出推論: {}", e))?;
    let face_arr = face_out[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("出力取得: {}", e))?;

    let shape = face_arr.shape();
    if shape.len() != 3 || shape[1] < 5 {
        return Err(format!(
            "顔検出: 非対応の出力形状 {:?} (期待: [1, >=5, N])",
            shape
        ));
    }
    let channels = shape[1];
    let n        = shape[2];
    let has_kps  = channels >= 20;

    // ── 4. 検出結果パース + NMS ──────────────────────────────
    const CONF_THR: f32 = 0.40;
    const IOU_THR:  f32 = 0.45;

    let mut dets: Vec<Det> = (0..n)
        .filter_map(|i| {
            let score = face_arr[[0, 4, i]];
            if score < CONF_THR { return None; }
            let kps = if has_kps {
                Some(std::array::from_fn::<[f32; 2], 5, _>(|k| {
                    [face_arr[[0, 5 + k * 3, i]], face_arr[[0, 5 + k * 3 + 1, i]]]
                }))
            } else {
                None
            };
            Some(Det {
                cx: face_arr[[0, 0, i]], cy: face_arr[[0, 1, i]],
                w:  face_arr[[0, 2, i]], h:  face_arr[[0, 3, i]],
                score, kps,
            })
        })
        .collect();

    dets.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let mut keep = vec![true; dets.len()];
    for i in 0..dets.len() {
        if !keep[i] { continue; }
        for j in (i + 1)..dets.len() {
            if !keep[j] { continue; }
            if iou(dets[i].cx, dets[i].cy, dets[i].w, dets[i].h,
                   dets[j].cx, dets[j].cy, dets[j].w, dets[j].h) > IOU_THR {
                keep[j] = false;
            }
        }
    }

    // ── 5. 2次モデルセッション準備 (オプション) ─────────────
    let use_secondary = !genderage_model_path.is_empty();

    let (secondary_kind, mut ga_guard) = if use_secondary {
        let guard = get_session(&GA_SESS, genderage_model_path)?;
        let kind = {
            let sess = guard.as_ref().unwrap();
            detect_secondary_kind(&sess.session)
        };
        (Some(kind), Some(guard))
    } else {
        (None, None)
    };

    // ── 6. 各顔の処理 ───────────────────────────────────────
    let ga_size = match &secondary_kind {
        Some(SecondaryModelKind::Genderage { size })           => *size,
        Some(SecondaryModelKind::AgeRegression { size })       => *size,
        Some(SecondaryModelKind::AgeGenderPrediction { size }) => *size,
        None => 96,
    };
    let ref_scale = ga_size as f32 / 112.0;
    let ref_pts: [[f32; 2]; 5] =
        std::array::from_fn(|k| [ARCFACE_REF_112[k][0] * ref_scale, ARCFACE_REF_112[k][1] * ref_scale]);

    let mut result: Vec<BoundingBox> = Vec::new();

    for (det, &kept) in dets.iter().zip(keep.iter()) {
        if !kept { continue; }

        // Letterbox → 元画像ピクセル座標
        let x1 = (det.cx - det.w / 2.0 - pad_x) / scale;
        let y1 = (det.cy - det.h / 2.0 - pad_y) / scale;
        let bw  = det.w / scale;
        let bh  = det.h / scale;

        let (label, age) = match &secondary_kind {
            Some(SecondaryModelKind::Genderage { size }) => {
                let ga_size_loc = *size;
                let face_input = if let Some(kps) = &det.kps {
                    let kps_orig: [[f32; 2]; 5] = std::array::from_fn(|k| {
                        [(kps[k][0] - pad_x) / scale, (kps[k][1] - pad_y) / scale]
                    });
                    let params = estimate_similarity(&ref_pts, &kps_orig);
                    warp_face_umeyama(&img_rgb, &params, ga_size_loc)
                } else {
                    crop_face_simple(&img_rgb, x1, y1, bw, bh, ga_size_loc)
                };

                let ga_sess = ga_guard.as_mut().unwrap().as_mut().unwrap();
                let ga_tensor = Tensor::<f32>::from_array(face_input)
                    .map_err(|e| format!("顔テンソル構築: {}", e))?;
                let ga_out = ga_sess.session
                    .run(ort::inputs![ga_tensor])
                    .map_err(|e| format!("genderage 推論: {}", e))?;
                let ga_arr = ga_out[0]
                    .try_extract_array::<f32>()
                    .map_err(|e| format!("genderage 出力: {}", e))?;

                if ga_arr.shape().get(1).copied().unwrap_or(0) >= 3 {
                    let female = ga_arr[[0, 0]];
                    let male   = ga_arr[[0, 1]];
                    let age    = (ga_arr[[0, 2]] * 100.0).round() as u32;
                    let gender = if male > female { "male" } else { "female" };
                    (gender.to_string(), Some(age))
                } else {
                    ("face".to_string(), None)
                }
            },
            Some(SecondaryModelKind::AgeRegression { size }) => {
                // NHWC [0,1] クロップ → 年齢回帰
                let face_input = crop_face_nhwc(&img_rgb, x1, y1, bw, bh, *size);

                let ga_sess = ga_guard.as_mut().unwrap().as_mut().unwrap();
                let ga_tensor = Tensor::<f32>::from_array(face_input)
                    .map_err(|e| format!("顔テンソル構築: {}", e))?;
                let ga_out = ga_sess.session
                    .run(ort::inputs![ga_tensor])
                    .map_err(|e| format!("年齢回帰推論: {}", e))?;
                let ga_arr = ga_out[0]
                    .try_extract_array::<f32>()
                    .map_err(|e| format!("年齢回帰出力: {}", e))?;

                let age = ga_arr.first().copied().unwrap_or(0.0).round().max(0.0) as u32;
                ("face".to_string(), Some(age))
            },
            Some(SecondaryModelKind::AgeGenderPrediction { size }) => {
                // NCHW ImageNet 正規化クロップ
                let face_input = if let Some(kps) = &det.kps {
                    let kps_orig: [[f32; 2]; 5] = std::array::from_fn(|k| {
                        [(kps[k][0] - pad_x) / scale, (kps[k][1] - pad_y) / scale]
                    });
                    let params = estimate_similarity(&ref_pts, &kps_orig);
                    let aligned = warp_face_umeyama(&img_rgb, &params, *size);
                    let mut norm = Array4::<f32>::zeros((1, 3, *size, *size));
                    for c in 0..3 {
                        for y in 0..*size {
                            for x in 0..*size {
                                norm[[0, c, y, x]] =
                                    (aligned[[0, c, y, x]] / 255.0 - IMAGENET_MEAN[c])
                                    / IMAGENET_STD[c];
                            }
                        }
                    }
                    norm
                } else {
                    crop_face_nchw_imagenet(&img_rgb, x1, y1, bw, bh, *size)
                };

                let ga_sess = ga_guard.as_mut().unwrap().as_mut().unwrap();
                let ga_tensor = Tensor::<f32>::from_array(face_input)
                    .map_err(|e| format!("顔テンソル構築: {}", e))?;
                let ga_out = ga_sess.session
                    .run(ort::inputs![ga_tensor])
                    .map_err(|e| format!("age-gender 推論: {}", e))?;

                let flat0: Vec<f32> = ga_out[0]
                    .try_extract_array::<f32>()
                    .map_err(|e| format!("出力0取得: {}", e))?
                    .iter().cloned().collect();

                let (age_flat, gender_flat): (Vec<f32>, Vec<f32>) = if ga_out.len() >= 2 {
                    let flat1: Vec<f32> = ga_out[1]
                        .try_extract_array::<f32>()
                        .map_err(|e| format!("出力1取得: {}", e))?
                        .iter().cloned().collect();
                    // 要素数が多い方が age 分布 (〜101)、少ない方が gender (2)
                    if flat0.len() >= flat1.len() { (flat0, flat1) } else { (flat1, flat0) }
                } else {
                    (flat0, vec![])
                };

                // age: softmax 後に加重期待値（logits・確率分布どちらも対応）
                let age = softmax_weighted_age(&age_flat);

                // gender: argmax（logits でも確率でも argmax は等価）
                let gender_label = if gender_flat.len() >= 2 {
                    if gender_flat[1] > gender_flat[0] { "male" } else { "female" }
                } else {
                    "face"
                };

                (gender_label.to_string(), Some(age))
            },
            None => ("face".to_string(), None),
        };

        let nx = (x1 / orig_w).clamp(0.0, 1.0);
        let ny = (y1 / orig_h).clamp(0.0, 1.0);
        let nw = (bw / orig_w).clamp(0.0, 1.0 - nx);
        let nh = (bh / orig_h).clamp(0.0, 1.0 - ny);

        result.push(BoundingBox {
            id: next_id(),
            x: nx as f64, y: ny as f64,
            width: nw as f64, height: nh as f64,
            label,
            confidence: det.score as f64,
            age,
        });
    }

    Ok(result)
}

// ─── InsightFace キャッシュからの自動検索 ────────────────────────

pub fn find_insightface_genderage() -> Option<String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    for pack in &["buffalo_l", "buffalo_sc", "buffalo_s"] {
        let path = std::path::PathBuf::from(&home)
            .join(".insightface/models")
            .join(pack)
            .join("genderage.onnx");
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_full_pipeline() {
        let img = "/tmp/test_face.jpg";
        let det = "/home/ubuntu/models/yolov8n-face.onnx";
        let ga  = "/home/ubuntu/models/genderage.onnx";
        if !std::path::Path::new(img).exists()
            || !std::path::Path::new(det).exists()
            || !std::path::Path::new(ga).exists()
        {
            eprintln!("test assets not found, skipping");
            return;
        }
        let boxes = run_face_detection_onnx(img, det, ga).expect("pipeline failed");
        eprintln!("Detected {} face(s):", boxes.len());
        for b in &boxes {
            eprintln!("  {} conf={:.2} age={:?}  [{:.3},{:.3},{:.3},{:.3}]",
                b.label, b.confidence, b.age, b.x, b.y, b.width, b.height);
        }
        assert!(!boxes.is_empty(), "no faces detected in test image");
    }

    #[test]
    fn test_detect_only() {
        let img = "/tmp/test_face.jpg";
        let det = "/home/ubuntu/models/yolov8n-face.onnx";
        if !std::path::Path::new(img).exists() || !std::path::Path::new(det).exists() {
            eprintln!("test assets not found, skipping");
            return;
        }
        let boxes = run_face_detection_onnx(img, det, "").expect("detect-only failed");
        eprintln!("Detect-only: {} face(s)", boxes.len());
        assert!(!boxes.is_empty());
        assert!(boxes.iter().all(|b| b.age.is_none()));
    }

    #[test]
    fn test_age_regression() {
        let img = "/tmp/test_face.jpg";
        let det = "/home/ubuntu/models/yolov8n-face.onnx";
        let age = "/home/ubuntu/models/age_regression.onnx";
        if !std::path::Path::new(img).exists()
            || !std::path::Path::new(det).exists()
            || !std::path::Path::new(age).exists()
        {
            eprintln!("test assets not found, skipping");
            return;
        }
        let boxes = run_face_detection_onnx(img, det, age).expect("age-regression failed");
        eprintln!("Age-regression: {} face(s):", boxes.len());
        for b in &boxes {
            eprintln!("  label={} conf={:.2} age={:?}", b.label, b.confidence, b.age);
        }
        assert!(!boxes.is_empty());
        assert!(boxes.iter().all(|b| b.age.is_some()), "age should be set for all faces");
        assert!(boxes.iter().all(|b| b.label == "face"), "label should be 'face' for age-regression model");
    }
}

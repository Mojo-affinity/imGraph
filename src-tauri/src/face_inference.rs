/// YOLOv8-face ONNX + genderage.onnx による顔検出・年齢推定
///
/// パイプライン:
///   1. 画像を letterbox 640×640 にリサイズ
///   2. YOLOv8-face 推論 → BBox + 5 ランドマーク
///   3. NMS
///   4. 各顔: InsightFace ArcFace 基準点との Umeyama 類似変換で
///            face_size×face_size にアライン
///   5. genderage.onnx 推論 → 性別 / 年齢
///
/// YOLOv8-face ONNX 出力形状: [1, 20, 8400]
///   ch 0-3  : cx, cy, w, h  (letterbox ピクセル座標)
///   ch 4    : face confidence
///   ch 5-19 : 5 keypoints × 3 (x, y, visibility)
///             順: left_eye, right_eye, nose, left_mouth, right_mouth
///
/// genderage.onnx (InsightFace buffalo_sc) 入出力:
///   入力: [1, 3, 96, 96] float32 RGB [0, 255]
///   出力: [1, 3] → [female_prob, male_prob, age/100]

use image::RgbImage;
use ndarray::Array4;
use ort::{session::Session, value::Tensor};

use crate::inference::{iou, next_id, BoundingBox};

// InsightFace ArcFace reference landmarks (112×112 space)
const ARCFACE_REF_112: [[f32; 2]; 5] = [
    [38.2946, 51.6963], // left eye
    [73.5318, 51.5014], // right eye
    [56.0252, 71.7366], // nose
    [41.5493, 92.3655], // left mouth corner
    [70.7299, 92.2041], // right mouth corner
];

// ─── 類似変換推定 (Umeyama 簡略版) ─────────────────────────────
//
// src: reference template 座標 (output 空間)
// dst: 検出ランドマーク座標 (original image 空間)
// 推定: xd ≈ a*xs - b*ys + tx,  yd ≈ b*xs + a*ys + ty
// 戻り値: [a, b, tx, ty]
fn estimate_similarity(src: &[[f32; 2]; 5], dst: &[[f32; 2]; 5]) -> [f64; 4] {
    let mut ata = [[0f64; 4]; 4];
    let mut atb = [0f64; 4];
    for i in 0..5 {
        let (xs, ys) = (src[i][0] as f64, src[i][1] as f64);
        let (xd, yd) = (dst[i][0] as f64, dst[i][1] as f64);
        // row_0: [xs, -ys, 1, 0], row_1: [ys, xs, 0, 1]
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

// 部分ピボット付きガウス消去法 (4×4)
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

// 類似変換パラメータ [a, b, tx, ty] から 2×3 アフィン行列を構築
// 用途: output pixel (ox, oy) → input image (ix, iy) = M * [ox, oy, 1]
fn affine_matrix(p: &[f64; 4]) -> [[f64; 3]; 2] {
    [[p[0], -p[1], p[2]], [p[1], p[0], p[3]]]
}

// バイリニア補間 (境界外は 0)
fn bilinear(img: &RgbImage, x: f64, y: f64) -> [f32; 3] {
    let (iw, ih) = (img.width() as i64, img.height() as i64);
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let fx = (x - x0 as f64) as f32;
    let fy = (y - y0 as f64) as f32;
    let pix = |px: i64, py: i64| -> [f32; 3] {
        if px < 0 || py < 0 || px >= iw || py >= ih { return [0.0; 3]; }
        let p = img.get_pixel(px as u32, py as u32);
        [p[0] as f32, p[1] as f32, p[2] as f32]
    };
    let p00 = pix(x0,   y0);
    let p10 = pix(x0+1, y0);
    let p01 = pix(x0,   y0+1);
    let p11 = pix(x0+1, y0+1);
    let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
    std::array::from_fn(|c| {
        lerp(lerp(p00[c], p10[c], fx), lerp(p01[c], p11[c], fx), fy)
    })
}

// アフィン変換でアライン済み顔画像テンソルを生成
// 出力: [1, 3, face_size, face_size] float32 RGB [0, 255]
fn warp_face(img: &RgbImage, m: &[[f64; 3]; 2], face_size: usize) -> Array4<f32> {
    let mut out = Array4::<f32>::zeros((1, 3, face_size, face_size));
    for oy in 0..face_size {
        for ox in 0..face_size {
            let ix = m[0][0] * ox as f64 + m[0][1] * oy as f64 + m[0][2];
            let iy = m[1][0] * ox as f64 + m[1][1] * oy as f64 + m[1][2];
            let rgb = bilinear(img, ix, iy);
            out[[0, 0, oy, ox]] = rgb[0];
            out[[0, 1, oy, ox]] = rgb[1];
            out[[0, 2, oy, ox]] = rgb[2];
        }
    }
    out
}

// ─── 公開エントリポイント ────────────────────────────────────────

pub fn run_face_detection_onnx(
    image_path: &str,
    face_model_path: &str,
    genderage_model_path: &str,
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
        &img_rgb, new_w, new_h,
        image::imageops::FilterType::Triangle,
    );
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

    // ── 3. 顔検出推論 ───────────────────────────────────────
    let mut face_sess = Session::builder()
        .map_err(|e| format!("ORT 初期化: {}", e))?
        .commit_from_file(face_model_path)
        .map_err(|e| format!("顔検出モデル読み込み: {}", e))?;

    let face_tensor = Tensor::<f32>::from_array(input)
        .map_err(|e| format!("テンソル構築: {}", e))?;
    let face_out = face_sess
        .run(ort::inputs![face_tensor])
        .map_err(|e| format!("顔検出推論: {}", e))?;
    let face_arr = face_out[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("出力取得: {}", e))?;

    let shape = face_arr.shape();
    if shape.len() != 3 || shape[1] < 20 {
        return Err(format!(
            "YOLOv8-face: 予期しない出力形状 {:?} (期待: [1,20,8400])",
            shape
        ));
    }
    let n = shape[2];

    // ── 4. 検出結果パース ────────────────────────────────────
    const CONF_THR: f32 = 0.40;
    const IOU_THR: f32  = 0.45;

    struct Det {
        cx: f32, cy: f32, w: f32, h: f32,
        score: f32,
        kps: [[f32; 2]; 5],
    }

    let mut dets: Vec<Det> = (0..n)
        .filter_map(|i| {
            let score = face_arr[[0, 4, i]];
            if score < CONF_THR { return None; }
            let kps = std::array::from_fn::<[f32; 2], 5, _>(|k| {
                [face_arr[[0, 5 + k * 3, i]], face_arr[[0, 5 + k * 3 + 1, i]]]
            });
            Some(Det {
                cx: face_arr[[0, 0, i]], cy: face_arr[[0, 1, i]],
                w:  face_arr[[0, 2, i]], h:  face_arr[[0, 3, i]],
                score, kps,
            })
        })
        .collect();

    // Greedy NMS
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

    // ── 5. genderage セッション準備 ─────────────────────────
    let mut ga_sess = Session::builder()
        .map_err(|e| format!("ORT 初期化: {}", e))?
        .commit_from_file(genderage_model_path)
        .map_err(|e| format!("年齢推定モデル読み込み: {}", e))?;

    // モデルの入力 H を動的取得。取れない場合は 96 (buffalo_sc デフォルト)
    let ga_size: usize = ga_sess
        .inputs()
        .first()
        .and_then(|outlet| {
            if let ort::value::ValueType::Tensor { ref shape, .. } = outlet.dtype() {
                shape.get(2).filter(|&&d| d > 0).map(|&d| d as usize)
            } else {
                None
            }
        })
        .unwrap_or(96);

    // ── 6. 各顔の年齢・性別推定 ─────────────────────────────
    let ref_scale = ga_size as f32 / 112.0;
    let ref_pts: [[f32; 2]; 5] =
        std::array::from_fn(|k| [ARCFACE_REF_112[k][0] * ref_scale, ARCFACE_REF_112[k][1] * ref_scale]);

    let mut result: Vec<BoundingBox> = Vec::new();

    for (det, &k) in dets.iter().zip(keep.iter()) {
        if !k { continue; }

        // Letterbox → original image ピクセル座標
        let x1 = (det.cx - det.w / 2.0 - pad_x) / scale;
        let y1 = (det.cy - det.h / 2.0 - pad_y) / scale;
        let bw = det.w / scale;
        let bh = det.h / scale;

        // キーポイントも逆変換
        let kps_orig: [[f32; 2]; 5] = std::array::from_fn(|k| {
            [(det.kps[k][0] - pad_x) / scale, (det.kps[k][1] - pad_y) / scale]
        });

        // 類似変換: ref_pts (出力空間) → kps_orig (入力画像空間)
        let params = estimate_similarity(&ref_pts, &kps_orig);
        let m = affine_matrix(&params);
        let face_arr_warped = warp_face(&img_rgb, &m, ga_size);

        // genderage 推論
        let ga_tensor = Tensor::<f32>::from_array(face_arr_warped)
            .map_err(|e| format!("顔テンソル構築: {}", e))?;
        let ga_out = ga_sess
            .run(ort::inputs![ga_tensor])
            .map_err(|e| format!("年齢推定推論: {}", e))?;
        let ga_arr = ga_out[0]
            .try_extract_array::<f32>()
            .map_err(|e| format!("年齢推定出力: {}", e))?;

        let (label, age) = if ga_arr.shape().get(1).copied().unwrap_or(0) >= 3 {
            let female = ga_arr[[0, 0]];
            let male   = ga_arr[[0, 1]];
            let age    = (ga_arr[[0, 2]] * 100.0).round() as u32;
            let gender = if male > female { "male" } else { "female" };
            (gender.to_string(), age)
        } else {
            ("face".to_string(), 0)
        };

        // 正規化座標に変換
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
            age: if age > 0 { Some(age) } else { None },
        });
    }

    Ok(result)
}

// ─── InsightFace キャッシュからの自動検索 ────────────────────────

pub fn find_insightface_genderage() -> Option<String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    for pack in &["buffalo_sc", "buffalo_l", "buffalo_s"] {
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

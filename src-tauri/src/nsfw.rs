/// NSFW 画像分類
///
/// 対応モデル形状（入出力から自動判別）:
///   Binary [1,2]:   index0=safe, index1=nsfw → softmax 後 index1 をスコアに使用
///   Single [1,1]:   sigmoid → そのまま NSFW スコア
///   Multi-class:    クラス名ファイルで nsfw/porn/hentai/sexy キーワードのスコアを合算
///
/// 前処理: resize 224×224, ImageNet 正規化 (mean/std), NCHW float32

use ndarray::Array4;
use ort::{session::Session, value::Tensor};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NsfwResult {
    pub score: f32,   // NSFW 確率 0.0-1.0
    pub label: String, // "safe" | "nsfw"
}

struct SessionCache {
    path: String,
    session: Session,
}

static NSFW_SESS: OnceLock<Mutex<Option<SessionCache>>> = OnceLock::new();

const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const IMAGENET_STD:  [f32; 3] = [0.229, 0.224, 0.225];
const INPUT_SIZE: u32 = 224;

pub fn run_nsfw_classification(
    image_path: &str,
    model_path: &str,
    class_names_path: &str,
) -> Result<NsfwResult, String> {
    // 画像読み込み・リサイズ・正規化
    let img = image::open(image_path)
        .map_err(|e| format!("画像読み込みエラー: {}", e))?;
    let resized = image::imageops::resize(
        &img.into_rgb8(),
        INPUT_SIZE, INPUT_SIZE,
        image::imageops::FilterType::Triangle,
    );

    let mut input = Array4::<f32>::zeros((1, 3, INPUT_SIZE as usize, INPUT_SIZE as usize));
    for (x, y, p) in resized.enumerate_pixels() {
        for c in 0..3 {
            input[[0, c, y as usize, x as usize]] =
                (p[c] as f32 / 255.0 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
        }
    }

    // セッション取得（キャッシュ）
    let mutex = NSFW_SESS.get_or_init(|| Mutex::new(None));
    let mut guard = mutex.lock().map_err(|e| format!("lock: {}", e))?;
    let needs_reload = guard.as_ref().map(|c| c.path != model_path).unwrap_or(true);
    if needs_reload {
        let session = Session::builder()
            .map_err(|e| format!("ORT 初期化: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("モデル読み込み ({}): {}", model_path, e))?;
        *guard = Some(SessionCache { path: model_path.to_string(), session });
    }
    let cache = guard.as_mut().unwrap();

    let tensor = Tensor::<f32>::from_array(input)
        .map_err(|e| format!("テンソル構築エラー: {}", e))?;
    let outputs = cache.session
        .run(ort::inputs![tensor])
        .map_err(|e| format!("推論エラー: {}", e))?;

    let output = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|e| format!("出力取得エラー: {}", e))?;

    let flat: Vec<f32> = output.iter().cloned().collect();
    if flat.is_empty() {
        return Err("モデル出力が空です".to_string());
    }

    let class_names = load_class_names(class_names_path);
    let score = compute_nsfw_score(&flat, &class_names);
    let label = if score >= 0.5 { "nsfw" } else { "safe" }.to_string();

    Ok(NsfwResult { score, label })
}

fn compute_nsfw_score(flat: &[f32], class_names: &[String]) -> f32 {
    let probs = to_probs(flat);

    if class_names.is_empty() {
        return match probs.len() {
            1 => probs[0],
            _ => probs.get(1).copied().unwrap_or(0.0), // binary: index1=nsfw
        };
    }

    const NSFW_KW: &[&str] = &["nsfw", "porn", "hentai", "sexy", "explicit", "adult"];
    let mut sum = 0.0f32;
    let mut found = false;
    for (i, name) in class_names.iter().enumerate() {
        if i >= probs.len() { break; }
        let lower = name.to_lowercase();
        if NSFW_KW.iter().any(|kw| lower.contains(kw)) {
            sum += probs[i];
            found = true;
        }
    }

    if found {
        sum
    } else {
        probs.get(1).copied()
            .unwrap_or_else(|| probs.last().copied().unwrap_or(0.0))
    }
}

fn to_probs(values: &[f32]) -> Vec<f32> {
    if values.len() == 1 {
        // single output: sigmoid
        let v = values[0];
        return vec![1.0 / (1.0 + (-v).exp())];
    }
    // すでに確率和 ~1 なら softmax 不要
    let sum: f32 = values.iter().sum();
    if (sum - 1.0).abs() < 0.01 && values.iter().all(|&v| v >= 0.0) {
        return values.to_vec();
    }
    // softmax
    let max = values.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = values.iter().map(|&v| (v - max).exp()).collect();
    let exp_sum: f32 = exps.iter().sum();
    if exp_sum <= 0.0 { return vec![1.0 / values.len() as f32; values.len()]; }
    exps.iter().map(|&e| e / exp_sum).collect()
}

fn load_class_names(path: &str) -> Vec<String> {
    if path.is_empty() { return Vec::new(); }
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

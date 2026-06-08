use std::fs;
use std::path::Path;

use crate::inference::BoundingBox;

const CLASSES_FILE: &str = "classes.txt";

// ─── クラスリスト管理 ─────────────────────────────────────────

pub fn load_classes(dir_path: &str) -> Result<Vec<String>, String> {
    let path = Path::new(dir_path).join(CLASSES_FILE);
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

fn save_classes(dir_path: &str, classes: &[String]) -> Result<(), String> {
    let path = Path::new(dir_path).join(CLASSES_FILE);
    fs::write(&path, classes.join("\n") + "\n").map_err(|e| e.to_string())
}

// ラベルからクラスIDを取得。存在しない場合はリストに追加して新IDを返す。
fn get_or_add_class(classes: &mut Vec<String>, label: &str) -> usize {
    if let Some(idx) = classes.iter().position(|c| c == label) {
        idx
    } else {
        classes.push(label.to_string());
        classes.len() - 1
    }
}

// ─── YOLO フォーマット保存 ────────────────────────────────────
//
// <class_id> <x_center> <y_center> <width> <height>
// 座標はすべて元画像サイズに対する正規化値 (0.0-1.0)
// ストアの BoundingBox は (x, y) = 左上なので変換が必要。
//
pub fn save_annotation(image_path: &str, boxes: &[BoundingBox]) -> Result<(), String> {
    let img_path = Path::new(image_path);
    let dir = img_path
        .parent()
        .ok_or("親ディレクトリを取得できません")?;
    let dir_str = dir.to_string_lossy();

    let mut classes = load_classes(&dir_str)?;
    let mut lines: Vec<String> = Vec::new();

    for b in boxes {
        let class_id = get_or_add_class(&mut classes, &b.label);
        let x_center = b.x + b.width  / 2.0;
        let y_center = b.y + b.height / 2.0;
        lines.push(format!(
            "{} {:.6} {:.6} {:.6} {:.6}",
            class_id, x_center, y_center, b.width, b.height
        ));
    }

    let txt_path = img_path.with_extension("txt");

    if lines.is_empty() {
        // ボックスなし → アノテーションファイルを削除
        if txt_path.exists() {
            fs::remove_file(&txt_path).map_err(|e| e.to_string())?;
        }
    } else {
        fs::write(&txt_path, lines.join("\n") + "\n").map_err(|e| e.to_string())?;
        // classes.txt を更新（新ラベルが追加された場合）
        save_classes(&dir_str, &classes)?;
    }

    Ok(())
}

// ─── YOLO フォーマット読み込み ────────────────────────────────

pub fn load_annotation(image_path: &str) -> Result<Vec<BoundingBox>, String> {
    let img_path = Path::new(image_path);
    let txt_path = img_path.with_extension("txt");

    if !txt_path.exists() {
        return Ok(vec![]);
    }

    let dir = img_path
        .parent()
        .ok_or("親ディレクトリを取得できません")?;
    let classes = load_classes(&dir.to_string_lossy())?;

    let content = fs::read_to_string(&txt_path).map_err(|e| e.to_string())?;
    let mut boxes = Vec::new();

    for (i, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        let class_id: usize = parts[0]
            .parse()
            .map_err(|e| format!("行 {}: class_id の解析失敗 — {}", i + 1, e))?;
        let x_center: f64 = parts[1]
            .parse()
            .map_err(|e| format!("行 {}: x_center の解析失敗 — {}", i + 1, e))?;
        let y_center: f64 = parts[2]
            .parse()
            .map_err(|e| format!("行 {}: y_center の解析失敗 — {}", i + 1, e))?;
        let width: f64 = parts[3]
            .parse()
            .map_err(|e| format!("行 {}: width の解析失敗 — {}", i + 1, e))?;
        let height: f64 = parts[4]
            .parse()
            .map_err(|e| format!("行 {}: height の解析失敗 — {}", i + 1, e))?;

        let label = classes
            .get(class_id)
            .cloned()
            .unwrap_or_else(|| format!("class_{}", class_id));

        boxes.push(BoundingBox {
            id: format!("bbox-loaded-{}-{}", i, class_id),
            x: x_center - width  / 2.0,
            y: y_center - height / 2.0,
            width,
            height,
            label,
            confidence: 1.0,
            age: None,
        });
    }

    Ok(boxes)
}

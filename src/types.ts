export interface MediaFile {
  path: string;
  name: string;
  rel_path: string;
  ext: string;
  media_type: 'image' | 'video';
}

export interface MediaMetadata {
  tags: string[];
  rating: number; // 0 = unrated, 1-5
}

export type MetadataMap = Record<string, MediaMetadata>;

// ─── ML / Annotation ──────────────────────────────────────────

export interface BoundingBox {
  id: string;
  // 元画像サイズに対する正規化座標 (0.0-1.0)
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number; // 0.0-1.0 (手動追加の場合は 1.0)
  age?: number;       // 顔検知時の年齢推定値
}

export type InferenceMode = 'none' | 'object' | 'face' | 'nudenet';

export interface NsfwResult {
  score: number;   // 0.0-1.0
  label: string;   // "safe" | "nsfw"
}

export interface BundledScripts {
  detect_faces_py: string;
  train_py: string;
}

export interface DatasetInfo {
  yaml_path: string;
  train_count: number;
  val_count: number;
  class_names: string[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ModelConfig {
  face_script_path: string;
  face_model_dir: string;
  object_model_path: string;
  object_class_names_path: string;
  object_conf_threshold: number;
  // Rust ONNX 顔検出 (空の場合は Python fallback)
  face_det_model_path: string;
  face_genderage_model_path: string;
  // NudeNet 部位検出
  nudenet_model_path: string;
  nudenet_conf_threshold: number;
  // NSFW 画像分類
  nsfw_model_path: string;
  nsfw_class_names_path: string;
}

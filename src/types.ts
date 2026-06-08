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

export type InferenceMode = 'none' | 'object' | 'face';

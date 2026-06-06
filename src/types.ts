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

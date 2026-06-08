import { useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { MediaFile } from '../types';

// モジュールスコープの Map で Image オブジェクトを生存させ、
// GC によるブラウザキャッシュの解放を防ぐ
const imageCache = new Map<string, HTMLImageElement>();
const MAX_CACHE = 20;
const PRELOAD_RADIUS = 2;

function prefetch(path: string) {
  if (imageCache.has(path)) return;
  const img = new Image();
  img.src = convertFileSrc(path);
  imageCache.set(path, img);
  // 挿入順に古いエントリを削除して上限を維持
  if (imageCache.size > MAX_CACHE) {
    imageCache.delete(imageCache.keys().next().value!);
  }
}

export function usePrefetch(files: MediaFile[], selectedIndex: number | null) {
  useEffect(() => {
    if (selectedIndex === null || files.length === 0) return;

    for (let d = 1; d <= PRELOAD_RADIUS; d++) {
      const prev = files[selectedIndex - d];
      const next = files[selectedIndex + d];
      if (prev?.media_type === 'image') prefetch(prev.path);
      if (next?.media_type === 'image') prefetch(next.path);
    }
  }, [files, selectedIndex]);
}

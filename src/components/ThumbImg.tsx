import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';

const cache = new Map<string, string>();

const THUMB_SIZE = 256;

interface Props {
  path: string;
  className?: string;
}

export function ThumbImg({ path, className }: Props) {
  const [src, setSrc] = useState<string | null>(() => cache.get(path) ?? null);

  useEffect(() => {
    if (cache.has(path)) {
      setSrc(cache.get(path)!);
      return;
    }
    let cancelled = false;
    invoke<string>('get_thumbnail', { path, size: THUMB_SIZE })
      .then(dataUrl => {
        if (!cancelled) {
          cache.set(path, dataUrl);
          setSrc(dataUrl);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [path]);

  if (!src) return <div className={className} style={{ background: '#1a1a1a' }} />;
  return <img src={src} alt="" className={className} draggable={false} />;
}

import { useRef, useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

interface VideoThumbProps {
  path: string;
  className?: string;
}

export function VideoThumb({ path, className }: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ビューポートから 300px 以内に入ったときだけ src をセット
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setSrc(convertFileSrc(path));
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [path]);

  return (
    <video
      ref={ref}
      src={src}
      preload={src ? 'metadata' : 'none'}
      muted
      playsInline
      className={className}
      onLoadedMetadata={(e) => {
        const v = e.target as HTMLVideoElement;
        v.currentTime = v.duration > 0 ? Math.min(0.5, v.duration * 0.1) : 0;
      }}
    />
  );
}

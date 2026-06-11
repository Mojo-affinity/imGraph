import { convertFileSrc } from '@tauri-apps/api/core';

interface VideoThumbProps {
  path: string;
  className?: string;
}

export function VideoThumb({ path, className }: VideoThumbProps) {
  return (
    <video
      src={convertFileSrc(path)}
      preload="metadata"
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

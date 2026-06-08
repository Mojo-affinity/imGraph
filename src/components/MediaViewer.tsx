import { useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { BoundingBoxEditor } from './BoundingBoxEditor';
import type { MediaFile } from '../types';

interface MediaViewerProps {
  file: MediaFile | null;
}

export function MediaViewer({ file }: MediaViewerProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  if (!file) {
    return (
      <div className="media-viewer media-viewer--empty">
        <ImagePlaceholderIcon />
        <p>ファイルを選択してください</p>
      </div>
    );
  }

  const src = convertFileSrc(file.path);

  if (file.media_type === 'image') {
    return (
      <div className="media-viewer">
        <img
          key={src}
          ref={imgRef}
          src={src}
          alt={file.name}
          className="media-viewer__image"
          draggable={false}
          onLoad={() => {
            if (imgRef.current) {
              setNaturalSize({
                width:  imgRef.current.naturalWidth,
                height: imgRef.current.naturalHeight,
              });
            }
          }}
        />
        {/* SVG の viewBox を自然サイズに合わせることで
            object-fit:contain の letterbox にも自動整合する */}
        {naturalSize.width > 0 && (
          <BoundingBoxEditor
            naturalWidth={naturalSize.width}
            naturalHeight={naturalSize.height}
          />
        )}
      </div>
    );
  }

  return (
    <div className="media-viewer">
      <video key={src} controls className="media-viewer__video">
        <source src={src} />
        この形式の動画は再生できません
      </video>
    </div>
  );
}

function ImagePlaceholderIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

import { useRef, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { BoundingBoxEditor } from './BoundingBoxEditor';
import { useStore } from '../store';
import type { MediaFile } from '../types';

interface MediaViewerProps {
  file: MediaFile | null;
}

export function MediaViewer({ file }: MediaViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const { annotationMode } = useStore();

  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);

  // Refs so the wheel handler closure never goes stale
  const zoomRef = useRef(zoom);
  const panRef = useRef({ x: panX, y: panY });
  zoomRef.current = zoom;
  panRef.current = { x: panX, y: panY };

  useEffect(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setNaturalSize({ width: 0, height: 0 });
  }, [file?.path]);

  // `0` キーによるズームリセット
  useEffect(() => {
    const handler = () => { setZoom(1); setPanX(0); setPanY(0); };
    window.addEventListener('viewer:reset-zoom', handler);
    return () => window.removeEventListener('viewer:reset-zoom', handler);
  }, []);

  // Non-passive wheel listener required to call preventDefault()
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const cur = zoomRef.current;
      const { x: px, y: py } = panRef.current;
      const newZoom = Math.max(0.1, Math.min(20, cur * factor));
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Keep the point under the cursor stationary
      setZoom(newZoom);
      setPanX(mx - (mx - px) * (newZoom / cur));
      setPanY(my - (my - py) * (newZoom / cur));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const panStartRef = useRef<{ px: number; py: number; panX: number; panY: number } | null>(null);
  const annotationModeRef = useRef(annotationMode);
  annotationModeRef.current = annotationMode;

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (annotationModeRef.current) return;
    panStartRef.current = {
      px: e.clientX, py: e.clientY,
      panX: panRef.current.x, panY: panRef.current.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsPanning(true);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panStartRef.current) return;
    setPanX(panStartRef.current.panX + (e.clientX - panStartRef.current.px));
    setPanY(panStartRef.current.panY + (e.clientY - panStartRef.current.py));
  }, []);

  const handlePointerUp = useCallback(() => {
    panStartRef.current = null;
    setIsPanning(false);
  }, []);

  if (!file) {
    return (
      <div className="media-viewer media-viewer--empty">
        <ImagePlaceholderIcon />
        <p>ファイルを選択してください</p>
      </div>
    );
  }

  const src = convertFileSrc(file.path);
  const cursor = annotationMode ? 'crosshair' : (isPanning ? 'grabbing' : 'grab');

  if (file.media_type === 'image') {
    return (
      <div
        ref={viewerRef}
        className="media-viewer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="media-viewer__canvas"
          style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, cursor }}
        >
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
                  width: imgRef.current.naturalWidth,
                  height: imgRef.current.naturalHeight,
                });
              }
            }}
          />
          {naturalSize.width > 0 && (
            <BoundingBoxEditor
              naturalWidth={naturalSize.width}
              naturalHeight={naturalSize.height}
            />
          )}
        </div>
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

import { useEffect, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { useViewFiles } from '../hooks/useViewFiles';

export function ViewModeLarge() {
  const viewImageIndex    = useStore(s => s.viewImageIndex);
  const setViewImageIndex = useStore(s => s.setViewImageIndex);
  const setViewSubMode    = useStore(s => s.setViewSubMode);

  const imageFiles = useViewFiles();
  const current    = imageFiles[viewImageIndex];
  const total      = imageFiles.length;
  const videoRef   = useRef<HTMLVideoElement>(null);

  const viewImageIndexRef = useRef(viewImageIndex);
  const totalRef          = useRef(total);
  viewImageIndexRef.current = viewImageIndex;
  totalRef.current          = total;

  const goBack = useCallback(() => setViewSubMode('grid'), [setViewSubMode]);
  const goPrev = useCallback(() => {
    if (viewImageIndex > 0) setViewImageIndex(viewImageIndex - 1);
  }, [viewImageIndex, setViewImageIndex]);
  const goNext = useCallback(() => {
    if (viewImageIndex < total - 1) setViewImageIndex(viewImageIndex + 1);
  }, [viewImageIndex, total, setViewImageIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const idx = viewImageIndexRef.current;
    const len = totalRef.current;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        if (idx > 0) setViewImageIndex(idx - 1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        if (idx < len - 1) setViewImageIndex(idx + 1);
        break;
      case 'Escape':
        e.preventDefault();
        setViewSubMode('grid');
        break;
    }
  }, [setViewImageIndex, setViewSubMode]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!current) return null;

  return (
    <div className="view-large">
      <button className="view-large__back" onClick={goBack}>
        ← グリッドに戻る
      </button>

      <div className="view-large__counter">
        {viewImageIndex + 1} / {total} — {current.name}
      </div>

      <button
        className="view-large__nav view-large__nav--prev"
        onClick={goPrev}
        disabled={viewImageIndex === 0}
        title="前の画像 (←)"
      >
        ‹
      </button>

      <div className="view-large__img-wrap">
        {current.media_type === 'video' ? (
          <video
            key={current.path}
            ref={videoRef}
            src={convertFileSrc(current.path)}
            controls
            autoPlay
            className="view-large__video"
            draggable={false}
          />
        ) : (
          <img
            src={convertFileSrc(current.path)}
            alt={current.name}
            className="view-large__img"
            draggable={false}
          />
        )}
      </div>

      <button
        className="view-large__nav view-large__nav--next"
        onClick={goNext}
        disabled={viewImageIndex === total - 1}
        title="次の画像 (→)"
      >
        ›
      </button>
    </div>
  );
}

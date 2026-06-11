import { useEffect, useRef, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { VideoThumb } from './VideoThumb';
import { useStore } from '../store';

export function ViewModeGrid() {
  const files             = useStore(s => s.files);
  const viewImageIndex    = useStore(s => s.viewImageIndex);
  const setViewImageIndex = useStore(s => s.setViewImageIndex);
  const openInLargeView   = useStore(s => s.openInLargeView);

  const viewFiles   = files.filter(f => f.media_type === 'image' || f.media_type === 'video');
  const gridRef     = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [viewImageIndex]);

  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  const getColCount = useCallback(() => {
    const el = gridRef.current;
    if (!el) return 1;
    const cols = getComputedStyle(el).gridTemplateColumns.split(' ').length;
    return Math.max(1, cols);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (viewFiles.length === 0) return;

    const cols = getColCount();
    let next = viewImageIndex;

    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); next = Math.min(viewImageIndex + 1, viewFiles.length - 1); break;
      case 'ArrowLeft':  e.preventDefault(); next = Math.max(viewImageIndex - 1, 0); break;
      case 'ArrowDown':  e.preventDefault(); next = Math.min(viewImageIndex + cols, viewFiles.length - 1); break;
      case 'ArrowUp':    e.preventDefault(); next = Math.max(viewImageIndex - cols, 0); break;
      case 'Home':       e.preventDefault(); next = 0; break;
      case 'End':        e.preventDefault(); next = viewFiles.length - 1; break;
      case 'Enter':      e.preventDefault(); openInLargeView(viewImageIndex); return;
      default: return;
    }

    setViewImageIndex(next);
  }, [viewImageIndex, viewFiles.length, getColCount, setViewImageIndex, openInLargeView]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (viewFiles.length === 0) {
    return (
      <div className="view-empty">
        <p>画像・動画ファイルがありません</p>
      </div>
    );
  }

  return (
    <div className="view-grid" ref={gridRef} tabIndex={0}>
      {viewFiles.map((file, idx) => (
        <div
          key={file.path}
          ref={idx === viewImageIndex ? selectedRef : undefined}
          className={`view-grid__cell${idx === viewImageIndex ? ' view-grid__cell--selected' : ''}`}
          onClick={() => setViewImageIndex(idx)}
          onDoubleClick={() => openInLargeView(idx)}
          title={file.name}
        >
          {file.media_type === 'video' ? (
            <VideoThumb path={file.path} className="view-grid__media" />
          ) : (
            <img
              src={convertFileSrc(file.path)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="view-grid__media"
            />
          )}
        </div>
      ))}
    </div>
  );
}

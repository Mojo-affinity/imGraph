import { useEffect, useRef, useCallback, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { VideoThumb } from './VideoThumb';
import { useStore } from '../store';
import { useViewFiles } from '../hooks/useViewFiles';

export function ViewModeGrid() {
  const viewImageIndex    = useStore(s => s.viewImageIndex);
  const setViewImageIndex = useStore(s => s.setViewImageIndex);
  const openInLargeView   = useStore(s => s.openInLargeView);

  const viewFiles   = useViewFiles();
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
    return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length);
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

  return (
    <div className="view-mode-wrapper">
      <TagFilterBar filteredCount={viewFiles.length} />

      {viewFiles.length === 0 ? (
        <div className="view-empty">
          <p>条件に一致するファイルがありません</p>
        </div>
      ) : (
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
      )}
    </div>
  );
}

// ─── タグフィルタバー ──────────────────────────────────────────

function TagFilterBar({ filteredCount }: { filteredCount: number }) {
  const files              = useStore(s => s.files);
  const metadata           = useStore(s => s.metadata);
  const viewTagFilter      = useStore(s => s.viewTagFilter);
  const viewTagFilterMode  = useStore(s => s.viewTagFilterMode);
  const setViewTagFilter   = useStore(s => s.setViewTagFilter);
  const setViewTagFilterMode = useStore(s => s.setViewTagFilterMode);

  // 全メディアファイルから使われているタグを収集
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const f of files) {
      if (f.media_type !== 'image' && f.media_type !== 'video') continue;
      for (const t of (metadata[f.path]?.tags ?? [])) tagSet.add(t);
    }
    return [...tagSet].sort();
  }, [files, metadata]);

  const totalCount = useMemo(
    () => files.filter(f => f.media_type === 'image' || f.media_type === 'video').length,
    [files]
  );

  if (allTags.length === 0) return null;

  const toggleTag = (tag: string) => {
    setViewTagFilter(
      viewTagFilter.includes(tag)
        ? viewTagFilter.filter(t => t !== tag)
        : [...viewTagFilter, tag]
    );
  };

  return (
    <div className="view-filter-bar">
      <span className="view-filter-bar__label">タグ</span>

      <div className="view-filter-bar__tags">
        {allTags.map(tag => {
          const active = viewTagFilter.includes(tag);
          return (
            <button
              key={tag}
              className={`view-filter-tag${active ? ' view-filter-tag--active' : ''}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
              {active && <span className="view-filter-tag__x">×</span>}
            </button>
          );
        })}
      </div>

      {viewTagFilter.length >= 2 && (
        <div className="view-filter-mode">
          <button
            className={`view-filter-mode__btn${viewTagFilterMode === 'or' ? ' view-filter-mode__btn--active' : ''}`}
            onClick={() => setViewTagFilterMode('or')}
          >OR</button>
          <button
            className={`view-filter-mode__btn${viewTagFilterMode === 'and' ? ' view-filter-mode__btn--active' : ''}`}
            onClick={() => setViewTagFilterMode('and')}
          >AND</button>
        </div>
      )}

      {viewTagFilter.length > 0 && (
        <button className="view-filter-bar__clear" onClick={() => setViewTagFilter([])}>
          クリア
        </button>
      )}

      <span className="view-filter-bar__count">
        {viewTagFilter.length > 0 ? `${filteredCount} / ${totalCount}` : `${totalCount}`} 件
      </span>
    </div>
  );
}

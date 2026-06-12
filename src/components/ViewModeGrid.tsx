import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { VideoThumb } from './VideoThumb';
import { useStore } from '../store';
import { useViewFiles } from '../hooks/useViewFiles';

const GAP = 3;
const MIN_CELL = 140;

export function ViewModeGrid() {
  const viewImageIndex    = useStore(s => s.viewImageIndex);
  const setViewImageIndex = useStore(s => s.setViewImageIndex);
  const openInLargeView   = useStore(s => s.openInLargeView);

  const viewFiles      = useViewFiles();
  const containerRef   = useRef<HTMLDivElement>(null);
  const selectedRef    = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(MIN_CELL);

  // ref で最新値を保持することで、キーボードハンドラーを安定させる（re-register なし）
  const viewImageIndexRef = useRef(viewImageIndex);
  const viewFilesLengthRef = useRef(viewFiles.length);
  const cellSizeRef = useRef(cellSize);
  viewImageIndexRef.current = viewImageIndex;
  viewFilesLengthRef.current = viewFiles.length;
  cellSizeRef.current = cellSize;

  // コンテナの実幅を監視して正確なセルサイズ(px)を計算
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w <= 0) return;
      const cols = Math.max(1, Math.floor(w / MIN_CELL));
      setCellSize(Math.floor((w - GAP * (cols - 1)) / cols));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [viewImageIndex]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // ref ベース: 常に最新値を参照するので deps は安定した関数のみ → リスナーは mount/unmount 時だけ
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const len = viewFilesLengthRef.current;
    if (len === 0) return;
    const idx = viewImageIndexRef.current;
    const w = containerRef.current?.getBoundingClientRect().width ?? 0;
    const cols = Math.max(1, Math.floor(w / (cellSizeRef.current + GAP)));
    let next = idx;

    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); next = Math.min(idx + 1, len - 1); break;
      case 'ArrowLeft':  e.preventDefault(); next = Math.max(idx - 1, 0); break;
      case 'ArrowDown':  e.preventDefault(); next = Math.min(idx + cols, len - 1); break;
      case 'ArrowUp':    e.preventDefault(); next = Math.max(idx - cols, 0); break;
      case 'Home':       e.preventDefault(); next = 0; break;
      case 'End':        e.preventDefault(); next = len - 1; break;
      case 'Enter':      e.preventDefault(); openInLargeView(idx); return;
      default: return;
    }

    setViewImageIndex(next);
  }, [setViewImageIndex, openInLargeView]);

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
        <div className="view-grid" ref={containerRef} tabIndex={0}>
          {viewFiles.map((file, idx) => (
            <div
              key={file.path}
              ref={idx === viewImageIndex ? selectedRef : undefined}
              className={`view-grid__cell${idx === viewImageIndex ? ' view-grid__cell--selected' : ''}`}
              style={{ width: cellSize, height: cellSize }}
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

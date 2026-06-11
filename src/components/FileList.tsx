import { useEffect, useRef, useState, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { VideoThumb } from './VideoThumb';
import type { MediaFile, MetadataMap } from '../types';

// ─── Data helpers ─────────────────────────────────────────────

interface GroupItem {
  file: MediaFile;
  globalIndex: number;
}

interface FileGroup {
  dirKey: string;    // 親ディレクトリの相対パス (ルートは "")
  dirName: string;   // 表示名 (最後のコンポーネント)
  dirParent: string; // 親より上のパス (曖昧さ排除用)
  items: GroupItem[];
}

function parentDirKey(relPath: string): string {
  const idx = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'));
  return idx >= 0 ? relPath.substring(0, idx) : '';
}

function groupFiles(files: MediaFile[]): FileGroup[] {
  const map = new Map<string, GroupItem[]>();
  files.forEach((file, globalIndex) => {
    const key = parentDirKey(file.rel_path);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ file, globalIndex });
  });

  return [...map.entries()].map(([dirKey, items]) => {
    if (dirKey === '') return { dirKey, dirName: '', dirParent: '', items };
    const parts = dirKey.split(/[/\\]/);
    return {
      dirKey,
      dirName: parts[parts.length - 1],
      dirParent: parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '',
      items,
    };
  });
}

// ─── Component ────────────────────────────────────────────────

interface FileListProps {
  files: MediaFile[];
  selectedIndex: number | null;
  metadata: MetadataMap;
  onSelect: (index: number) => void;
}

export function FileList({ files, selectedIndex, metadata, onSelect }: FileListProps) {
  const groups = useMemo(() => groupFiles(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const selectedRef = useRef<HTMLDivElement>(null);

  // ファイルが変わったら全グループを展開
  useEffect(() => {
    setExpanded(new Set(groups.map((g) => g.dirKey)));
  }, [groups]);

  // キーボード移動で選択が変わったとき、そのグループを自動展開
  useEffect(() => {
    if (selectedIndex === null) return;
    const file = files[selectedIndex];
    if (!file) return;
    const key = parentDirKey(file.rel_path);
    setExpanded((prev) => {
      if (prev.has(key)) return prev;
      return new Set([...prev, key]);
    });
  }, [selectedIndex, files]);

  // expanded が確定した後にスクロール
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, expanded]);

  if (files.length === 0) {
    return (
      <div className="file-list file-list--empty">
        <FolderEmptyIcon />
        <p>フォルダを開いてください</p>
      </div>
    );
  }

  const toggle = (dirKey: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirKey)) next.delete(dirKey);
      else next.add(dirKey);
      return next;
    });

  // グループが複数あるか、ルート外のグループがある場合のみヘッダー表示
  const showHeaders = groups.length > 1 || groups[0]?.dirKey !== '';

  return (
    <div className="file-list">
      {groups.map((group) => {
        const isOpen = expanded.has(group.dirKey);
        const label = group.dirKey === '' ? '(ルート)' : group.dirName;

        return (
          <div key={group.dirKey || '__root__'} className="file-group">
            {showHeaders && (
              <button
                className={`file-group__header${isOpen ? ' file-group__header--open' : ''}`}
                onClick={() => toggle(group.dirKey)}
              >
                <span className="file-group__arrow">{isOpen ? '▼' : '▶'}</span>
                <DirIcon />
                <span className="file-group__label">
                  {group.dirParent && (
                    <span className="file-group__parent">{group.dirParent}</span>
                  )}
                  {label}
                </span>
                <span className="file-group__count">{group.items.length}</span>
              </button>
            )}

            {isOpen &&
              group.items.map(({ file, globalIndex }) => {
                const meta = metadata[file.path];
                const isSelected = globalIndex === selectedIndex;
                return (
                  <div
                    key={file.path}
                    ref={isSelected ? selectedRef : undefined}
                    className={`file-item${isSelected ? ' file-item--selected' : ''}${showHeaders ? ' file-item--indented' : ''}`}
                    onClick={() => onSelect(globalIndex)}
                  >
                    <div className="file-item__thumb">
                      {file.media_type === 'image' ? (
                        <img
                          src={convertFileSrc(file.path)}
                          alt={file.name}
                          loading="lazy"
                          draggable={false}
                        />
                      ) : file.media_type === 'video' ? (
                        <VideoThumb path={file.path} className="file-item__thumb-video" />
                      ) : (
                        <VideoIcon />
                      )}
                    </div>
                    <div className="file-item__info">
                      <span className="file-item__name">{file.name}</span>
                      {meta && meta.rating > 0 && (
                        <span className="file-item__rating">
                          {'★'.repeat(meta.rating)}
                        </span>
                      )}
                      {meta && meta.tags.length > 0 && (
                        <span className="file-item__tags">
                          {meta.tags.slice(0, 2).join(', ')}
                          {meta.tags.length > 2 && '...'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────

function FolderEmptyIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25A2.25 2.25 0 0 0 4.5 16.5h15a2.25 2.25 0 0 0 2.25-2.25V9A2.25 2.25 0 0 0 19.5 6.75H12.75a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

function DirIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.7 }}>
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25z" />
    </svg>
  );
}

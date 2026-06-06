import { useEffect, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { MediaFile, MetadataMap } from '../types';

interface FileListProps {
  files: MediaFile[];
  selectedIndex: number | null;
  metadata: MetadataMap;
  onSelect: (index: number) => void;
}

export function FileList({ files, selectedIndex, metadata, onSelect }: FileListProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (files.length === 0) {
    return (
      <div className="file-list file-list--empty">
        <FolderEmptyIcon />
        <p>フォルダを開いてください</p>
      </div>
    );
  }

  return (
    <div className="file-list">
      {files.map((file, index) => {
        const meta = metadata[file.path];
        const isSelected = index === selectedIndex;
        return (
          <div
            key={file.path}
            ref={isSelected ? selectedRef : undefined}
            className={`file-item${isSelected ? ' file-item--selected' : ''}`}
            onClick={() => onSelect(index)}
          >
            <div className="file-item__thumb">
              {file.media_type === 'image' ? (
                <img
                  src={convertFileSrc(file.path)}
                  alt={file.name}
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <VideoIcon />
              )}
            </div>
            <div className="file-item__info">
              <span className="file-item__name">{file.name}</span>
              {meta && meta.rating > 0 && (
                <span className="file-item__rating">{'★'.repeat(meta.rating)}</span>
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
}

function FolderEmptyIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25A2.25 2.25 0 0 0 4.5 16.5h15a2.25 2.25 0 0 0 2.25-2.25V9A2.25 2.25 0 0 0 19.5 6.75H12.75a1.5 1.5 0 0 1-1.06-.44Z" />
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

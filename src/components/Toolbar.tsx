import { useState } from 'react';
import type { MediaFile } from '../types';

interface ToolbarProps {
  currentDir: string | null;
  fileCount: number;
  isScanning: boolean;
  selectedFile: MediaFile | null;
  boundingBoxCount: number;
  isSaving: boolean;
  onOpenDirectory: () => void;
  onSaveAnnotation: () => Promise<void>;
}

export function Toolbar({
  currentDir,
  fileCount,
  isScanning,
  selectedFile,
  boundingBoxCount,
  isSaving,
  onOpenDirectory,
  onSaveAnnotation,
}: ToolbarProps) {
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onSaveAnnotation();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const canSave = selectedFile?.media_type === 'image' && !isScanning && !isSaving;

  return (
    <div className="toolbar">
      <button
        className="toolbar__open-btn"
        onClick={onOpenDirectory}
        disabled={isScanning}
      >
        <FolderIcon />
        フォルダを開く
      </button>

      {currentDir && (
        <span className="toolbar__info">
          <span className="toolbar__path">{currentDir}</span>
          {isScanning ? (
            <span className="toolbar__scanning">
              <span className="toolbar__spinner" />
              スキャン中… {fileCount > 0 && `${fileCount} 件`}
            </span>
          ) : (
            <span className="toolbar__count">{fileCount} 件</span>
          )}
        </span>
      )}

      <div className="toolbar__spacer" />

      {selectedFile?.media_type === 'image' && (
        <button
          className={`toolbar__save-btn${saved ? ' toolbar__save-btn--saved' : ''}`}
          onClick={handleSave}
          disabled={!canSave}
          title={`YOLO フォーマットで保存 (${boundingBoxCount} ボックス)`}
        >
          {isSaving ? (
            <><span className="toolbar__spinner" />保存中…</>
          ) : saved ? (
            <><CheckIcon />保存済み</>
          ) : (
            <><SaveIcon />学習データとして保存</>
          )}
        </button>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

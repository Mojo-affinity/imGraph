import { useState, useRef, useEffect } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import type { MediaFile } from '../types';

interface ToolbarProps {
  currentDir: string | null;
  fileCount: number;
  isScanning: boolean;
  selectedFile: MediaFile | null;
  boundingBoxCount: number;
  isSaving: boolean;
  isInferring: boolean;
  onOpenDirectory: () => void;
  onSaveAnnotation: () => Promise<void>;
  onDetectObjects: () => void;
  onDetectFaces: () => void;
}

export function Toolbar({
  currentDir,
  fileCount,
  isScanning,
  selectedFile,
  boundingBoxCount,
  isSaving,
  isInferring,
  onOpenDirectory,
  onSaveAnnotation,
  onDetectObjects,
  onDetectFaces,
}: ToolbarProps) {
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onSaveAnnotation();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const isImage = selectedFile?.media_type === 'image';
  const canInfer = isImage && !isScanning && !isInferring;
  const canSave  = isImage && !isScanning && !isSaving;

  return (
    <div className="toolbar">
      {/* フォルダを開く */}
      <button
        className="toolbar__open-btn"
        onClick={onOpenDirectory}
        disabled={isScanning}
      >
        <FolderIcon />
        フォルダを開く
      </button>

      {/* パス・件数 */}
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

      {/* 推論ボタングループ */}
      {isImage && (
        <div className="toolbar__inference-group">
          <button
            className="toolbar__inference-btn"
            onClick={onDetectObjects}
            disabled={!canInfer}
            title="学習済みモデルで物体検出"
          >
            <BoxIcon />
            物体検出
          </button>

          {/* 顔検出 + 設定ギア */}
          <div className="toolbar__face-group">
            <button
              className="toolbar__inference-btn"
              onClick={onDetectFaces}
              disabled={!canInfer}
              title="顔・年齢を検出"
            >
              <FaceIcon />
              顔検出
            </button>
            <FaceModelSettings />
          </div>

          {isInferring && <span className="toolbar__spinner" />}
        </div>
      )}

      {/* 学習データとして保存 */}
      {isImage && (
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

// ─── 顔検出モデル設定パネル ────────────────────────────────────

function FaceModelSettings() {
  const { faceScriptPath, faceModelDir, saveModelConfig } = useStore();
  const [isOpen, setOpen] = useState(false);
  const [scriptPath, setScriptPath] = useState(faceScriptPath);
  const [modelDir, setModelDir] = useState(faceModelDir);
  const panelRef = useRef<HTMLDivElement>(null);

  // ストアが更新されたら入力欄も同期
  useEffect(() => { setScriptPath(faceScriptPath); }, [faceScriptPath]);
  useEffect(() => { setModelDir(faceModelDir); }, [faceModelDir]);

  // パネル外クリックで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const browseScript = async () => {
    const path = await openDialog({ multiple: false, directory: false });
    if (typeof path === 'string') setScriptPath(path);
  };

  const browseModelDir = async () => {
    const path = await openDialog({ multiple: false, directory: true });
    if (typeof path === 'string') setModelDir(path);
  };

  const handleSave = async () => {
    await saveModelConfig(scriptPath, modelDir);
    setOpen(false);
  };

  return (
    <div className="face-model-settings" ref={panelRef}>
      <button
        className={`toolbar__gear-btn${isOpen ? ' toolbar__gear-btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="顔検出モデル設定"
      >
        <GearIcon />
      </button>

      {isOpen && (
        <div className="face-model-panel">
          <p className="face-model-panel__title">顔検出設定</p>

          <label className="face-model-panel__label">
            Python スクリプト
            <span className="face-model-panel__hint">（detect_faces.py）</span>
          </label>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={scriptPath}
              onChange={e => setScriptPath(e.target.value)}
              placeholder="scripts/detect_faces.py のパス"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseScript}>
              <FolderIcon />
            </button>
          </div>

          <label className="face-model-panel__label">
            モデルディレクトリ
            <span className="face-model-panel__hint">（空 = ~/.insightface）</span>
          </label>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={modelDir}
              onChange={e => setModelDir(e.target.value)}
              placeholder="省略可（デフォルト: ~/.insightface）"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseModelDir}>
              <FolderIcon />
            </button>
          </div>

          <div className="face-model-panel__actions">
            <button className="face-model-panel__save" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── アイコン ─────────────────────────────────────────────────

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function FaceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path strokeLinecap="round" d="M8 14s1.5 2 4 2 4-2 4-2" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

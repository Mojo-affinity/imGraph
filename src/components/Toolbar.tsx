import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  onDetectNudenet: () => void;
  onDetectNsfw: () => void;
  onBatchNudenet: () => void;
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
  onDetectNudenet,
  onDetectNsfw,
  onBatchNudenet,
}: ToolbarProps) {
  const [saved, setSaved] = useState(false);
  const viewMode = useStore(s => s.viewMode);

  const handleSave = async () => {
    await onSaveAnnotation();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const isImage  = selectedFile?.media_type === 'image';
  const canInfer = isImage && !isScanning && !isInferring;
  const canSave  = isImage && !isScanning && !isSaving;
  const isAnnotate = viewMode === 'annotate';

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

      {/* 一括部位推定→保存（アノテーションモード時のみ） */}
      {isAnnotate && currentDir && (
        <BatchNudenetButton onBatchNudenet={onBatchNudenet} isScanning={isScanning} />
      )}

      {/* ログウィンドウトグル */}
      <LogToggleButton />

      {/* ビューモード切替 */}
      {currentDir && <ViewModeToggle />}

      {/* アノテーションモード切替（アノテーションモード・画像選択時のみ） */}
      {isAnnotate && isImage && <AnnotationModeToggle />}

      {/* 推論ボタングループ（アノテーションモード・画像選択時のみ） */}
      {isAnnotate && isImage && (
        <div className="toolbar__inference-group">
          <div className="toolbar__face-group">
            <button
              className="toolbar__inference-btn"
              onClick={onDetectObjects}
              disabled={!canInfer}
              title="学習済みモデルで物体検出"
            >
              <BoxIcon />
              物体検出
            </button>
            <ObjectModelSettings />
          </div>

          {/* NSFW 判定 + 設定ギア */}
          <div className="toolbar__face-group">
            <NsfwButton onDetectNsfw={onDetectNsfw} canInfer={canInfer} />
            <NsfwModelSettings />
          </div>

          {/* 部位検出 + 設定ギア */}
          <div className="toolbar__face-group">
            <button
              className="toolbar__inference-btn"
              onClick={onDetectNudenet}
              disabled={!canInfer}
              title="NudeNet で部位検出"
            >
              <BodyIcon />
              部位検出
            </button>
            <NudeNetModelSettings />
          </div>

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

      {/* 学習データとして保存（アノテーションモード・画像選択時のみ） */}
      {isAnnotate && isImage && (
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

// ─── ビューモード切替ボタン ───────────────────────────────────

function ViewModeToggle() {
  const viewMode   = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  const isView = viewMode === 'view';

  return (
    <button
      className={`toolbar__view-btn${isView ? ' toolbar__view-btn--active' : ''}`}
      onClick={() => setViewMode(isView ? 'annotate' : 'view')}
      title={isView ? 'アノテーションモードに戻る' : '画像ビューモード'}
    >
      <GridIcon />
      ビュー
    </button>
  );
}

// ─── ログトグルボタン ─────────────────────────────────────────

function LogToggleButton() {
  const appLogs       = useStore(s => s.appLogs);
  const showLogWindow = useStore(s => s.showLogWindow);
  const toggleLogWindow = useStore(s => s.toggleLogWindow);

  const errorCount = appLogs.filter(l => l.level === 'error').length;
  const hasNew = appLogs.length > 0;

  return (
    <button
      className={`toolbar__log-btn${showLogWindow ? ' toolbar__log-btn--active' : ''}`}
      onClick={toggleLogWindow}
      title="ログウィンドウ"
    >
      <TerminalIcon />
      ログ
      {errorCount > 0 ? (
        <span className="toolbar__log-badge toolbar__log-badge--error">{errorCount}</span>
      ) : hasNew ? (
        <span className="toolbar__log-badge">{appLogs.length}</span>
      ) : null}
    </button>
  );
}

// ─── アノテーションモード切替 ─────────────────────────────────

function AnnotationModeToggle() {
  const { annotationMode, toggleAnnotationMode } = useStore();
  return (
    <button
      className={`toolbar__annotation-btn${annotationMode ? ' toolbar__annotation-btn--active' : ''}`}
      onClick={toggleAnnotationMode}
      title={annotationMode
        ? 'アノテーションモード ON — クリックで OFF（パン/ズームのみ）'
        : 'アノテーションモード OFF — クリックで ON（BB 作成・編集）'}
    >
      <PencilIcon />
      アノテーション
    </button>
  );
}

// ─── 物体検出モデル設定パネル ───────────────────────────────────

function ObjectModelSettings() {
  const { objectModelPath, objectClassNamesPath, objectConfThreshold, saveObjectModelConfig } = useStore();
  const [isOpen, setOpen] = useState(false);
  const [modelPath, setModelPath] = useState(objectModelPath);
  const [classNamesPath, setClassNamesPath] = useState(objectClassNamesPath);
  const [confThreshold, setConfThreshold] = useState(objectConfThreshold);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setModelPath(objectModelPath); }, [objectModelPath]);
  useEffect(() => { setClassNamesPath(objectClassNamesPath); }, [objectClassNamesPath]);
  useEffect(() => { setConfThreshold(objectConfThreshold); }, [objectConfThreshold]);

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

  const browseModel = async () => {
    const path = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'ONNX Model', extensions: ['onnx'] }],
    });
    if (typeof path === 'string') setModelPath(path);
  };

  const browseClassNames = async () => {
    const path = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'Text File', extensions: ['txt'] }],
    });
    if (typeof path === 'string') setClassNamesPath(path);
  };

  const handleSave = async () => {
    await saveObjectModelConfig(modelPath, classNamesPath, confThreshold);
    setOpen(false);
  };

  return (
    <div className="face-model-settings" ref={panelRef}>
      <button
        className={`toolbar__gear-btn${isOpen ? ' toolbar__gear-btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="物体検出モデル設定"
      >
        <GearIcon />
      </button>

      {isOpen && (
        <div className="face-model-panel">
          <p className="face-model-panel__title">物体検出設定</p>

          <label className="face-model-panel__label">
            ONNX モデル
            <span className="face-model-panel__hint">（YOLOv8 ONNX）</span>
          </label>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={modelPath}
              onChange={e => setModelPath(e.target.value)}
              placeholder="best.onnx のパス"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseModel}>
              <FolderIcon />
            </button>
          </div>

          <label className="face-model-panel__label">
            クラス名ファイル
            <span className="face-model-panel__hint">（空 = class_0, class_1…）</span>
          </label>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={classNamesPath}
              onChange={e => setClassNamesPath(e.target.value)}
              placeholder="classes.txt のパス（省略可）"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseClassNames}>
              <FolderIcon />
            </button>
          </div>

          <label className="face-model-panel__label">
            信頼度閾値: <strong>{confThreshold.toFixed(2)}</strong>
            <span className="face-model-panel__hint">（推奨: 0.20〜0.35）</span>
          </label>
          <input
            className="nudenet-conf-slider"
            type="range"
            min={0.05} max={0.75} step={0.05}
            value={confThreshold}
            onChange={e => setConfThreshold(Number(e.target.value))}
          />

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

// ─── 顔検出モデル設定パネル ────────────────────────────────────

function FaceModelSettings() {
  const {
    faceScriptPath, faceModelDir, saveModelConfig,
    faceDetModelPath, faceGenderageModelPath, saveFaceOnnxConfig,
  } = useStore();
  const [isOpen, setOpen] = useState(false);
  const [scriptPath, setScriptPath] = useState(faceScriptPath);
  const [modelDir, setModelDir] = useState(faceModelDir);
  const [detPath, setDetPath] = useState(faceDetModelPath);
  const [gaPath, setGaPath] = useState(faceGenderageModelPath);
  const [autoFinding, setAutoFinding] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setScriptPath(faceScriptPath); }, [faceScriptPath]);
  useEffect(() => { setModelDir(faceModelDir); }, [faceModelDir]);
  useEffect(() => { setDetPath(faceDetModelPath); }, [faceDetModelPath]);
  useEffect(() => { setGaPath(faceGenderageModelPath); }, [faceGenderageModelPath]);

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
  const browseDet = async () => {
    const path = await openDialog({
      multiple: false, directory: false,
      filters: [{ name: 'ONNX Model', extensions: ['onnx'] }],
    });
    if (typeof path === 'string') setDetPath(path);
  };
  const browseGa = async () => {
    const path = await openDialog({
      multiple: false, directory: false,
      filters: [{ name: 'ONNX Model', extensions: ['onnx'] }],
    });
    if (typeof path === 'string') setGaPath(path);
  };

  const handleAutoFind = async () => {
    setAutoFinding(true);
    try {
      const found = await invoke<string | null>('find_insightface_genderage');
      if (found) setGaPath(found);
    } finally {
      setAutoFinding(false);
    }
  };

  const handleSaveOnnx = async () => {
    await saveFaceOnnxConfig(detPath, gaPath);
    setOpen(false);
  };
  const handleSavePython = async () => {
    await saveModelConfig(scriptPath, modelDir);
    setOpen(false);
  };

  const useOnnx      = detPath.trim() !== '';
  const useGenderage = gaPath.trim() !== '';
  const standaloneGa = !useOnnx && useGenderage;

  return (
    <div className="face-model-settings" ref={panelRef}>
      <button
        className={`toolbar__gear-btn${isOpen ? ' toolbar__gear-btn--active' : ''}${(useOnnx || standaloneGa) ? ' toolbar__gear-btn--onnx' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={standaloneGa
          ? '顔検出設定 (age-gender 単体モード)'
          : useOnnx
            ? `顔検出設定 (ONNX${useGenderage ? ' + 年齢推定' : '・顔検出のみ'})`
            : '顔検出設定 (Python モード)'}
      >
        <GearIcon />
      </button>

      {isOpen && (
        <div className="face-model-panel face-model-panel--wide">
          <p className="face-model-panel__title">顔検出設定</p>

          {/* ── Rust ONNX モード ── */}
          <p className="face-model-panel__section">
            Rust ONNX モード
            {useOnnx && (
              <span className="face-model-panel__active-tag">
                {useGenderage ? '顔検出+年齢推定' : '顔検出のみ'}
              </span>
            )}
            {standaloneGa && (
              <span className="face-model-panel__active-tag">age-gender 単体</span>
            )}
          </p>

          <label className="face-model-panel__label">
            顔検出モデル
            <span className="face-model-panel__hint">（YOLOv8-face .onnx）</span>
          </label>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={detPath}
              onChange={e => setDetPath(e.target.value)}
              placeholder="yolov8n-face.onnx のパス"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseDet} title="参照">
              <FolderIcon />
            </button>
          </div>

          <label className="face-model-panel__label">
            年齢・性別モデル
            <span className="face-model-panel__hint">（任意 — 単体利用も可）</span>
          </label>
          <p className="face-model-panel__model-note">
            対応: genderage.onnx / age-gender-prediction-ONNX / MobileNetV2 age regression<br />
            ※ 顔検出モデル未設定 + 年齢モデル設定 → 画像全体に直接適用（単体モード）
          </p>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={gaPath}
              onChange={e => setGaPath(e.target.value)}
              placeholder="genderage.onnx または age_gender.onnx のパス"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseGa} title="参照">
              <FolderIcon />
            </button>
          </div>
          <div className="face-model-panel__actions">
            <button
              className="face-model-panel__auto"
              onClick={handleAutoFind}
              disabled={autoFinding}
              title="~/.insightface から genderage.onnx を自動検索"
            >
              {autoFinding ? '検索中…' : '自動検索'}
            </button>
            <button className="face-model-panel__save" onClick={handleSaveOnnx}>
              保存
            </button>
          </div>

          <hr className="face-model-panel__hr" />

          {/* ── Python fallback ── */}
          <p className="face-model-panel__section">
            Python フォールバック
            {!useOnnx && <span className="face-model-panel__active-tag">使用中</span>}
            {useOnnx && <span className="face-model-panel__hint" style={{marginLeft:6}}>（det モデル未設定時のみ）</span>}
          </p>

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
            <button className="face-model-panel__save" onClick={handleSavePython}>
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NSFW 判定ボタン ──────────────────────────────────────────

function NsfwButton({ onDetectNsfw, canInfer }: { onDetectNsfw: () => void; canInfer: boolean }) {
  const isClassifyingNsfw = useStore(s => s.isClassifyingNsfw);
  return (
    <button
      className="toolbar__inference-btn"
      onClick={onDetectNsfw}
      disabled={!canInfer || isClassifyingNsfw}
      title="NSFW 画像判定"
    >
      {isClassifyingNsfw ? <><span className="toolbar__spinner" />判定中…</> : <><ShieldIcon />NSFW 判定</>}
    </button>
  );
}

// ─── NSFW 設定パネル ──────────────────────────────────────────

function NsfwModelSettings() {
  const { nsfwModelPath, nsfwClassNamesPath, saveNsfwConfig } = useStore();
  const [isOpen, setOpen] = useState(false);
  const [modelPath, setModelPath] = useState(nsfwModelPath);
  const [classNamesPath, setClassNamesPath] = useState(nsfwClassNamesPath);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setModelPath(nsfwModelPath); }, [nsfwModelPath]);
  useEffect(() => { setClassNamesPath(nsfwClassNamesPath); }, [nsfwClassNamesPath]);

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

  const browseModel = async () => {
    const path = await openDialog({
      multiple: false, directory: false,
      filters: [{ name: 'ONNX Model', extensions: ['onnx'] }],
    });
    if (typeof path === 'string') setModelPath(path);
  };

  const browseClassNames = async () => {
    const path = await openDialog({
      multiple: false, directory: false,
      filters: [{ name: 'Text File', extensions: ['txt'] }],
    });
    if (typeof path === 'string') setClassNamesPath(path);
  };

  const handleSave = async () => {
    await saveNsfwConfig(modelPath, classNamesPath);
    setOpen(false);
  };

  return (
    <div className="face-model-settings" ref={panelRef}>
      <button
        className={`toolbar__gear-btn${isOpen ? ' toolbar__gear-btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="NSFW 設定"
      >
        <GearIcon />
      </button>

      {isOpen && (
        <div className="face-model-panel">
          <p className="face-model-panel__title">NSFW 判定設定</p>
          <p className="face-model-panel__model-note">
            対応: [1,2] binary / [1,1] sigmoid / multi-class (classes.txt でキーワード判定)
          </p>

          <label className="face-model-panel__label">
            ONNX モデル
            <span className="face-model-panel__hint">（224×224 分類器）</span>
          </label>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={modelPath}
              onChange={e => setModelPath(e.target.value)}
              placeholder="nsfw_model.onnx のパス"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseModel}>
              <FolderIcon />
            </button>
          </div>

          <label className="face-model-panel__label">
            クラス名ファイル
            <span className="face-model-panel__hint">（任意 — binary モデルは不要）</span>
          </label>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={classNamesPath}
              onChange={e => setClassNamesPath(e.target.value)}
              placeholder="classes.txt のパス（省略可）"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseClassNames}>
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

// ─── NudeNet 設定パネル ────────────────────────────────────────

function NudeNetModelSettings() {
  const { nudenetModelPath, nudenetConfThreshold, saveNudenetConfig } = useStore();
  const [isOpen, setOpen] = useState(false);
  const [modelPath, setModelPath] = useState(nudenetModelPath);
  const [confThreshold, setConfThreshold] = useState(nudenetConfThreshold);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setModelPath(nudenetModelPath); }, [nudenetModelPath]);
  useEffect(() => { setConfThreshold(nudenetConfThreshold); }, [nudenetConfThreshold]);

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

  const browseModel = async () => {
    const path = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'ONNX Model', extensions: ['onnx'] }],
    });
    if (typeof path === 'string') setModelPath(path);
  };

  const handleSave = async () => {
    await saveNudenetConfig(modelPath, confThreshold);
    setOpen(false);
  };

  return (
    <div className="face-model-settings" ref={panelRef}>
      <button
        className={`toolbar__gear-btn${isOpen ? ' toolbar__gear-btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="NudeNet 設定"
      >
        <GearIcon />
      </button>

      {isOpen && (
        <div className="face-model-panel">
          <p className="face-model-panel__title">部位検出設定（NudeNet）</p>

          <label className="face-model-panel__label">
            ONNX モデル
            <span className="face-model-panel__hint">（640m.onnx）</span>
          </label>
          <div className="face-model-panel__row">
            <input
              className="face-model-panel__input"
              value={modelPath}
              onChange={e => setModelPath(e.target.value)}
              placeholder="640m.onnx のパス"
              onKeyDown={e => e.stopPropagation()}
            />
            <button className="face-model-panel__browse" onClick={browseModel}>
              <FolderIcon />
            </button>
          </div>

          <label className="face-model-panel__label">
            信頼度閾値: <strong>{confThreshold.toFixed(2)}</strong>
            <span className="face-model-panel__hint">（推奨: 0.10〜0.25）</span>
          </label>
          <input
            className="nudenet-conf-slider"
            type="range"
            min={0.05} max={0.50} step={0.05}
            value={confThreshold}
            onChange={e => setConfThreshold(Number(e.target.value))}
          />

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

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function BodyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="5" r="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v6m0 0-3 5m3-5 3 5M9 11h6" />
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

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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

function TerminalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

// ─── 一括部位推定ボタン ────────────────────────────────────────

function BatchNudenetButton({ onBatchNudenet, isScanning }: { onBatchNudenet: () => void; isScanning: boolean }) {
  const isBatchNudenet       = useStore(s => s.isBatchNudenet);
  const batchNudenetProgress = useStore(s => s.batchNudenetProgress);
  const nudenetModelPath     = useStore(s => s.nudenetModelPath);
  const files                = useStore(s => s.files);
  const imageCount = files.filter(f => f.media_type === 'image').length;

  const disabled = isBatchNudenet || isScanning || !nudenetModelPath || imageCount === 0;

  if (isBatchNudenet && batchNudenetProgress) {
    return (
      <button className="toolbar__batch-btn toolbar__batch-btn--running" disabled>
        <span className="toolbar__spinner" />
        {batchNudenetProgress.done}/{batchNudenetProgress.total} 処理中…
      </button>
    );
  }

  return (
    <button
      className="toolbar__batch-btn"
      onClick={onBatchNudenet}
      disabled={disabled}
      title={
        !nudenetModelPath
          ? 'NudeNet モデルを設定してください'
          : imageCount === 0
            ? '画像ファイルがありません'
            : `${imageCount}枚すべてに部位推定を実行して学習データ保存`
      }
    >
      <BatchIcon />
      全画像 部位推定→保存
    </button>
  );
}

function BatchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import type { MediaMetadata } from '../types';

// ─── 検出結果リスト ────────────────────────────────────────────

function DetectionList() {
  const {
    boundingBoxes, selectedBoxId, setSelectedBoxId,
    removeBoundingBox, isInferring, inferenceMode,
  } = useStore();

  if (isInferring) {
    return (
      <section className="metadata-section">
        <h4 className="metadata-section__title">検出結果</h4>
        <div className="detection-loading">
          <span className="toolbar__spinner" />
          推論中…
        </div>
      </section>
    );
  }

  if (inferenceMode === 'none' && boundingBoxes.length === 0) return null;

  const modeLabel = inferenceMode === 'face' ? '顔検出' : inferenceMode === 'object' ? '物体検出' : '';

  return (
    <section className="metadata-section">
      <h4 className="metadata-section__title">
        検出結果
        {modeLabel && <span className="detection-mode">({modeLabel})</span>}
        <span className="detection-badge">{boundingBoxes.length}</span>
      </h4>

      {boundingBoxes.length === 0 ? (
        <p className="detection-empty">検出されませんでした</p>
      ) : (
        <div className="detection-list">
          {boundingBoxes.map((box) => (
            <div
              key={box.id}
              className={`detection-item${box.id === selectedBoxId ? ' detection-item--selected' : ''}`}
              onClick={() => setSelectedBoxId(box.id === selectedBoxId ? null : box.id)}
            >
              <span className="detection-item__label">{box.label}</span>
              {box.age != null && (
                <span className="detection-item__age">{box.age}歳</span>
              )}
              <span className="detection-item__conf">
                {Math.round(box.confidence * 100)}%
              </span>
              <button
                className="detection-item__del"
                title="削除"
                onClick={(e) => { e.stopPropagation(); removeBoundingBox(box.id); }}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface MetadataPanelProps {
  fileName: string | null;
  metadata: MediaMetadata | null;
  onUpdate: (update: Partial<MediaMetadata>) => void;
}

export function MetadataPanel({ fileName, metadata, onUpdate }: MetadataPanelProps) {
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    setTagInput('');
  }, [fileName]);

  if (!metadata || !fileName) {
    return (
      <div className="metadata-panel">
        <DetectionList />
        <TrainingSection />
      </div>
    );
  }

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || metadata.tags.includes(tag)) { setTagInput(''); return; }
    onUpdate({ tags: [...metadata.tags, tag] });
    setTagInput('');
  };

  const removeTag = (tag: string) => onUpdate({ tags: metadata.tags.filter((t) => t !== tag) });

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
  };

  const setRating = (star: number) =>
    onUpdate({ rating: star === metadata.rating ? 0 : star });

  return (
    <div className="metadata-panel">
      <div className="metadata-panel__header">
        <span className="metadata-panel__filename">{fileName}</span>
      </div>

      <section className="metadata-section">
        <h4 className="metadata-section__title">評価</h4>
        <div className="rating">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              className={`rating__star${star <= metadata.rating ? ' rating__star--active' : ''}`}
              onClick={() => setRating(star)}
              title={`${star}点`}
            >★</button>
          ))}
          {metadata.rating > 0 && (
            <span className="rating__label">{metadata.rating} / 5</span>
          )}
        </div>
      </section>

      <section className="metadata-section">
        <h4 className="metadata-section__title">タグ</h4>
        <div className="tag-list">
          {metadata.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
              <button className="tag__remove" onClick={() => removeTag(tag)} title="削除">×</button>
            </span>
          ))}
        </div>
        <div className="tag-input">
          <input
            type="text" value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="タグを追加… (Enter)"
          />
          <button onClick={addTag} disabled={!tagInput.trim()}>追加</button>
        </div>
      </section>

      <DetectionList />
      <TrainingSection />
    </div>
  );
}

// ─── 学習セクション ────────────────────────────────────────────

function TrainingSection() {
  const { currentDir, isTraining, trainingLogs, startTraining } = useStore();
  const [scriptPath, setScriptPath] = useState('');
  const [datasetPath, setDatasetPath] = useState(currentDir ?? '');
  const [extraArgs, setExtraArgs] = useState('');
  const [open_, setOpen] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // currentDir が変わったらデータセットパスを自動更新
  useEffect(() => {
    if (currentDir) setDatasetPath(currentDir);
  }, [currentDir]);

  // ログ末尾に自動スクロール
  useEffect(() => {
    if (isTraining) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [trainingLogs.length, isTraining]);

  const pickScript = async () => {
    const path = await open({ multiple: false, directory: false, filters: [{ name: 'Python', extensions: ['py'] }] });
    if (path && typeof path === 'string') setScriptPath(path);
  };

  const pickDataset = async () => {
    const path = await open({ multiple: false, directory: true });
    if (path && typeof path === 'string') setDatasetPath(path);
  };

  const handleStart = () => {
    if (!scriptPath || !datasetPath) return;
    const args = extraArgs.trim() ? extraArgs.trim().split(/\s+/) : [];
    startTraining(scriptPath, datasetPath, args);
  };

  const hasLogs = trainingLogs.length > 0;

  return (
    <section className="metadata-section training-section">
      <button
        className="training-section__toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`training-section__arrow${open_ ? ' training-section__arrow--open' : ''}`}>▶</span>
        <span className="metadata-section__title" style={{ margin: 0 }}>学習</span>
        {isTraining && <span className="toolbar__spinner" style={{ marginLeft: 8 }} />}
        {hasLogs && !isTraining && <span className="training-section__badge">{trainingLogs.length}</span>}
      </button>

      {open_ && (
        <div className="training-config">
          {/* スクリプトパス */}
          <label className="training-config__label">学習スクリプト</label>
          <div className="training-config__row">
            <input
              className="training-config__input"
              type="text" value={scriptPath}
              onChange={(e) => setScriptPath(e.target.value)}
              placeholder="train.py のパス"
              disabled={isTraining}
            />
            <button className="training-config__pick" onClick={pickScript} disabled={isTraining} title="ファイルを選択">…</button>
          </div>

          {/* データセットパス */}
          <label className="training-config__label">データセット</label>
          <div className="training-config__row">
            <input
              className="training-config__input"
              type="text" value={datasetPath}
              onChange={(e) => setDatasetPath(e.target.value)}
              placeholder="データセットディレクトリ"
              disabled={isTraining}
            />
            <button className="training-config__pick" onClick={pickDataset} disabled={isTraining} title="フォルダを選択">…</button>
          </div>

          {/* 追加引数 */}
          <label className="training-config__label">追加引数 (任意)</label>
          <input
            className="training-config__input"
            type="text" value={extraArgs}
            onChange={(e) => setExtraArgs(e.target.value)}
            placeholder="--epochs 100 --batch-size 16"
            disabled={isTraining}
          />

          {/* 開始ボタン */}
          <button
            className={`training-config__start${isTraining ? ' training-config__start--running' : ''}`}
            onClick={handleStart}
            disabled={isTraining || !scriptPath || !datasetPath}
          >
            {isTraining
              ? <><span className="toolbar__spinner" />学習中…</>
              : '▶ 学習を開始'}
          </button>

          {/* ログ表示 */}
          {hasLogs && (
            <div className="training-log">
              {trainingLogs.map((line, i) => (
                <div
                  key={i}
                  className={`training-log__line${line.startsWith('[ERR]') ? ' training-log__line--err' : line.startsWith('✓') ? ' training-log__line--ok' : ''}`}
                >
                  {line}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

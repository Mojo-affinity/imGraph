import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import type { MediaMetadata } from '../types';

// ─── 検出結果リスト ────────────────────────────────────────────

// 選択中ボックスのラベルをインライン編集するコンポーネント
function LabelInput({ id, label }: { id: string; label: string }) {
  const { updateBoundingBox } = useStore();
  const [value, setValue] = useState(label);

  // SVG 側で変更された場合に同期
  useEffect(() => { setValue(label); }, [label]);

  const commit = (v: string) => {
    const trimmed = v.trim() || label; // 空文字は元に戻す
    setValue(trimmed);
    if (trimmed !== label) updateBoundingBox(id, { label: trimmed });
  };

  return (
    <input
      className="detection-item__label-input"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setValue(label); e.currentTarget.blur(); }
      }}
      title="Enter で確定 / Esc でキャンセル"
    />
  );
}

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
          {boundingBoxes.map((box) => {
            const sel = box.id === selectedBoxId;
            return (
              <div
                key={box.id}
                className={`detection-item${sel ? ' detection-item--selected' : ''}`}
                onClick={() => setSelectedBoxId(sel ? null : box.id)}
              >
                {sel ? (
                  <LabelInput id={box.id} label={box.label} />
                ) : (
                  <span className="detection-item__label">{box.label}</span>
                )}
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
            );
          })}
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

// ─── データセット生成パネル ────────────────────────────────────

function DatasetGenPanel({
  onGenerated,
}: {
  onGenerated: (yamlPath: string) => void;
}) {
  const { currentDir, isGeneratingDataset, lastDatasetInfo, generateDataset } = useStore();
  const [outputDir, setOutputDir] = useState('');
  const [valRatio, setValRatio] = useState(20); // %
  const [genError, setGenError] = useState<string | null>(null);

  // currentDir が変わったら出力先をデフォルト設定
  useEffect(() => {
    if (currentDir) setOutputDir(currentDir + '/dataset');
  }, [currentDir]);

  const pickOutputDir = async () => {
    const path = await open({ multiple: false, directory: true });
    if (path && typeof path === 'string') setOutputDir(path);
  };

  const handleGenerate = async () => {
    if (!currentDir || !outputDir) return;
    setGenError(null);
    try {
      const info = await generateDataset(currentDir, outputDir, valRatio / 100);
      onGenerated(info.yaml_path);
    } catch (e) {
      setGenError(String(e));
    }
  };

  return (
    <div className="dataset-gen-panel">
      <p className="dataset-gen-panel__title">データセット構造を生成</p>
      <p className="dataset-gen-panel__hint">
        アノテーション済み画像を train / val に分割し、<br />
        dataset.yaml を作成します。
      </p>

      <label className="training-config__label">出力先フォルダ</label>
      <div className="training-config__row">
        <input
          className="training-config__input"
          value={outputDir}
          onChange={e => setOutputDir(e.target.value)}
          placeholder="dataset フォルダのパス"
          disabled={isGeneratingDataset}
          onKeyDown={e => e.stopPropagation()}
        />
        <button
          className="training-config__pick"
          onClick={pickOutputDir}
          disabled={isGeneratingDataset}
          title="フォルダを選択"
        >…</button>
      </div>

      <label className="training-config__label">
        Val 割合: <strong>{valRatio}%</strong>
        <span className="dataset-gen-panel__sub">（残り {100 - valRatio}% が Train）</span>
      </label>
      <input
        className="dataset-gen-panel__slider"
        type="range"
        min={5} max={40} step={5}
        value={valRatio}
        onChange={e => setValRatio(Number(e.target.value))}
        disabled={isGeneratingDataset}
      />

      {genError && (
        <p className="dataset-gen-panel__error">{genError}</p>
      )}

      {lastDatasetInfo && !genError && (
        <div className="dataset-gen-panel__result">
          <span className="dataset-gen-panel__result-ok">✓ 生成完了</span>
          <span>Train <strong>{lastDatasetInfo.train_count}</strong></span>
          <span>Val <strong>{lastDatasetInfo.val_count}</strong></span>
          <span>{lastDatasetInfo.class_names.length} クラス</span>
        </div>
      )}

      <button
        className="training-config__start"
        onClick={handleGenerate}
        disabled={isGeneratingDataset || !currentDir || !outputDir}
      >
        {isGeneratingDataset
          ? <><span className="toolbar__spinner" />生成中…</>
          : '⚙ データセットを生成'}
      </button>
    </div>
  );
}

// ─── 学習セクション ────────────────────────────────────────────

function TrainingSection() {
  const { isTraining, trainingLogs, startTraining, bundledTrainPy } = useStore();
  const [scriptPath, setScriptPath] = useState('');
  const [datasetPath, setDatasetPath] = useState('');

  // バンドル済み train.py が取得できたらデフォルト入力
  useEffect(() => {
    if (bundledTrainPy && !scriptPath) setScriptPath(bundledTrainPy);
  }, [bundledTrainPy]);
  const [extraArgs, setExtraArgs] = useState('');
  const [open_, setOpen] = useState(false);
  const [showGenPanel, setShowGenPanel] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ログ末尾に自動スクロール
  useEffect(() => {
    if (isTraining) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [trainingLogs.length, isTraining]);

  const pickScript = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Python', extensions: ['py'] }],
    });
    if (path && typeof path === 'string') setScriptPath(path);
  };

  const pickDataset = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    });
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
          {/* ── B-1: データセット生成パネル ── */}
          <button
            className={`dataset-gen-toggle${showGenPanel ? ' dataset-gen-toggle--open' : ''}`}
            onClick={() => setShowGenPanel(v => !v)}
            disabled={isTraining}
          >
            <span className={`training-section__arrow${showGenPanel ? ' training-section__arrow--open' : ''}`}>▶</span>
            データセット構造を生成
          </button>

          {showGenPanel && (
            <DatasetGenPanel
              onGenerated={(yamlPath) => {
                setDatasetPath(yamlPath);
                setShowGenPanel(false);
              }}
            />
          )}

          <div className="training-config__divider" />

          {/* ── B-2: 学習設定 ── */}
          <label className="training-config__label">学習スクリプト</label>
          <div className="training-config__row">
            <input
              className="training-config__input"
              type="text" value={scriptPath}
              onChange={(e) => setScriptPath(e.target.value)}
              placeholder="train.py のパス"
              disabled={isTraining}
              onKeyDown={e => e.stopPropagation()}
            />
            <button
              className="training-config__pick"
              onClick={pickScript}
              disabled={isTraining}
              title="ファイルを選択"
            >…</button>
          </div>

          <label className="training-config__label">
            データセット (dataset.yaml)
            {datasetPath && <span className="dataset-gen-panel__sub"> ← 生成後に自動入力</span>}
          </label>
          <div className="training-config__row">
            <input
              className="training-config__input"
              type="text" value={datasetPath}
              onChange={(e) => setDatasetPath(e.target.value)}
              placeholder="dataset.yaml のパス"
              disabled={isTraining}
              onKeyDown={e => e.stopPropagation()}
            />
            <button
              className="training-config__pick"
              onClick={pickDataset}
              disabled={isTraining}
              title="ファイルを選択"
            >…</button>
          </div>

          <label className="training-config__label">追加引数（任意）</label>
          <input
            className="training-config__input"
            type="text" value={extraArgs}
            onChange={(e) => setExtraArgs(e.target.value)}
            placeholder="--epochs 100 --batch-size 16"
            disabled={isTraining}
            onKeyDown={e => e.stopPropagation()}
          />

          <button
            className={`training-config__start${isTraining ? ' training-config__start--running' : ''}`}
            onClick={handleStart}
            disabled={isTraining || !scriptPath || !datasetPath}
          >
            {isTraining
              ? <><span className="toolbar__spinner" />学習中…</>
              : '▶ 学習を開始'}
          </button>

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

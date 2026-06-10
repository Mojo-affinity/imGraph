import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMediaStore } from './hooks/useMediaStore';
import { usePrefetch } from './hooks/usePrefetch';
import { useStore } from './store';
import { Toolbar } from './components/Toolbar';
import { FileList } from './components/FileList';
import { MediaViewer } from './components/MediaViewer';
import { MetadataPanel } from './components/MetadataPanel';
import LogWindow from './components/LogWindow';
import './App.css';

function App() {
  const store = useMediaStore();
  usePrefetch(store.files, store.selectedIndex);

  const appendAppLog   = useStore(s => s.appendAppLog);
  const showLogWindow  = useStore(s => s.showLogWindow);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    store.loadModelConfig();
    store.loadBundledScripts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rust からの app-log イベントをストアに追記
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ level: string; message: string }>('app-log', (event) => {
      const level = (['info', 'warn', 'error'].includes(event.payload.level)
        ? event.payload.level : 'info') as 'info' | 'warn' | 'error';
      appendAppLog({ level, message: event.payload.message });
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement
        || e.target instanceof HTMLTextAreaElement
        || (e.target as HTMLElement).isContentEditable;

      // Ctrl+S: アノテーション保存（入力中でも有効）
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        store.saveAnnotation();
        return;
      }

      if (inInput) return;

      // ファイル移動
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')  { store.navigatePrev(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { store.navigateNext(); return; }
      if (e.key === 'Home' && store.files.length > 0) {
        e.preventDefault();
        store.selectFile(0);
        return;
      }
      if (e.key === 'End' && store.files.length > 0) {
        e.preventDefault();
        store.selectFile(store.files.length - 1);
        return;
      }

      // レーティング（1〜5）
      if (/^[1-5]$/.test(e.key) && store.selectedFile?.media_type === 'image') {
        store.updateMetadata(store.selectedFile.path, { rating: Number(e.key) });
        return;
      }

      // ズームリセット
      if (e.key === '0') {
        window.dispatchEvent(new CustomEvent('viewer:reset-zoom'));
        return;
      }

      // 選択中 BB を削除
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedBoxId) {
        store.removeBoundingBox(store.selectedBoxId);
        store.setSelectedBoxId(null);
        return;
      }

      // BB 選択解除 / ショートカット一覧を閉じる
      if (e.key === 'Escape') {
        if (showShortcuts) { setShowShortcuts(false); return; }
        store.setSelectedBoxId(null);
        return;
      }

      // アノテーションモード切替
      if (e.key.toLowerCase() === 'a') {
        store.toggleAnnotationMode();
        return;
      }

      // ログウィンドウ切替
      if (e.key.toLowerCase() === 'l') {
        store.toggleLogWindow();
        return;
      }

      // 推論ショートカット（画像選択中かつ推論・スキャン中でない時のみ）
      if (store.selectedFile?.media_type === 'image' && !store.isScanning && !store.isInferring) {
        const path = store.selectedFile.path;
        if (e.key.toLowerCase() === 'd') { store.runInference(path, 'object'); return; }
        if (e.key.toLowerCase() === 'f') { store.runInference(path, 'face'); return; }
        if (e.key.toLowerCase() === 'b') { store.runInference(path, 'nudenet'); return; }
        if (e.key.toLowerCase() === 'n' && !store.isClassifyingNsfw) {
          store.runNsfwClassification(path);
          return;
        }
      }

      // ショートカット一覧
      if (e.key === '?') {
        setShowShortcuts(v => !v);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    store.navigatePrev, store.navigateNext, store.selectFile,
    store.selectedFile, store.files.length,
    store.selectedBoxId, store.removeBoundingBox, store.setSelectedBoxId,
    store.toggleAnnotationMode, store.toggleLogWindow,
    store.saveAnnotation, store.updateMetadata,
    store.runInference, store.runNsfwClassification,
    store.isInferring, store.isScanning, store.isClassifyingNsfw,
    showShortcuts,
  ]);

  const handleDetectObjects = () => {
    if (store.selectedFile?.media_type === 'image') {
      store.runInference(store.selectedFile.path, 'object');
    }
  };

  const handleDetectFaces = () => {
    if (store.selectedFile?.media_type === 'image') {
      store.runInference(store.selectedFile.path, 'face');
    }
  };

  const handleDetectNudenet = () => {
    if (store.selectedFile?.media_type === 'image') {
      store.runInference(store.selectedFile.path, 'nudenet');
    }
  };

  const handleDetectNsfw = () => {
    if (store.selectedFile?.media_type === 'image') {
      store.runNsfwClassification(store.selectedFile.path);
    }
  };

  const handleBatchNudenet = () => {
    store.runBatchNudenetAndSave();
  };

  return (
    <div className="app">
      <Toolbar
        currentDir={store.currentDir}
        fileCount={store.files.length}
        isScanning={store.isScanning}
        selectedFile={store.selectedFile}
        boundingBoxCount={store.boundingBoxes.length}
        isSaving={store.isSaving}
        isInferring={store.isInferring}
        onOpenDirectory={store.openDirectory}
        onSaveAnnotation={store.saveAnnotation}
        onDetectObjects={handleDetectObjects}
        onDetectFaces={handleDetectFaces}
        onDetectNudenet={handleDetectNudenet}
        onDetectNsfw={handleDetectNsfw}
        onBatchNudenet={handleBatchNudenet}
      />
      {store.error && (
        <div className="error-banner">{store.error}</div>
      )}
      <div className="app__content">
        <FileList
          files={store.files}
          selectedIndex={store.selectedIndex}
          metadata={store.metadata}
          onSelect={store.selectFile}
        />
        <MediaViewer file={store.selectedFile} />
        <MetadataPanel
          fileName={store.selectedFile?.name ?? null}
          metadata={store.selectedMetadata}
          onUpdate={(update) =>
            store.selectedFile &&
            store.updateMetadata(store.selectedFile.path, update)
          }
        />
      </div>
      {showLogWindow && <LogWindow />}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

// ─── ショートカット一覧オーバーレイ ──────────────────────────────

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ['←', '↑'],           desc: '前のファイル' },
  { keys: ['→', '↓'],           desc: '次のファイル' },
  { keys: ['Home'],              desc: '最初のファイル' },
  { keys: ['End'],               desc: '最後のファイル' },
  { keys: ['1', '2', '3', '4', '5'], desc: 'レーティング設定' },
  { keys: ['0'],                 desc: 'ズームリセット' },
  { keys: ['D'],                 desc: '物体検出' },
  { keys: ['F'],                 desc: '顔検出' },
  { keys: ['B'],                 desc: '部位検出 (NudeNet)' },
  { keys: ['N'],                 desc: 'NSFW 判定' },
  { keys: ['A'],                 desc: 'アノテーションモード切替' },
  { keys: ['Delete', 'BS'],      desc: '選択中 BB を削除' },
  { keys: ['Esc'],               desc: 'BB 選択解除' },
  { keys: ['Ctrl', 'S'],         desc: 'アノテーション保存' },
  { keys: ['L'],                 desc: 'ログウィンドウ切替' },
  { keys: ['?'],                 desc: 'このヘルプを表示' },
];

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-panel" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-panel__header">
          <span>キーボードショートカット</span>
          <button className="shortcuts-panel__close" onClick={onClose}>×</button>
        </div>
        <table className="shortcuts-table">
          <tbody>
            {SHORTCUTS.map(({ keys, desc }) => (
              <tr key={desc}>
                <td className="shortcuts-table__keys">
                  {keys.map((k, i) => (
                    <span key={k}>
                      <kbd className="shortcuts-kbd">{k}</kbd>
                      {i < keys.length - 1 && <span className="shortcuts-sep"> + </span>}
                    </span>
                  ))}
                </td>
                <td className="shortcuts-table__desc">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;

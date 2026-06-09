import { useEffect } from 'react';
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
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') store.navigatePrev();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') store.navigateNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store.navigatePrev, store.navigateNext]);

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
    </div>
  );
}

export default App;

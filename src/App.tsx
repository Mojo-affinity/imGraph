import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMediaStore } from './hooks/useMediaStore';
import { usePrefetch } from './hooks/usePrefetch';
import { useAppShortcuts } from './hooks/useAppShortcuts';
import { useStore } from './store';
import { Toolbar } from './components/Toolbar';
import { FileList } from './components/FileList';
import { MediaViewer } from './components/MediaViewer';
import { MetadataPanel } from './components/MetadataPanel';
import { ViewModeGrid } from './components/ViewModeGrid';
import { ViewModeLarge } from './components/ViewModeLarge';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import LogWindow from './components/LogWindow';
import './App.css';

function App() {
  const store = useMediaStore();
  const [showShortcuts, setShowShortcuts] = useState(false);

  usePrefetch(store.files, store.selectedIndex);

  const appendAppLog = useStore(s => s.appendAppLog);
  const showLogWindow = useStore(s => s.showLogWindow);
  const viewMode = useStore(s => s.viewMode);
  const viewSubMode = useStore(s => s.viewSubMode);

  useEffect(() => {
    store.loadModelConfig();
    store.loadBundledScripts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<{ level: string; message: string }>('app-log', (event) => {
      const level = (['info', 'warn', 'error'].includes(event.payload.level)
        ? event.payload.level
        : 'info') as 'info' | 'warn' | 'error';
      appendAppLog({ level, message: event.payload.message });
    }).then(fn => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [appendAppLog]);

  useAppShortcuts({
    store,
    showShortcuts,
    onToggleShortcuts: () => setShowShortcuts(v => !v),
    onCloseShortcuts: () => setShowShortcuts(false),
  });

  const detectSelectedImage = (mode: 'object' | 'face' | 'nudenet') => {
    if (store.selectedFile?.media_type === 'image') {
      store.runInference(store.selectedFile.path, mode);
    }
  };

  const detectSelectedNsfw = () => {
    if (store.selectedFile?.media_type === 'image') {
      store.runNsfwClassification(store.selectedFile.path);
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
        onDetectObjects={() => detectSelectedImage('object')}
        onDetectFaces={() => detectSelectedImage('face')}
        onDetectNudenet={() => detectSelectedImage('nudenet')}
        onDetectNsfw={detectSelectedNsfw}
        onBatchNudenet={store.runBatchNudenetAndSave}
      />

      {store.error && <div className="error-banner">{store.error}</div>}

      <main className="app__content">
        {viewMode === 'view' ? (
          viewSubMode === 'grid' ? <ViewModeGrid /> : <ViewModeLarge />
        ) : (
          <>
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
              onUpdate={(update) => {
                if (store.selectedFile) {
                  store.updateMetadata(store.selectedFile.path, update);
                }
              }}
            />
          </>
        )}
      </main>

      {showLogWindow && <LogWindow />}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

export default App;

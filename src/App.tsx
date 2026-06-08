import { useEffect } from 'react';
import { useMediaStore } from './hooks/useMediaStore';
import { usePrefetch } from './hooks/usePrefetch';
import { Toolbar } from './components/Toolbar';
import { FileList } from './components/FileList';
import { MediaViewer } from './components/MediaViewer';
import { MetadataPanel } from './components/MetadataPanel';
import './App.css';

function App() {
  const store = useMediaStore();
  usePrefetch(store.files, store.selectedIndex);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') store.navigatePrev();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') store.navigateNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store.navigatePrev, store.navigateNext]);

  return (
    <div className="app">
      <Toolbar
        currentDir={store.currentDir}
        fileCount={store.files.length}
        isScanning={store.isScanning}
        selectedFile={store.selectedFile}
        boundingBoxCount={store.boundingBoxes.length}
        isSaving={store.isSaving}
        onOpenDirectory={store.openDirectory}
        onSaveAnnotation={store.saveAnnotation}
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
    </div>
  );
}

export default App;

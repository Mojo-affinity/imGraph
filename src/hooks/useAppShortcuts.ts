import { useEffect } from 'react';
import type { useMediaStore } from './useMediaStore';

type MediaStore = ReturnType<typeof useMediaStore>;

interface UseAppShortcutsOptions {
  store: MediaStore;
  showShortcuts: boolean;
  onToggleShortcuts: () => void;
  onCloseShortcuts: () => void;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function canRunImageInference(store: MediaStore) {
  return store.selectedFile?.media_type === 'image'
    && !store.isScanning
    && !store.isInferring;
}

export function useAppShortcuts({
  store,
  showShortcuts,
  onToggleShortcuts,
  onCloseShortcuts,
}: UseAppShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === '?') {
        onToggleShortcuts();
        return;
      }

      if (event.key === 'Escape' && showShortcuts) {
        onCloseShortcuts();
        return;
      }

      if (store.viewMode === 'view') return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        store.saveAnnotation();
        return;
      }

      if (isEditableTarget(event.target)) return;

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          store.navigatePrev();
          return;
        case 'ArrowRight':
        case 'ArrowDown':
          store.navigateNext();
          return;
        case 'Home':
          if (store.files.length > 0) {
            event.preventDefault();
            store.selectFile(0);
          }
          return;
        case 'End':
          if (store.files.length > 0) {
            event.preventDefault();
            store.selectFile(store.files.length - 1);
          }
          return;
        case '0':
          window.dispatchEvent(new CustomEvent('viewer:reset-zoom'));
          return;
        case 'Delete':
        case 'Backspace':
          if (store.selectedBoxId) {
            store.removeBoundingBox(store.selectedBoxId);
            store.setSelectedBoxId(null);
          }
          return;
        case 'Escape':
          store.setSelectedBoxId(null);
          return;
        default:
          break;
      }

      if (/^[1-5]$/.test(event.key) && store.selectedFile?.media_type === 'image') {
        store.updateMetadata(store.selectedFile.path, { rating: Number(event.key) });
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'a') {
        store.toggleAnnotationMode();
        return;
      }

      if (key === 'l') {
        store.toggleLogWindow();
        return;
      }

      if (!canRunImageInference(store)) return;

      const path = store.selectedFile?.path;
      if (!path) return;

      if (key === 'd') store.runInference(path, 'object');
      if (key === 'f') store.runInference(path, 'face');
      if (key === 'b') store.runInference(path, 'nudenet');
      if (key === 'n' && !store.isClassifyingNsfw) store.runNsfwClassification(path);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    store,
    showShortcuts,
    onToggleShortcuts,
    onCloseShortcuts,
  ]);
}

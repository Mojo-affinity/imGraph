import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { MediaFile, MediaMetadata, MetadataMap } from '../types';

export function useMediaStore() {
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [metadata, setMetadata] = useState<MetadataMap>({});
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 進行中スキャンのリスナーを保持し、新しいスキャン開始時に解除する
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  const stopListeners = useCallback(() => {
    unlistenRefs.current.forEach((fn) => fn());
    unlistenRefs.current = [];
  }, []);

  const openDirectory = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== 'string') return;

      // 前回のスキャンが続いていれば中断
      stopListeners();

      setCurrentDir(selected);
      setFiles([]);
      setSelectedIndex(null);
      setMetadata({});
      setIsScanning(true);
      setError(null);

      // イベントリスナーを invoke より先に登録してイベントを取りこぼさない
      const unlistenBatch = await listen<MediaFile[]>('scan-batch', (event) => {
        setFiles((prev) => [...prev, ...event.payload]);
      });

      const unlistenComplete = await listen('scan-complete', async () => {
        stopListeners();
        // rel_path でソート
        setFiles((prev) =>
          [...prev].sort((a, b) =>
            a.rel_path.toLowerCase().localeCompare(b.rel_path.toLowerCase())
          )
        );
        setIsScanning(false);
        try {
          const meta = await invoke<MetadataMap>('load_metadata', { dirPath: selected });
          setMetadata(meta);
        } catch (e) {
          setError(String(e));
        }
      });

      unlistenRefs.current = [unlistenBatch, unlistenComplete];

      await invoke('scan_directory', { path: selected });
    } catch (e) {
      setError(String(e));
      setIsScanning(false);
      stopListeners();
    }
  }, [stopListeners]);

  const selectFile = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const updateMetadata = useCallback(
    async (filePath: string, update: Partial<MediaMetadata>) => {
      if (!currentDir) return;
      const current = metadata[filePath] ?? { tags: [], rating: 0 };
      const updated: MetadataMap = {
        ...metadata,
        [filePath]: { ...current, ...update },
      };
      setMetadata(updated);
      try {
        await invoke('save_metadata', { dirPath: currentDir, metadata: updated });
      } catch (e) {
        setError(String(e));
      }
    },
    [currentDir, metadata]
  );

  const navigatePrev = useCallback(() => {
    setSelectedIndex((i) => (i !== null && i > 0 ? i - 1 : i));
  }, []);

  const navigateNext = useCallback(() => {
    setSelectedIndex((i) => (i !== null && i < files.length - 1 ? i + 1 : i));
  }, [files.length]);

  const selectedFile = selectedIndex !== null ? (files[selectedIndex] ?? null) : null;
  const selectedMetadata = selectedFile
    ? (metadata[selectedFile.path] ?? { tags: [], rating: 0 })
    : null;

  return {
    currentDir,
    files,
    selectedIndex,
    selectedFile,
    selectedMetadata,
    metadata,
    isScanning,
    error,
    openDirectory,
    selectFile,
    updateMetadata,
    navigatePrev,
    navigateNext,
  };
}

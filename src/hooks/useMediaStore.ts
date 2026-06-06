import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { MediaFile, MediaMetadata, MetadataMap } from '../types';

export function useMediaStore() {
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [metadata, setMetadata] = useState<MetadataMap>({});
  const [error, setError] = useState<string | null>(null);

  const openDirectory = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== 'string') return;

      const scanned = await invoke<MediaFile[]>('scan_directory', { path: selected });
      const meta = await invoke<MetadataMap>('load_metadata', { dirPath: selected });

      setCurrentDir(selected);
      setFiles(scanned);
      setMetadata(meta);
      setSelectedIndex(scanned.length > 0 ? 0 : null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

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

  const selectedFile = selectedIndex !== null ? files[selectedIndex] ?? null : null;
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
    error,
    openDirectory,
    selectFile,
    updateMetadata,
    navigatePrev,
    navigateNext,
  };
}

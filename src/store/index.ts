import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  MediaFile,
  MediaMetadata,
  MetadataMap,
  BoundingBox,
  InferenceMode,
} from '../types';

// ─── イベントリスナー管理 (ストア外で保持) ───────────────────
let _unlistenFns: UnlistenFn[] = [];
const stopListeners = () => {
  _unlistenFns.forEach((fn) => fn());
  _unlistenFns = [];
};

// ─── State / Actions 型定義 ───────────────────────────────────

interface StoreState {
  // ── ファイル管理 ──────────────────────────────────────────
  currentDir: string | null;
  files: MediaFile[];
  selectedIndex: number | null;
  metadata: MetadataMap;
  isScanning: boolean;
  error: string | null;

  // ── ML / アノテーション ───────────────────────────────────
  boundingBoxes: BoundingBox[];
  inferenceMode: InferenceMode;
  isInferring: boolean;
  isTraining: boolean;
  trainingLogs: string[];

  // ── ファイル操作 ──────────────────────────────────────────
  openDirectory: () => Promise<void>;
  selectFile: (index: number) => void;
  navigatePrev: () => void;
  navigateNext: () => void;
  updateMetadata: (filePath: string, update: Partial<MediaMetadata>) => Promise<void>;

  // ── BoundingBox 操作 ──────────────────────────────────────
  setBoundingBoxes: (boxes: BoundingBox[]) => void;
  addBoundingBox: (box: BoundingBox) => void;
  updateBoundingBox: (id: string, updates: Partial<BoundingBox>) => void;
  removeBoundingBox: (id: string) => void;
  clearBoundingBoxes: () => void;

  // ── 学習操作 ──────────────────────────────────────────────
  setInferenceMode: (mode: InferenceMode) => void;
  setIsInferring: (v: boolean) => void;
  setIsTraining: (v: boolean) => void;
  appendTrainingLog: (log: string) => void;
  clearTrainingLogs: () => void;
}

// ─── ストア ───────────────────────────────────────────────────

export const useStore = create<StoreState>()((set, get) => ({
  // ── 初期値 ────────────────────────────────────────────────
  currentDir: null,
  files: [],
  selectedIndex: null,
  metadata: {},
  isScanning: false,
  error: null,
  boundingBoxes: [],
  inferenceMode: 'none',
  isInferring: false,
  isTraining: false,
  trainingLogs: [],

  // ── ファイル操作 ──────────────────────────────────────────
  openDirectory: async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== 'string') return;

      stopListeners();
      set({
        currentDir: selected,
        files: [],
        selectedIndex: null,
        metadata: {},
        isScanning: true,
        error: null,
        boundingBoxes: [],
        trainingLogs: [],
      });

      const unlistenBatch = await listen<MediaFile[]>('scan-batch', (event) => {
        set((s) => ({ files: [...s.files, ...event.payload] }));
      });

      const unlistenComplete = await listen('scan-complete', async () => {
        stopListeners();
        set((s) => ({
          files: [...s.files].sort((a, b) =>
            a.rel_path.toLowerCase().localeCompare(b.rel_path.toLowerCase())
          ),
          isScanning: false,
        }));
        try {
          const meta = await invoke<MetadataMap>('load_metadata', { dirPath: selected });
          set({ metadata: meta });
        } catch (e) {
          set({ error: String(e) });
        }
      });

      _unlistenFns = [unlistenBatch, unlistenComplete];
      await invoke('scan_directory', { path: selected });
    } catch (e) {
      set({ error: String(e), isScanning: false });
      stopListeners();
    }
  },

  selectFile: (index) =>
    set({ selectedIndex: index, boundingBoxes: [] }),

  navigatePrev: () =>
    set((s) => ({
      selectedIndex:
        s.selectedIndex !== null && s.selectedIndex > 0
          ? s.selectedIndex - 1
          : s.selectedIndex,
      boundingBoxes: [],
    })),

  navigateNext: () =>
    set((s) => ({
      selectedIndex:
        s.selectedIndex !== null && s.selectedIndex < s.files.length - 1
          ? s.selectedIndex + 1
          : s.selectedIndex,
      boundingBoxes: [],
    })),

  updateMetadata: async (filePath, update) => {
    const { currentDir, metadata } = get();
    if (!currentDir) return;
    const current = metadata[filePath] ?? { tags: [], rating: 0 };
    const updated: MetadataMap = {
      ...metadata,
      [filePath]: { ...current, ...update },
    };
    set({ metadata: updated });
    try {
      await invoke('save_metadata', { dirPath: currentDir, metadata: updated });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── BoundingBox 操作 ──────────────────────────────────────
  setBoundingBoxes: (boxes) => set({ boundingBoxes: boxes }),

  addBoundingBox: (box) =>
    set((s) => ({ boundingBoxes: [...s.boundingBoxes, box] })),

  updateBoundingBox: (id, updates) =>
    set((s) => ({
      boundingBoxes: s.boundingBoxes.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      ),
    })),

  removeBoundingBox: (id) =>
    set((s) => ({
      boundingBoxes: s.boundingBoxes.filter((b) => b.id !== id),
    })),

  clearBoundingBoxes: () => set({ boundingBoxes: [] }),

  // ── 学習操作 ──────────────────────────────────────────────
  setInferenceMode: (mode) => set({ inferenceMode: mode }),
  setIsInferring: (v) => set({ isInferring: v }),
  setIsTraining: (v) => set({ isTraining: v }),
  appendTrainingLog: (log) =>
    set((s) => ({ trainingLogs: [...s.trainingLogs, log] })),
  clearTrainingLogs: () => set({ trainingLogs: [] }),
}));

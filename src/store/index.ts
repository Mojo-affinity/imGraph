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

// ─── ファイル選択後にアノテーションをロードするヘルパー ────────
async function loadAnnotationForFile(
  file: MediaFile | undefined,
  targetIndex: number,
  getIndex: () => number | null,
  setBoxes: (boxes: BoundingBox[]) => void
) {
  if (!file || file.media_type !== 'image') return;
  try {
    const boxes = await invoke<BoundingBox[]>('load_annotation', { imagePath: file.path });
    // 非同期中にファイルが変わっていたら適用しない
    if (getIndex() === targetIndex) {
      setBoxes(boxes);
    }
  } catch {
    // .txt が存在しない = アノテーションなし（正常）
  }
}

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
  classes: string[];
  inferenceMode: InferenceMode;
  isInferring: boolean;
  isSaving: boolean;
  isTraining: boolean;
  trainingLogs: string[];

  // ── ファイル操作 ──────────────────────────────────────────
  openDirectory: () => Promise<void>;
  selectFile: (index: number) => void;
  navigatePrev: () => void;
  navigateNext: () => void;
  updateMetadata: (filePath: string, update: Partial<MediaMetadata>) => Promise<void>;

  // ── アノテーション操作 ────────────────────────────────────
  saveAnnotation: () => Promise<void>;
  setBoundingBoxes: (boxes: BoundingBox[]) => void;
  addBoundingBox: (box: BoundingBox) => void;
  updateBoundingBox: (id: string, updates: Partial<BoundingBox>) => void;
  removeBoundingBox: (id: string) => void;
  clearBoundingBoxes: () => void;

  // ── 推論 ──────────────────────────────────────────────────
  runInference: (imagePath: string, mode: InferenceMode) => Promise<void>;
  setInferenceMode: (mode: InferenceMode) => void;
  setIsInferring: (v: boolean) => void;

  // ── 学習操作 ──────────────────────────────────────────────
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
  classes: [],
  inferenceMode: 'none',
  isInferring: false,
  isSaving: false,
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
        classes: [],
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
          const [meta, classes] = await Promise.all([
            invoke<MetadataMap>('load_metadata', { dirPath: selected }),
            invoke<string[]>('load_classes', { dirPath: selected }),
          ]);
          set({ metadata: meta, classes });
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

  selectFile: (index) => {
    const { files } = get();
    set({ selectedIndex: index, boundingBoxes: [] });
    loadAnnotationForFile(
      files[index],
      index,
      () => get().selectedIndex,
      (boxes) => set({ boundingBoxes: boxes })
    );
  },

  navigatePrev: () => {
    const { selectedIndex, files } = get();
    if (selectedIndex === null || selectedIndex <= 0) return;
    const next = selectedIndex - 1;
    set({ selectedIndex: next, boundingBoxes: [] });
    loadAnnotationForFile(
      files[next],
      next,
      () => get().selectedIndex,
      (boxes) => set({ boundingBoxes: boxes })
    );
  },

  navigateNext: () => {
    const { selectedIndex, files } = get();
    if (selectedIndex === null || selectedIndex >= files.length - 1) return;
    const next = selectedIndex + 1;
    set({ selectedIndex: next, boundingBoxes: [] });
    loadAnnotationForFile(
      files[next],
      next,
      () => get().selectedIndex,
      (boxes) => set({ boundingBoxes: boxes })
    );
  },

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

  // ── アノテーション操作 ────────────────────────────────────
  saveAnnotation: async () => {
    const { selectedIndex, files, boundingBoxes } = get();
    if (selectedIndex === null) return;
    const file = files[selectedIndex];
    if (!file || file.media_type !== 'image') return;

    set({ isSaving: true, error: null });
    try {
      await invoke('save_annotation', { imagePath: file.path, boxes: boundingBoxes });
      // classes.txt が更新された可能性があるので再ロード
      const dir = file.path.substring(0, Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\')));
      const classes = await invoke<string[]>('load_classes', { dirPath: dir });
      set({ isSaving: false, classes });
    } catch (e) {
      set({ isSaving: false, error: String(e) });
    }
  },

  setBoundingBoxes: (boxes) => set({ boundingBoxes: boxes }),
  addBoundingBox: (box) =>
    set((s) => ({ boundingBoxes: [...s.boundingBoxes, box] })),
  updateBoundingBox: (id, updates) =>
    set((s) => ({
      boundingBoxes: s.boundingBoxes.map((b) => (b.id === id ? { ...b, ...updates } : b)),
    })),
  removeBoundingBox: (id) =>
    set((s) => ({ boundingBoxes: s.boundingBoxes.filter((b) => b.id !== id) })),
  clearBoundingBoxes: () => set({ boundingBoxes: [] }),

  // ── 推論 ──────────────────────────────────────────────────
  runInference: async (imagePath, mode) => {
    if (mode === 'none') {
      set({ boundingBoxes: [], inferenceMode: 'none' });
      return;
    }
    set({ isInferring: true, boundingBoxes: [], inferenceMode: mode, error: null });
    try {
      const command = mode === 'face' ? 'detect_faces_and_age' : 'detect_objects';
      const boxes = await invoke<BoundingBox[]>(command, { imagePath });
      set({ boundingBoxes: boxes, isInferring: false });
    } catch (e) {
      set({ error: String(e), isInferring: false });
    }
  },

  setInferenceMode: (mode) => set({ inferenceMode: mode }),
  setIsInferring: (v) => set({ isInferring: v }),

  // ── 学習操作 ──────────────────────────────────────────────
  setIsTraining: (v) => set({ isTraining: v }),
  appendTrainingLog: (log) =>
    set((s) => ({ trainingLogs: [...s.trainingLogs, log] })),
  clearTrainingLogs: () => set({ trainingLogs: [] }),
}));

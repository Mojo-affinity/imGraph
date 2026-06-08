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
  ModelConfig,
  DatasetInfo,
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
  selectedBoxId: string | null;
  classes: string[];
  inferenceMode: InferenceMode;
  isInferring: boolean;
  isSaving: boolean;
  isTraining: boolean;
  trainingLogs: string[];
  isGeneratingDataset: boolean;
  lastDatasetInfo: DatasetInfo | null;

  // ── モデル設定 ────────────────────────────────────────────
  faceScriptPath: string;
  faceModelDir: string;
  objectModelPath: string;
  objectClassNamesPath: string;

  // ── ファイル操作 ──────────────────────────────────────────
  openDirectory: () => Promise<void>;
  selectFile: (index: number) => void;
  navigatePrev: () => void;
  navigateNext: () => void;
  updateMetadata: (filePath: string, update: Partial<MediaMetadata>) => Promise<void>;

  // ── アノテーション操作 ────────────────────────────────────
  saveAnnotation: () => Promise<void>;
  setSelectedBoxId: (id: string | null) => void;
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
  startTraining: (scriptPath: string, datasetPath: string, extraArgs?: string[]) => Promise<void>;
  setIsTraining: (v: boolean) => void;
  appendTrainingLog: (log: string) => void;
  clearTrainingLogs: () => void;

  // ── データセット生成 ──────────────────────────────────────
  generateDataset: (sourceDir: string, outputDir: string, valRatio: number) => Promise<DatasetInfo>;

  // ── モデル設定 ────────────────────────────────────────────
  loadModelConfig: () => Promise<void>;
  saveModelConfig: (scriptPath: string, modelDir: string) => Promise<void>;
  saveObjectModelConfig: (modelPath: string, classNamesPath: string) => Promise<void>;
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
  selectedBoxId: null,
  classes: [],
  inferenceMode: 'none',
  isInferring: false,
  isSaving: false,
  isTraining: false,
  trainingLogs: [],
  isGeneratingDataset: false,
  lastDatasetInfo: null,
  faceScriptPath: '',
  faceModelDir: '',
  objectModelPath: '',
  objectClassNamesPath: '',

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
    set({ selectedIndex: index, boundingBoxes: [], selectedBoxId: null });
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
    set({ selectedIndex: next, boundingBoxes: [], selectedBoxId: null });
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
    set({ selectedIndex: next, boundingBoxes: [], selectedBoxId: null });
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

  setSelectedBoxId: (id) => set({ selectedBoxId: id }),
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
      let boxes: BoundingBox[];
      if (mode === 'face') {
        const { faceScriptPath, faceModelDir } = get();
        boxes = await invoke<BoundingBox[]>('detect_faces_and_age', {
          imagePath,
          scriptPath: faceScriptPath,
          modelDir: faceModelDir,
        });
      } else {
        const { objectModelPath, objectClassNamesPath } = get();
        boxes = await invoke<BoundingBox[]>('detect_objects', {
          imagePath,
          modelPath: objectModelPath,
          classNamesPath: objectClassNamesPath,
        });
      }
      set({ boundingBoxes: boxes, isInferring: false });
    } catch (e) {
      set({ error: String(e), isInferring: false });
    }
  },

  setInferenceMode: (mode) => set({ inferenceMode: mode }),
  setIsInferring: (v) => set({ isInferring: v }),

  // ── 学習操作 ──────────────────────────────────────────────
  startTraining: async (scriptPath, datasetPath, extraArgs = []) => {
    set({ isTraining: true, trainingLogs: [], error: null });

    // イベントリスナーを invoke より先に登録
    const unlistenLog = await listen<string>('training-log', (event) => {
      set((s) => ({ trainingLogs: [...s.trainingLogs, event.payload] }));
    });

    const unlistenComplete = await listen<boolean>('training-complete', () => {
      set({ isTraining: false });
      unlistenLog();
      unlistenComplete();
    });

    try {
      await invoke('start_training', { scriptPath, datasetPath, extraArgs });
    } catch (e) {
      set({ isTraining: false, error: String(e) });
      unlistenLog();
      unlistenComplete();
    }
  },

  setIsTraining: (v) => set({ isTraining: v }),
  appendTrainingLog: (log) =>
    set((s) => ({ trainingLogs: [...s.trainingLogs, log] })),
  clearTrainingLogs: () => set({ trainingLogs: [] }),

  // ── モデル設定 ────────────────────────────────────────────
  loadModelConfig: async () => {
    try {
      const config = await invoke<ModelConfig>('load_model_config');
      set({
        faceScriptPath: config.face_script_path,
        faceModelDir: config.face_model_dir,
        objectModelPath: config.object_model_path,
        objectClassNamesPath: config.object_class_names_path,
      });
    } catch {
      // ファイル未作成時は初期値のまま
    }
  },

  saveModelConfig: async (scriptPath, modelDir) => {
    const { objectModelPath, objectClassNamesPath } = get();
    try {
      await invoke('save_model_config', {
        config: {
          face_script_path: scriptPath,
          face_model_dir: modelDir,
          object_model_path: objectModelPath,
          object_class_names_path: objectClassNamesPath,
        },
      });
      set({ faceScriptPath: scriptPath, faceModelDir: modelDir });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  generateDataset: async (sourceDir, outputDir, valRatio) => {
    set({ isGeneratingDataset: true, error: null });
    try {
      const info = await invoke<DatasetInfo>('generate_dataset', {
        sourceDir,
        outputDir,
        valRatio,
      });
      set({ isGeneratingDataset: false, lastDatasetInfo: info });
      return info;
    } catch (e) {
      set({ isGeneratingDataset: false, error: String(e) });
      throw e;
    }
  },

  saveObjectModelConfig: async (modelPath, classNamesPath) => {
    const { faceScriptPath, faceModelDir } = get();
    try {
      await invoke('save_model_config', {
        config: {
          face_script_path: faceScriptPath,
          face_model_dir: faceModelDir,
          object_model_path: modelPath,
          object_class_names_path: classNamesPath,
        },
      });
      set({ objectModelPath: modelPath, objectClassNamesPath: classNamesPath });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));

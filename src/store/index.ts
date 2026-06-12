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
  NsfwResult,
  DatasetInfo,
  BundledScripts,
  LogEntry,
} from '../types';

// ─── ModelConfig ヘルパー ─────────────────────────────────────

function currentModelConfig(s: StoreState): ModelConfig {
  return {
    face_script_path: s.faceScriptPath,
    face_model_dir: s.faceModelDir,
    object_model_path: s.objectModelPath,
    object_class_names_path: s.objectClassNamesPath,
    object_conf_threshold: s.objectConfThreshold,
    face_det_model_path: s.faceDetModelPath,
    face_genderage_model_path: s.faceGenderageModelPath,
    nudenet_model_path: s.nudenetModelPath,
    nudenet_conf_threshold: s.nudenetConfThreshold,
    nsfw_model_path: s.nsfwModelPath,
    nsfw_class_names_path: s.nsfwClassNamesPath,
  };
}

async function persistModelConfig(config: ModelConfig): Promise<void> {
  await invoke('save_model_config', { config });
}

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
  objectConfThreshold: number;
  faceDetModelPath: string;
  faceGenderageModelPath: string;
  nudenetModelPath: string;
  nudenetConfThreshold: number;
  nsfwModelPath: string;
  nsfwClassNamesPath: string;
  nsfwResult: NsfwResult | null;
  isClassifyingNsfw: boolean;

  // ── バンドル済みスクリプト（インストール時同梱）────────────
  bundledDetectFacesPy: string;
  bundledTrainPy: string;

  // ── UI モード ─────────────────────────────────────────────
  annotationMode: boolean;

  // ── 画像ビューモード ──────────────────────────────────────
  viewMode: 'annotate' | 'view';
  viewSubMode: 'grid' | 'large';
  viewImageIndex: number;
  viewTagFilter: string[];
  viewTagFilterMode: 'or' | 'and';

  // ── ログ ──────────────────────────────────────────────────
  appLogs: LogEntry[];
  showLogWindow: boolean;

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
  saveObjectModelConfig: (modelPath: string, classNamesPath: string, confThreshold: number) => Promise<void>;
  loadBundledScripts: () => Promise<void>;
  saveFaceOnnxConfig: (detModelPath: string, genderageModelPath: string) => Promise<void>;
  saveNudenetConfig: (modelPath: string, confThreshold: number) => Promise<void>;
  saveNsfwConfig: (modelPath: string, classNamesPath: string) => Promise<void>;
  runNsfwClassification: (imagePath: string) => Promise<void>;

  // ── 一括処理 ──────────────────────────────────────────────
  isBatchNudenet: boolean;
  batchNudenetProgress: { done: number; total: number } | null;
  runBatchNudenetAndSave: () => Promise<void>;

  // ── UI モード ─────────────────────────────────────────────
  toggleAnnotationMode: () => void;
  setViewMode: (mode: 'annotate' | 'view') => void;
  setViewSubMode: (sub: 'grid' | 'large') => void;
  setViewImageIndex: (index: number) => void;
  openInLargeView: (index: number) => void;
  setViewTagFilter: (tags: string[]) => void;
  setViewTagFilterMode: (mode: 'or' | 'and') => void;

  // ── ログ ──────────────────────────────────────────────────
  appendAppLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearAppLogs: () => void;
  toggleLogWindow: () => void;
  setShowLogWindow: (v: boolean) => void;
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
  objectConfThreshold: 0.25,
  faceDetModelPath: '',
  faceGenderageModelPath: '',
  nudenetModelPath: '',
  nudenetConfThreshold: 0.2,
  nsfwModelPath: '',
  nsfwClassNamesPath: '',
  nsfwResult: null,
  isClassifyingNsfw: false,
  bundledDetectFacesPy: '',
  bundledTrainPy: '',
  annotationMode: true,
  viewMode: 'annotate',
  viewSubMode: 'grid',
  viewImageIndex: 0,
  viewTagFilter: [],
  viewTagFilterMode: 'or',
  appLogs: [],
  showLogWindow: false,
  isBatchNudenet: false,
  batchNudenetProgress: null,

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
        viewImageIndex: 0,
        viewTagFilter: [],
      });

      let scanBuffer: MediaFile[] = [];
      let scanTimer: ReturnType<typeof setTimeout> | null = null;
      const flushScanBuffer = () => {
        if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
        const batch = scanBuffer.splice(0);
        if (batch.length > 0) set((s) => ({ files: [...s.files, ...batch] }));
      };

      const unlistenBatch = await listen<MediaFile[]>('scan-batch', (event) => {
        scanBuffer.push(...event.payload);
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = setTimeout(flushScanBuffer, 150);
      });

      const unlistenComplete = await listen('scan-complete', async () => {
        flushScanBuffer();
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
    set({ selectedIndex: index, boundingBoxes: [], selectedBoxId: null, nsfwResult: null });
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
    set({ selectedIndex: next, boundingBoxes: [], selectedBoxId: null, nsfwResult: null });
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
    set({ selectedIndex: next, boundingBoxes: [], selectedBoxId: null, nsfwResult: null });
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
        const { faceScriptPath, faceModelDir, faceDetModelPath, faceGenderageModelPath } = get();
        boxes = await invoke<BoundingBox[]>('detect_faces_and_age', {
          imagePath,
          scriptPath: faceScriptPath,
          modelDir: faceModelDir,
          faceDetModelPath,
          faceGenderageModelPath,
        });
      } else if (mode === 'nudenet') {
        const { nudenetModelPath, nudenetConfThreshold } = get();
        boxes = await invoke<BoundingBox[]>('detect_nudenet', {
          imagePath,
          modelPath: nudenetModelPath,
          confThreshold: nudenetConfThreshold,
        });
      } else {
        const { objectModelPath, objectClassNamesPath, objectConfThreshold } = get();
        boxes = await invoke<BoundingBox[]>('detect_objects', {
          imagePath,
          modelPath: objectModelPath,
          classNamesPath: objectClassNamesPath,
          confThreshold: objectConfThreshold,
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
        objectConfThreshold: config.object_conf_threshold ?? 0.25,
        faceDetModelPath: config.face_det_model_path,
        faceGenderageModelPath: config.face_genderage_model_path,
        nudenetModelPath: config.nudenet_model_path,
        nudenetConfThreshold: config.nudenet_conf_threshold ?? 0.2,
        nsfwModelPath: config.nsfw_model_path ?? '',
        nsfwClassNamesPath: config.nsfw_class_names_path ?? '',
      });
    } catch {
      // ファイル未作成時は初期値のまま
    }
  },

  saveModelConfig: async (scriptPath, modelDir) => {
    try {
      await persistModelConfig({ ...currentModelConfig(get()), face_script_path: scriptPath, face_model_dir: modelDir });
      set({ faceScriptPath: scriptPath, faceModelDir: modelDir });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadBundledScripts: async () => {
    try {
      const scripts = await invoke<BundledScripts>('get_bundled_scripts');
      set({ bundledDetectFacesPy: scripts.detect_faces_py, bundledTrainPy: scripts.train_py });
      // 未設定の場合はバンドル済みパスで自動補完
      const { faceScriptPath } = get();
      if (!faceScriptPath) {
        set({ faceScriptPath: scripts.detect_faces_py });
      }
    } catch {
      // 開発モードではリソースディレクトリが存在しないため無視
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

  runBatchNudenetAndSave: async () => {
    const { files, nudenetModelPath, nudenetConfThreshold, appendAppLog } = get();
    if (!nudenetModelPath) {
      set({ error: 'NudeNet モデルが設定されていません' });
      return;
    }
    const imageFiles = files.filter(f => f.media_type === 'image');
    if (imageFiles.length === 0) return;

    set({ isBatchNudenet: true, batchNudenetProgress: { done: 0, total: imageFiles.length }, error: null });
    appendAppLog({ level: 'info', message: `[一括部位推定] 開始: ${imageFiles.length}枚` });

    let done = 0;
    for (const file of imageFiles) {
      try {
        const boxes = await invoke<BoundingBox[]>('detect_nudenet', {
          imagePath: file.path,
          modelPath: nudenetModelPath,
          confThreshold: nudenetConfThreshold,
        });
        await invoke('save_annotation', { imagePath: file.path, boxes });
      } catch (e) {
        appendAppLog({ level: 'error', message: `[一括部位推定] ${file.name}: ${String(e)}` });
      }
      done++;
      set({ batchNudenetProgress: { done, total: imageFiles.length } });
    }

    appendAppLog({ level: 'info', message: `[一括部位推定] 完了: ${imageFiles.length}枚処理` });
    set({ isBatchNudenet: false, batchNudenetProgress: null });
  },

  toggleAnnotationMode: () => set(s => ({ annotationMode: !s.annotationMode })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setViewSubMode: (sub) => set({ viewSubMode: sub }),
  setViewImageIndex: (index) => set({ viewImageIndex: index }),
  openInLargeView: (index) => set({ viewSubMode: 'large', viewImageIndex: index }),
  setViewTagFilter: (tags) => set({ viewTagFilter: tags, viewImageIndex: 0 }),
  setViewTagFilterMode: (mode) => set({ viewTagFilterMode: mode }),

  appendAppLog: ({ level, message }) =>
    set(s => ({
      appLogs: [...s.appLogs, {
        id: crypto.randomUUID(),
        timestamp: new Date().toLocaleTimeString('ja-JP', { hour12: false }),
        level,
        message,
      }].slice(-500),
    })),
  clearAppLogs: () => set({ appLogs: [] }),
  toggleLogWindow: () => set(s => ({ showLogWindow: !s.showLogWindow })),
  setShowLogWindow: (v) => set({ showLogWindow: v }),

  saveObjectModelConfig: async (modelPath, classNamesPath, confThreshold) => {
    try {
      await persistModelConfig({ ...currentModelConfig(get()), object_model_path: modelPath, object_class_names_path: classNamesPath, object_conf_threshold: confThreshold });
      set({ objectModelPath: modelPath, objectClassNamesPath: classNamesPath, objectConfThreshold: confThreshold });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveFaceOnnxConfig: async (detModelPath, genderageModelPath) => {
    try {
      await persistModelConfig({ ...currentModelConfig(get()), face_det_model_path: detModelPath, face_genderage_model_path: genderageModelPath });
      set({ faceDetModelPath: detModelPath, faceGenderageModelPath: genderageModelPath });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveNudenetConfig: async (modelPath, confThreshold) => {
    try {
      await persistModelConfig({ ...currentModelConfig(get()), nudenet_model_path: modelPath, nudenet_conf_threshold: confThreshold });
      set({ nudenetModelPath: modelPath, nudenetConfThreshold: confThreshold });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveNsfwConfig: async (modelPath, classNamesPath) => {
    try {
      await persistModelConfig({ ...currentModelConfig(get()), nsfw_model_path: modelPath, nsfw_class_names_path: classNamesPath });
      set({ nsfwModelPath: modelPath, nsfwClassNamesPath: classNamesPath });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  runNsfwClassification: async (imagePath) => {
    const { nsfwModelPath, nsfwClassNamesPath } = get();
    if (!nsfwModelPath) {
      set({ error: 'NSFW モデルが設定されていません' });
      return;
    }
    set({ isClassifyingNsfw: true, nsfwResult: null, error: null });
    try {
      const result = await invoke<NsfwResult>('classify_nsfw', {
        imagePath,
        modelPath: nsfwModelPath,
        classNamesPath: nsfwClassNamesPath,
      });
      set({ nsfwResult: result, isClassifyingNsfw: false });
    } catch (e) {
      set({ error: String(e), isClassifyingNsfw: false });
    }
  },
}));

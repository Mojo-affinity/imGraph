# imGraph

ディレクトリ内の画像・動画ファイルを閲覧・タグ付け・評価できるマルチプラットフォームメディアビューワ。  
バウンディングボックスアノテーション・ONNX 物体検出・NudeNet 部位検出・NSFW 分類・InsightFace 顔検出/年齢推定・ローカル学習ループを統合したアノテーションツール。

---

## 機能

### メディアビューワ

- **ディレクトリスキャン** — サブフォルダを再帰的にスキャン、対応フォーマットのファイルを一覧表示
- **遅延ストリーミング** — 50 件単位のバッチ配信でフォルダが大きくてもすぐに表示開始
- **ファイル一覧** — ディレクトリ単位でグループ化・展開/折りたたみ、スティッキーヘッダー
- **プリフェッチ** — 前後 2 件を事前ロード、最大 20 件のキャッシュ
- **5 段階評価** — 同じ星をクリックで解除
- **タグ付け** — タグの追加・削除
- **キーボードナビゲーション** — 矢印キー / Home / End でファイルを移動
- **メタデータ永続化** — タグ・評価を `.imgraph.json` としてフォルダに保存

### アノテーション

- **BB 作成** — 画像上でドラッグして新規バウンディングボックスを作成
- **BB 移動 / リサイズ** — ドラッグで移動、四隅のハンドルでリサイズ
- **ラベル編集（2 経路）** — SVG バッジクリックでインライン入力 / 右パネルの検出リストで直接編集（Enter / Esc）
- **YOLO フォーマット保存** — 画像と同名の `.txt` ファイルに保存、`classes.txt` でクラス管理
- **アノテーション自動読込** — ファイル切り替え時に既存 `.txt` を自動ロード
- **アノテーションモード切替** — `A` キーまたはツールバーボタン（OFF 時はパン/ズームのみ）

### 物体検出

- **YOLOv8 ONNX 推論** — Rust の [`ort`](https://github.com/pykeio/ort) クレートで直接推論（Python 不要）
- **前処理** — letterbox リサイズ（640×640）・RGB 正規化・CHW テンソル変換
- **後処理** — クラス別 Greedy NMS（IoU ≥ 0.45）
- **信頼度閾値** — ⚙ パネルのスライダーで調整可能（デフォルト 0.25）

### NudeNet 部位検出

- **NudeNet v3 ONNX 推論** — Rust で直接推論（Python 不要）
- **組み込みクラス名** — 15 クラス（`FEMALE_BREAST_EXPOSED` / `BELLY_COVERED` 等）
- **信頼度閾値** — ⚙ パネルのスライダーで調整可能（デフォルト 0.20）
- **全画像一括推論** — ツールバーの「全画像 部位推定→保存」ボタンでディレクトリ内の全画像を順次推論・自動保存（進捗表示付き）

### NSFW 分類

- **ONNX 分類モデル対応** — `[1,2]` binary / `[1,1]` sigmoid / multi-class に自動対応
- **信頼スコア表示** — ゲージバーと % で右パネルに表示

### 顔検出・年齢推定

- **Rust ONNX モード（推奨）** — YOLOv8-face ONNX で顔検出、genderage ONNX で年齢/性別推定
  - `~/.insightface` からの genderage.onnx 自動検索
  - 顔検出モデル未設定 + 年齢モデル設定 → 画像全体へ直接適用（単体モード）
- **Python subprocess フォールバック** — InsightFace `buffalo_sc`（Python 環境が必要）
  - `os.dup2` による stdout 汚染対策

### データセット生成 & ローカル学習ループ

- **データセット構造生成** — アノテーション済み画像を train / val に分割し `dataset.yaml` を生成
- **Val 割合設定** — スライダーで 5〜40% を指定
- **学習プロセス起動** — Python スクリプトを非同期サブプロセスで起動
- **ログストリーミング** — stdout / stderr を UI にリアルタイム表示
- **多重起動防止** — `AtomicBool` フラグで保護

### ログウィンドウ

- **アプリログ** — 全推論の開始・完了・エラーをリアルタイム記録
- **エラーバッジ** — エラー件数をツールバーに表示
- `L` キーまたはツールバーボタンで表示/非表示切替

---

## キーボードショートカット

| キー | 操作 |
|------|------|
| `←` / `↑` | 前のファイル |
| `→` / `↓` | 次のファイル |
| `Home` / `End` | 最初 / 最後のファイル |
| `1`〜`5` | レーティング設定 |
| `0` | ズームリセット |
| `D` | 物体検出 |
| `F` | 顔検出 |
| `B` | 部位検出（NudeNet） |
| `N` | NSFW 判定 |
| `A` | アノテーションモード切替 |
| `L` | ログウィンドウ切替 |
| `Delete` / `BS` | 選択中 BB を削除 |
| `Esc` | BB 選択解除 |
| `Ctrl+S` | アノテーション保存 |
| `?` | ショートカット一覧表示 |

---

## 対応フォーマット

| 種別 | 拡張子 |
|------|--------|
| 画像 | jpg, jpeg, png, gif, bmp, webp, tiff, tif, avif |
| 動画 | mp4, webm, mkv, avi, mov, wmv, m4v, ogv |

---

## セットアップ

### 必要なもの

| ツール | バージョン |
|--------|-----------|
| [Node.js](https://nodejs.org/) | v18 以上 |
| [Rust](https://rustup.rs/) | stable |
| Linux 依存ライブラリ | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `libssl-dev`, `pkg-config` |

```bash
# Ubuntu / Debian
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  libssl-dev pkg-config
```

### ONNX 推論機能（物体検出 / NudeNet / 顔検出 Rust モード）

ONNX Runtime の共有ライブラリが必要です。

```bash
# Ubuntu
sudo apt-get install libonnxruntime-dev
# または ORT_DYLIB_PATH 環境変数で .so のパスを明示指定
```

### 顔検出 Python モードを使う場合（追加要件）

```bash
pip install insightface onnxruntime opencv-python
```

### インストール

```bash
git clone https://github.com/Mojo-affinity/imGraph.git
cd imGraph
npm install
```

### 開発サーバー起動

```bash
npm run tauri dev
```

### プロダクションビルド

```bash
npm run tauri build
```

Linux では `.AppImage` / `.deb`、Windows では `.msi` / `.exe` が `src-tauri/target/release/bundle/` に生成されます。

---

## 使い方

### 基本操作

1. ツールバーの **「フォルダを開く」** でメディアフォルダを選択
2. 左パネルのファイル一覧からファイルを選択（矢印キーでも移動可）
3. 右パネルで評価（星）とタグを編集 → 自動保存

### 推論の設定と実行

各推論ボタンの横にある **⚙** から ONNX モデルパスや閾値を設定・保存します。  
設定は `~/.imgraph/model_config.json` に永続化され、起動時に自動読み込みされます。

| ボタン | ⚙ で設定するもの |
|--------|----------------|
| 物体検出 | ONNX モデルパス・クラス名ファイル・信頼度閾値 |
| NSFW 判定 | ONNX モデルパス・クラス名ファイル（binary モデルは不要） |
| 部位検出 | NudeNet ONNX モデルパス (`640m.onnx`)・信頼度閾値 |
| 顔検出 | 顔検出 ONNX・genderage ONNX（または Python スクリプト） |

### 全画像 一括部位推定

フォルダを開いた状態でツールバーの **「全画像 部位推定→保存」** ボタンをクリックすると、  
ディレクトリ内のすべての画像に NudeNet 推論を実行し、YOLO フォーマットで自動保存します。

### データセット生成 & 学習

1. 右パネルの **「学習」** セクションを展開
2. **「データセット構造を生成」** でアノテーション済み画像を train / val に分割し `dataset.yaml` を生成
3. 学習スクリプトと `dataset.yaml` のパスを入力して **「学習を開始」**
4. ログが右パネルにリアルタイム表示されます

---

## プロジェクト構成

```
imGraph/
├── scripts/
│   ├── detect_faces.py         # InsightFace 顔検出・年齢推定スクリプト
│   └── train.py                # 学習スクリプト（バンドル同梱）
├── src/                        # React フロントエンド
│   ├── types.ts                # MediaFile / BoundingBox / ModelConfig 等の型定義
│   ├── store/
│   │   └── index.ts            # Zustand グローバルストア（全状態・アクション）
│   ├── hooks/
│   │   ├── useMediaStore.ts    # ストアラッパー（派生値追加）
│   │   └── usePrefetch.ts      # 隣接画像プリフェッチフック
│   ├── components/
│   │   ├── Toolbar.tsx         # フォルダ選択・推論ボタン・モデル設定パネル
│   │   ├── FileList.tsx        # ファイル一覧（ディレクトリグループ）
│   │   ├── MediaViewer.tsx     # 画像/動画表示 + BoundingBoxEditor オーバーレイ
│   │   ├── BoundingBoxEditor.tsx # SVG アノテーションエディタ
│   │   ├── MetadataPanel.tsx   # 評価・タグ・検出結果・学習セクション
│   │   └── LogWindow.tsx       # アプリログウィンドウ
│   ├── App.tsx                 # レイアウト・キーボードイベント・起動時初期化
│   └── App.css                 # ダークテーマ・全コンポーネントのスタイル
└── src-tauri/                  # Rust バックエンド
    ├── src/
    │   ├── main.rs             # エントリポイント
    │   ├── lib.rs              # Tauri コマンド登録・ModelConfig・ファイルスキャン
    │   ├── inference.rs        # 物体検出 / NudeNet / 顔検出（ONNX & Python）
    │   ├── face_inference.rs   # Rust ONNX 顔検出・年齢推定
    │   ├── nsfw.rs             # NSFW 画像分類（ONNX）
    │   ├── annotation.rs       # YOLO フォーマット読み書き
    │   ├── dataset.rs          # データセット構造生成（train / val 分割・YAML 生成）
    │   └── training.rs         # 学習プロセス起動・ログストリーミング
    ├── Cargo.toml
    ├── tauri.conf.json
    └── capabilities/
        └── default.json
```

---

## Tauri コマンド一覧

| コマンド | 主な引数 | 戻り値 | 説明 |
|----------|---------|--------|------|
| `scan_directory` | `path` | `()` | ディレクトリをスキャン（`scan-batch` / `scan-complete` イベントで配信） |
| `load_metadata` | `dir_path` | `HashMap<String, MediaMetadata>` | タグ・評価を `.imgraph.json` から読み込む |
| `save_metadata` | `dir_path, metadata` | `()` | タグ・評価を保存 |
| `save_annotation` | `image_path, boxes` | `()` | YOLO フォーマットで `.txt` に保存 |
| `load_annotation` | `image_path` | `Vec<BoundingBox>` | `.txt` からアノテーションを読み込む |
| `load_classes` | `dir_path` | `Vec<String>` | `classes.txt` からクラス名リストを読み込む |
| `detect_objects` | `image_path, model_path, class_names_path, conf_threshold` | `Vec<BoundingBox>` | YOLOv8 ONNX で物体検出 |
| `detect_nudenet` | `image_path, model_path, conf_threshold` | `Vec<BoundingBox>` | NudeNet ONNX で部位検出 |
| `classify_nsfw` | `image_path, model_path, class_names_path` | `NsfwResult` | ONNX で NSFW 分類 |
| `detect_faces_and_age` | `image_path, script_path, model_dir, face_det_model_path, face_genderage_model_path` | `Vec<BoundingBox>` | 顔検出・年齢推定（ONNX または Python） |
| `find_insightface_genderage` | — | `Option<String>` | `~/.insightface` から genderage.onnx を自動検索 |
| `generate_dataset` | `source_dir, output_dir, val_ratio` | `DatasetInfo` | train / val 分割 + dataset.yaml 生成 |
| `start_training` | `script_path, dataset_path, extra_args` | `()` | 学習プロセスを起動 |
| `get_is_training` | — | `bool` | 学習中かどうかを返す |
| `save_model_config` | `config: ModelConfig` | `()` | モデル設定を `~/.imgraph/model_config.json` に保存 |
| `load_model_config` | — | `ModelConfig` | モデル設定を読み込む |
| `get_bundled_scripts` | — | `BundledScripts` | バンドル済みスクリプトのパスを返す |

### Tauri イベント一覧

| イベント | ペイロード | 発行タイミング |
|----------|-----------|---------------|
| `scan-batch` | `Vec<MediaFile>` | スキャン中、50 件ごと |
| `scan-complete` | `()` | スキャン完了時 |
| `app-log` | `{ level, message }` | 推論の開始・完了・エラー時 |
| `training-log` | `String` | 学習プロセスの stdout / stderr 各行 |
| `training-complete` | `bool` | 学習プロセス終了時 |

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| UI | React 18 + TypeScript + Vite |
| 状態管理 | Zustand |
| デスクトップ | Tauri v2 (Rust) |
| アノテーション描画 | SVG オーバーレイ |
| 物体検出 / NudeNet | ort 2.x (ONNX Runtime) + ndarray + image |
| 顔検出（Rust モード） | YOLOv8-face ONNX + genderage ONNX（InsightFace 互換） |
| 顔検出（Python モード） | InsightFace subprocess + `os.dup2` による stdout 汚染対策 |
| NSFW 分類 | ONNX（binary / sigmoid / multi-class 自動対応） |
| アノテーション形式 | YOLO フォーマット（`.txt` + `classes.txt`） |

---

## リリース履歴

| バージョン | 内容 |
|-----------|------|
| v0.1.0 | 基本メディアビューワ（スキャン・表示・評価・タグ） |
| v0.1.1 | 再帰ディレクトリスキャン |
| v0.1.2 | 遅延スキャン（バッチ配信）+ 隣接画像プリフェッチ |
| v0.1.3 | ディレクトリグループ表示 |
| v0.2.0 | ML アノテーション・学習ループ全機能 |
| v0.2.1 | BBoxEditor バグ修正 |
| v0.2.2 | ラベル編集を HTML overlay に変更 |
| v0.2.3 | 顔検出・年齢推定（InsightFace Python subprocess） |
| v0.2.4 | ラベル編集 GUI 改善 |
| v0.2.5 | 顔検出 stdout 汚染バグ修正 |
| v0.3.0 | 物体検出を YOLOv8 ONNX 実推論に置き換え |
| v0.3.1 | データセット生成（train/val 分割・dataset.yaml）|
| v0.3.2 | NudeNet v3 ONNX 部位検出 |
| v0.3.3 | NSFW 画像分類（ONNX） |
| v0.3.4 | ログウィンドウ |
| v0.3.5 | キーボードショートカット（D/F/B/N）|
| v0.3.6 | アノテーションモード切替 |
| v0.3.7 | 顔検出 Rust ONNX モード（YOLOv8-face + genderage） |
| v0.3.8 | InsightFace genderage.onnx 自動検索 |
| v0.3.9 | softmax 加重平均年齢推定・出力順序自動検出 |
| v0.3.10 | age-gender 単体モード（顔検出モデル不要） |
| v0.3.11 | 全画像一括部位推定→保存ボタン・物体検出信頼度閾値設定化・store リファクタリング |

---

## ライセンス

MIT

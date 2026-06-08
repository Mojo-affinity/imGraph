# imGraph

ディレクトリ内の画像・動画ファイルを閲覧・タグ付け・評価できるマルチプラットフォームメディアビューワ。  
バウンディングボックスアノテーション、ONNX 物体検出、InsightFace 顔検出・年齢推定、ローカル学習ループ機能を統合したアノテーションツール。

---

## 機能

### メディアビューワ

- **ディレクトリスキャン** — サブフォルダを再帰的にスキャンし、対応フォーマットのファイルを一覧表示
- **遅延ストリーミング** — 50 件単位のバッチ配信でフォルダが大きくてもすぐに表示開始
- **ファイル一覧** — ディレクトリ単位でグループ化・展開/折りたたみ、スティッキーヘッダー
- **メディア表示** — 画像 / 動画の表示（object-fit: contain でレターボックス整合）
- **プリフェッチ** — 前後 2 件を事前ロード、最大 20 件のキャッシュ
- **5 段階評価** — 同じ星をクリックで解除
- **タグ付け** — タグの追加・削除
- **キーボードナビゲーション** — 矢印キーでファイルを移動（入力フォーカス中は無効）
- **メタデータ永続化** — タグ・評価を `.imgraph.json` としてスキャンしたフォルダに保存

### アノテーション

- **バウンディングボックス作成** — 画像上でドラッグして新規 BB を作成
- **BB 移動** — ボックス内をドラッグして移動
- **BB リサイズ** — 四隅のハンドルをドラッグしてリサイズ
- **BB 削除** — ×ボタンクリックで削除
- **ラベル編集（2 経路）**
  - SVG ラベルバッジをシングルクリック → ボックス上にインライン `<input>` を表示
  - 右パネルの検出リストで選択行のラベルを直接編集（Enter / Esc で確定）
- **YOLO フォーマット保存** — 画像と同名の `.txt` ファイルに自動保存、`classes.txt` でクラス管理
- **アノテーション自動読込** — ファイル切り替え時に既存の `.txt` アノテーションを自動ロード

### 物体検出（A-1）

- **YOLOv8 ONNX 推論** — Rust の [`ort`](https://github.com/pykeio/ort) クレートで直接推論（Python 不要）
- **前処理** — letterbox リサイズ（640×640）、RGB 正規化、CHW テンソル変換
- **後処理** — クラス別 Greedy NMS（confidence ≥ 0.25 / IoU ≥ 0.45）
- **モデル設定** — ⚙ ボタンから ONNX ファイルパスとクラス名ファイルを設定・保存

### 顔検出・年齢推定（A-2）

- **InsightFace `buffalo_sc`** — SCRFD 顔検出 + 年齢推定を Python subprocess で実行
- **stdout 汚染対策** — `os.dup2(2, 1)` で C レベルの stdout を stderr にリダイレクト、JSON のみ元 fd に書き込み
- **モデル設定** — ⚙ ボタンから `detect_faces.py` パスとモデルディレクトリを設定・保存
- **設定永続化** — `~/.imgraph/model_config.json` に保存（起動時自動読み込み）

### ローカル学習ループ

- **学習プロセス起動** — Python スクリプトを非同期サブプロセスで起動
- **ログストリーミング** — stdout / stderr を `training-log` イベントで UI にリアルタイム表示
- **多重起動防止** — `AtomicBool` フラグで同時に複数の学習を起動しない
- **パス設定** — 学習スクリプトパス・データセットパス・追加引数を UI から指定

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

### 顔検出機能を使う場合（追加要件）

```bash
pip install insightface onnxruntime opencv-python
```

### 物体検出機能を使う場合（追加要件）

- [ONNX Runtime](https://github.com/microsoft/onnxruntime/releases) の共有ライブラリ（`libonnxruntime.so`）が必要
  ```bash
  # Ubuntu の場合
  sudo apt-get install libonnxruntime-dev
  ```
  または `ORT_DYLIB_PATH` 環境変数でパスを明示指定

- 推論に使う YOLOv8 ONNX モデル（例: ultralytics でエクスポートしたもの）

  ```bash
  pip install ultralytics
  python -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx')"
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
2. 左パネルのファイル一覧からファイルを選択（↑↓ キーでも移動可）
3. 右パネルで評価（星）とタグを編集 → 自動保存

### アノテーション操作

| 操作 | 方法 |
|------|------|
| BB 作成 | 画像上でドラッグ |
| BB 移動 | ボックス内をドラッグ |
| BB リサイズ | 四隅の○ハンドルをドラッグ |
| BB 削除 | ×ボタンをクリック |
| ラベル編集 | ラベルバッジをクリック → テキスト入力 → Enter |
| アノテーション保存 | ツールバーの **「学習データとして保存」** |

保存先: `<画像ファイルと同じディレクトリ>/<画像名>.txt`（YOLO フォーマット）

### 物体検出の設定

1. **「物体検出」ボタン横の ⚙** をクリック
2. **ONNX モデル**: `best.onnx` のパスを選択
3. **クラス名ファイル**: `classes.txt` のパスを選択（省略時は `class_0`, `class_1` …）
4. **「保存」** → **「物体検出」** ボタンで推論実行

> `classes.txt` は 1 行 1 クラス名のテキストファイルです。  
> YOLO アノテーションを保存したフォルダに自動生成された `classes.txt` をそのまま使用できます。

### 顔検出の設定

1. **「顔検出」ボタン横の ⚙** をクリック
2. **Python スクリプト**: リポジトリ内の `scripts/detect_faces.py` のパスを選択
3. **モデルディレクトリ**: InsightFace のモデルを置くフォルダ（省略時は `~/.insightface`）
4. **「保存」** → **「顔検出」** ボタンで推論実行

検出結果は `face` ラベル + 推定年齢（age）付きで右パネルに表示されます。

### ローカル学習の起動

1. 右パネルの **「学習」** セクションを展開
2. 学習スクリプトのパスとデータセットパスを入力
3. **「学習開始」** ボタンでサブプロセスを起動
4. ログが右パネルにリアルタイム表示されます

---

## プロジェクト構成

```
imGraph/
├── scripts/
│   └── detect_faces.py         # InsightFace 顔検出・年齢推定スクリプト
├── src/                        # React フロントエンド
│   ├── types.ts                # MediaFile / BoundingBox / ModelConfig 等の型定義
│   ├── store/
│   │   └── index.ts            # Zustand グローバルストア（全状態・アクション）
│   ├── hooks/
│   │   ├── useMediaStore.ts    # ストアラッパー（派生値追加）
│   │   └── usePrefetch.ts      # 隣接画像プリフェッチフック
│   ├── components/
│   │   ├── Toolbar.tsx         # フォルダ選択・推論ボタン・モデル設定パネル
│   │   ├── FileList.tsx        # ファイル一覧（ディレクトリグループ・展開/折りたたみ）
│   │   ├── MediaViewer.tsx     # 画像/動画表示 + BoundingBoxEditor オーバーレイ
│   │   ├── BoundingBoxEditor.tsx # SVG アノテーションエディタ + HTML overlay ラベル入力
│   │   └── MetadataPanel.tsx   # 評価・タグ・検出結果リスト・学習セクション
│   ├── App.tsx                 # レイアウト・キーボードイベント・起動時初期化
│   └── App.css                 # ダークテーマ・全コンポーネントのスタイル
└── src-tauri/                  # Rust バックエンド
    ├── src/
    │   ├── main.rs             # エントリポイント
    │   ├── lib.rs              # Tauri コマンド登録・ModelConfig・ファイルスキャン
    │   ├── inference.rs        # 物体検出（ONNX）・顔検出（Python subprocess）
    │   ├── annotation.rs       # YOLO フォーマット読み書き
    │   └── training.rs         # 学習プロセス起動・ログストリーミング
    ├── Cargo.toml
    ├── tauri.conf.json         # ウィンドウ・セキュリティ・バンドル設定
    └── capabilities/
        └── default.json        # パーミッション設定
```

---

## Tauri コマンド一覧

| コマンド | 引数 | 戻り値 | 説明 |
|----------|------|--------|------|
| `scan_directory` | `path: String` | `()` | ディレクトリをスキャン（`scan-batch` / `scan-complete` イベントで結果を配信） |
| `load_metadata` | `dir_path: String` | `HashMap<String, MediaMetadata>` | `.imgraph.json` からタグ・評価を読み込む |
| `save_metadata` | `dir_path: String, metadata` | `()` | タグ・評価を `.imgraph.json` に書き込む |
| `save_annotation` | `image_path: String, boxes: Vec<BoundingBox>` | `()` | YOLO フォーマットで `.txt` に保存 |
| `load_annotation` | `image_path: String` | `Vec<BoundingBox>` | `.txt` からアノテーションを読み込む |
| `load_classes` | `dir_path: String` | `Vec<String>` | `classes.txt` からクラス名リストを読み込む |
| `detect_objects` | `image_path, model_path, class_names_path: String` | `Vec<BoundingBox>` | YOLOv8 ONNX で物体検出 |
| `detect_faces_and_age` | `image_path, script_path, model_dir: String` | `Vec<BoundingBox>` | InsightFace で顔検出・年齢推定 |
| `start_training` | `script_path, dataset_path: String, extra_args: Vec<String>` | `()` | 学習プロセスを起動（`training-log` / `training-complete` イベントで進捗配信） |
| `get_is_training` | — | `bool` | 学習中かどうかを返す |
| `save_model_config` | `config: ModelConfig` | `()` | モデル設定を `~/.imgraph/model_config.json` に保存 |
| `load_model_config` | — | `ModelConfig` | モデル設定を読み込む |

### Tauri イベント一覧

| イベント | ペイロード | 発行タイミング |
|----------|-----------|---------------|
| `scan-batch` | `Vec<MediaFile>` | スキャン中、50 件ごと |
| `scan-complete` | `()` | スキャン完了時 |
| `training-log` | `String` | 学習プロセスの stdout / stderr 各行 |
| `training-complete` | `bool` | 学習プロセス終了時 |

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| UI | React 18 + TypeScript + Vite |
| 状態管理 | Zustand |
| デスクトップ | Tauri v2 (Rust) |
| アノテーション描画 | SVG オーバーレイ（`preserveAspectRatio="xMidYMid meet"` で object-fit:contain と自動整合） |
| 物体検出 | ort 2.0.0-rc.12 (ONNX Runtime) + ndarray + image |
| 顔検出 | InsightFace (Python subprocess) + `os.dup2` による stdout 汚染対策 |
| アノテーション形式 | YOLO フォーマット（`.txt` + `classes.txt`） |

---

## リリース履歴

| バージョン | 内容 |
|-----------|------|
| v0.1.0 | 基本メディアビューワ（スキャン・表示・評価・タグ） |
| v0.1.1 | 再帰ディレクトリスキャン |
| v0.1.2 | 遅延スキャン（バッチ配信）+ 隣接画像プリフェッチ |
| v0.1.3 | ディレクトリグループ表示 |
| v0.2.0 | ML アノテーション・学習ループ全機能（Step 1-6）|
| v0.2.1 | BBoxEditor バグ修正（SVG 位置・削除・ラベル編集） |
| v0.2.2 | ラベル編集を `foreignObject` から HTML overlay に変更 |
| v0.2.3 | 顔検出・年齢推定（InsightFace Python subprocess）|
| v0.2.4 | ラベル編集 GUI 改善（シングルクリック + MetadataPanel インライン編集）|
| v0.2.5 | 顔検出 stdout 汚染バグ修正（`os.dup2` + Rust 側 JSON 行抽出） |
| v0.3.0 | 物体検出を YOLOv8 ONNX 実推論に置き換え（`ort` クレート）|

GitHub Actions により、タグ push で Linux / Windows 向けバイナリを自動ビルド・ドラフトリリース。

---

## ライセンス

MIT

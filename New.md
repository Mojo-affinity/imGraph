# プロジェクト概要

Tauri + React (TypeScript/Vite) で構築されたメディアビューアーアプリ（imGraph）に、機械学習モデルを用いた画像認識機能と、その結果を編集してローカルでの再学習（ファインチューニング）に回すアノテーション・学習ループ機能を実装します。

## 実装する機能

1. 既学習モデルを用いた顔の検知と年齢推定
2. 物体検出
3. 物体検知用バウンディングボックス編集機能（自動検出結果の修正、手動追加、削除、リサイズ、移動）
4. 修正されたバウンディングボックスの学習データ（YOLOフォーマット等）としてのエクスポート
5. アプリケーション内からのローカル学習プロセスの起動とステータス監視

## 技術スタック

- **Frontend**: React, TypeScript, Tailwind CSS, Zustand (`src/hooks/useMediaStore.ts`)
- **Backend**: Rust, Tauri
- **ML Ecosystem**:
  - 推論: `candle-core` / `candle-nn` などの Rust ネイティブなフレームワーク、または `ort` (ONNX Runtime)
  - 学習連携: Python スクリプトの呼び出し（`std::process::Command` または `PyO3` を用いた直接統合）

---

## ステップバイステップ実装指示

### Step 1: 型定義と状態管理の拡張

フロントエンドの `src/types.ts` および `src/hooks/useMediaStore.ts` を更新し、推論結果とバウンディングボックスの状態、および学習ステータスを管理できるようにしてください。

1. `types.ts` に以下の型を追加:

   ```typescript
   export interface BoundingBox {
     id: string;
     x: number; // 画像の元の幅に対する相対座標(0〜1)または絶対ピクセル
     y: number;
     width: number;
     height: number;
     label: string;
     confidence: number;
     age?: number; // 顔検知時の年齢推定用
   }
   ```

2. `useMediaStore.ts` に以下の状態とアクションを追加:
   - `boundingBoxes: BoundingBox[]`
   - `isTraining: boolean`
   - `trainingLogs: string[]`
   - `setBoundingBoxes`、`updateBoundingBox`、`removeBoundingBox`、`addBoundingBox` などのボックス操作関数
   - 学習ステータスやログを更新するアクション

### Step 2: Rust 側での推論コマンド実装 (バックエンド)

`src-tauri/src/main.rs` および `lib.rs` に推論用の Tauri コマンドを実装してください。

1. `Cargo.toml` に機械学習用のクレート（`candle-core` 等）、画像処理用クレート（`image`）を追加。
2. 以下の 2 つの Tauri コマンドを実装（まずはダミーまたは軽量な実装から開始）:
   - `#[tauri::command] async fn detect_objects(image_path: String) -> Result<Vec<BoundingBox>, String>`
   - `#[tauri::command] async fn detect_faces_and_age(image_path: String) -> Result<Vec<BoundingBox>, String>`

### Step 3: BoundingBoxEditor コンポーネントの作成

画像の上のレイヤーとして機能し、ボックスの描画と編集を行う `BoundingBoxEditor.tsx` を `src/components/` に新規作成してください。

1. SVG を使用してオーバーレイを作成し、`viewBox` を画像の実際のサイズに合わせる。
2. 状態管理（Zustand）から `boundingBoxes` を読み込み、`rect` 要素としてレンダリングする。
3. マウス/ポインターイベントを使用して以下を実装:
   - ドラッグ移動: ボックス内を掴んで移動。
   - リサイズ: 四隅またはエッジの制御点をドラッグしてサイズ変更。
   - 新規作成: 背景部分のドラッグ＆ドロップで新しいボックスを作成。
4. 各ボックスに `label`（存在する場合は `age` も）と、削除用の「×」ボタンを表示する。

### Step 4: アノテーションデータのエクスポート機能

フロントエンドで修正された `boundingBoxes` を、ローカル学習用のデータセット形式として保存します。

1. Rust 側: `#[tauri::command] async fn save_annotation(image_path: String, boxes: Vec<BoundingBox>) -> Result<(), String>` を実装。
   - 受け取った座標を YOLO フォーマット（`class_id x_center y_center width_normalized height_normalized`）に変換する。
   - 画像と同じディレクトリに、同名の `.txt` ファイルとして保存する。
2. Frontend 側: `Toolbar.tsx` に「学習データとして保存」ボタンを追加し、コマンドを呼び出す。

### Step 5: ローカル学習プロセスの起動と管理

Tauri バックエンドから、ローカル環境の Python 学習パイプラインを呼び出せるようにします。

1. Rust 側: `#[tauri::command] async fn start_training(dataset_path: String, model_config: String) -> Result<(), String>` を実装。
   - `std::process::Command` を使用して学習スクリプト（`train.py` 等）を非同期で起動。あるいは `PyO3` を用いて Rust プロセスから直接 Python 環境を呼び出す構成も考慮。
   - 学習の標準出力（ログ）を `app_handle.emit_all("training-log", log_line)` を用いてフロントエンドに逐次ストリーミングする。
2. Frontend 側: `Toolbar.tsx` 等に「再学習を開始」ボタンを追加。
   - Tauri の Event リスナー（`listen('training-log', ...)`）を設定し、受信したログをコンソール風の UI パネルに表示する。

### Step 6: UI への統合

既存コンポーネントにこれまでの機能を組み込んでください。

1. `MediaViewer.tsx`: 画像の `img` タグの上に `BoundingBoxEditor` を絶対配置（`absolute`）で重ねる。画像の表示スケールに合わせて SVG の座標が正確にマッピングされるよう計算する。
2. `Toolbar.tsx`: 推論実行ボタン、保存ボタン、学習開始ボタンを配置。
3. `MetadataPanel.tsx`: 検出されたオブジェクトリスト、推定年齢、学習ログ（ターミナル風表示）を表示。

---

## 制約事項と考慮点

- **データの正規化**: UI 上での画像の拡大縮小やパン操作に関わらず、エクスポートされる YOLO フォーマットの座標は、必ず「元の画像サイズに対する 0.0〜1.0 の相対値」として正確に計算してください。
- **クラス ID のマッピング**: ラベル名（文字列）と学習モデル用のクラス ID（整数）を相互変換するマッピング設定ファイル（例: `classes.yaml`）を管理するロジックを Rust 側に持たせてください。
- **非ブロッキング処理**: 学習プロセスや推論は非常に重い処理になるため、Tauri のメインスレッドをブロックしないよう非同期実行（`tokio::spawn` など）を徹底してください。

---

## A-2 実装仕様（v0.2.3）

### 方式決定

`ort` クレートによる Rust ネイティブ推論ではなく、**Python subprocess** 方式を採用。
理由: RetinaFace の後処理（アンカー生成・NMS・座標デコード）が Rust では実装コストが高く、
すでに学習パイプラインで Python 環境が前提となっているため。

### 採用ライブラリ

```
pip install insightface onnxruntime opencv-python
```

- **顔検出 + 年齢推定**: InsightFace `buffalo_sc` モデルパック
  - 顔検出: SCRFD (Sample and Computation Redistribution Face Detector)
  - 年齢/性別: InsightFace付属 genderage モデル
  - モデルは `~/.insightface/models/buffalo_sc/` に自動ダウンロード

### コマンドインターフェース（Rust）

```rust
// 変更後
detect_faces_and_age(image_path, script_path, model_dir) -> Vec<BoundingBox>
```

### 設定の永続化

`~/.imgraph/model_config.json` に保存:
```json
{ "face_script_path": "/path/to/detect_faces.py", "face_model_dir": "" }
```

### 処理フロー

```
UI → invoke('detect_faces_and_age', { imagePath, scriptPath, modelDir })
  → Rust: spawn_blocking(python3 detect_faces.py --image ... [--model-dir ...])
  → Python: InsightFace で顔検出 + 年齢推定
  → stdout: JSON 配列
  → Rust: JSON パース → Vec<BoundingBox>
  → フロントエンド
```

### UI 変更

Toolbar の顔検出ボタン横に ⚙ アイコンを追加。クリックで設定パネルが展開:
- Python スクリプトパス（ファイル選択）
- モデルディレクトリ（フォルダ選択、空 = insightface デフォルト `~/.insightface`）
- 保存ボタン（`~/.imgraph/model_config.json` に書き込み）

---

## 残務（v0.2.1 時点）

### A. 推論（実装が必須）

| # | 内容 | 状態 |
|---|------|------|
| A-1 | `detect_objects` をダミーから実 ONNX 推論に置き換え（`ort` クレート + YOLOv8n ONNX） | ダミー実装 |
| A-2 | `detect_faces_and_age` を実装（InsightFace Python スクリプト経由） | **実装済み (v0.2.3)** |
| A-3 | 推論コマンドに `model_path` 引数を追加し、UI からモデルファイルを選択できるようにする | **実装済み (v0.2.3)** |

### B. データセット・学習連携

| # | 内容 | 状態 |
|---|------|------|
| B-1 | `dataset.yaml` + `train/val/images/labels` ディレクトリ構造の自動生成 | 未実装 |
| B-2 | 学習スクリプト（`train.py`）・データセットパスを UI から選択するダイアログ | 未実装（ハードコード前提） |

### C. UX 改善

| # | 内容 | 状態 |
|---|------|------|
| C-1 | 画像のホイールズームとパン（現在は `object-fit:contain` 固定） | 未実装 |
| C-2 | アノテーションモード ON/OFF トグル（常時描画モードで誤操作が起きやすい） | 未実装 |
| C-3 | クラス一覧から選べるラベル入力補完（現状はフリーテキスト） | 未実装 |

# imGraph Windows 実行マニュアル

## 目次

1. [インストール](#1-インストール)
2. [初回起動と基本操作](#2-初回起動と基本操作)
3. [物体検出のセットアップ](#3-物体検出のセットアップ)
4. [顔検出のセットアップ](#4-顔検出のセットアップ)
5. [アノテーション操作](#5-アノテーション操作)
6. [データセット生成と学習](#6-データセット生成と学習)
7. [ソースからビルドする場合](#7-ソースからビルドする場合)
8. [トラブルシューティング](#8-トラブルシューティング)

---

## 1. インストール

### 1-1. リリース版インストーラーを使う（推奨）

1. [GitHub Releases](https://github.com/Mojo-affinity/imGraph/releases) から最新版の  
   `imGraph_X.X.X_x64-setup.exe`（または `_x64_en-US.msi`）をダウンロード
2. ダウンロードしたファイルをダブルクリックしてインストーラーを実行
3. 「Windows によって PC が保護されました」と表示された場合は  
   **「詳細情報」→「実行」** をクリック（署名なしビルドのため）
4. 画面の指示に従いインストール完了

インストール後、スタートメニューまたはデスクトップのショートカットから **imGraph** を起動します。

### 1-2. 必要な Windows バージョン

| 要件 | 詳細 |
|------|------|
| OS | Windows 10 バージョン 1803 以降、または Windows 11 |
| WebView2 | Windows 10/11 には通常プリインストール済み。未インストールの場合は [Microsoft 公式](https://developer.microsoft.com/ja-jp/microsoft-edge/webview2/) から入手 |
| アーキテクチャ | x64（64 ビット）のみ対応 |

---

## 2. 初回起動と基本操作

### 2-1. フォルダを開く

1. ツールバー左端の **「フォルダを開く」** をクリック
2. 画像・動画が入ったフォルダを選択
3. サブフォルダを含む全ファイルが左パネルに一覧表示される

### 2-2. ファイルの閲覧

| 操作 | 方法 |
|------|------|
| ファイル選択 | 左パネルのファイル名をクリック |
| 前後に移動 | ← → キー（または ↑ ↓ キー） |
| ディレクトリ折りたたみ | ディレクトリ名をクリック |

### 2-3. 評価・タグ付け

- **評価**: 右パネルの星をクリック（同じ星を再クリックで解除）
- **タグ追加**: 右パネル下部の入力欄にタグ名を入力して **Enter**
- **タグ削除**: タグの右の **×** をクリック
- **自動保存**: 評価・タグは `.imgraph.json` として画像フォルダに自動保存

---

## 3. 物体検出のセットアップ

物体検出には **ONNX Runtime** ライブラリと **YOLOv8 ONNX モデル** が必要です。

### 3-1. ONNX Runtime のインストール

1. [ONNX Runtime GitHub Releases](https://github.com/microsoft/onnxruntime/releases) を開く
2. 最新の `onnxruntime-win-x64-X.X.X.zip` をダウンロード
3. ZIP を展開（例: `C:\onnxruntime\`）
4. 展開後のフォルダ内に `lib\onnxruntime.dll` があることを確認

5. **環境変数 `ORT_DYLIB_PATH` を設定する**  
   スタートメニューで「環境変数」と検索 → **「システム環境変数の編集」** を開く  
   → **「環境変数」** → **「新規（システム）」** をクリック

   | 変数名 | 値 |
   |--------|----|
   | `ORT_DYLIB_PATH` | `C:\onnxruntime\lib\onnxruntime.dll` |

   > パスは実際に展開した場所に合わせて変更してください。

6. 設定後は imGraph を**再起動**してください

### 3-2. YOLOv8 ONNX モデルの準備

自前データでの学習済みモデルを使用します（手順は [6章](#6-データセット生成と学習) 参照）。  
動作確認目的で公式の事前学習済みモデルを使う場合:

```powershell
pip install ultralytics
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx')"
```

カレントディレクトリに `yolov8n.onnx` が生成されます。

### 3-3. imGraph での設定

1. 画像ファイルを選択した状態でツールバーの **「物体検出」ボタン横の ⚙** をクリック
2. **ONNX モデル**欄のフォルダアイコンをクリックし、`.onnx` ファイルを選択
3. **クラス名ファイル**欄でアノテーション時に生成した `classes.txt` を選択  
   （省略時は `class_0`, `class_1` … と表示されます）
4. **「保存」** をクリック
5. ツールバーの **「物体検出」** をクリックして推論実行

---

## 4. 顔検出のセットアップ

顔検出には **Python** と **InsightFace** ライブラリが必要です。

### 4-1. Python のインストール

1. [Python 公式サイト](https://www.python.org/downloads/windows/) から **Python 3.10 以降** をダウンロード
2. インストーラーを実行する際に  
   **「Add Python to PATH」に必ずチェックを入れる**
3. インストール完了後、コマンドプロンプトで確認:

   ```cmd
   python --version
   ```

   `Python 3.x.x` と表示されれば OK

### 4-2. 依存ライブラリのインストール

コマンドプロンプト（管理者権限推奨）で実行:

```cmd
pip install insightface onnxruntime opencv-python
```

> **GPU を使う場合**: `onnxruntime` の代わりに `onnxruntime-gpu` をインストール  
> その場合 CUDA と cuDNN も別途インストールが必要です

### 4-3. モデルデータの初回ダウンロード

InsightFace は初回実行時にモデルを自動ダウンロードします。  
デフォルトのダウンロード先: `C:\Users\<ユーザー名>\.insightface\`

### 4-4. imGraph での設定

1. ツールバーの **「顔検出」ボタン横の ⚙** をクリック
2. **Python スクリプト**欄: インストール済みの場合は自動入力されています。  
   空の場合はフォルダアイコンから imGraph インストール先の  
   `scripts\detect_faces.py` を選択
   
   > 標準インストール先: `C:\Program Files\imGraph\scripts\detect_faces.py`

3. **モデルディレクトリ**欄: 通常は空欄のまま（`~\.insightface` を自動使用）  
   別の場所にモデルを置く場合のみ指定
4. **「保存」** をクリック
5. ツールバーの **「顔検出」** をクリックして推論実行

検出結果は右パネルに **ラベル「face」+ 推定年齢** で表示されます。

---

## 5. アノテーション操作

### 5-1. バウンディングボックスの作成・編集

| 操作 | 方法 |
|------|------|
| BB 新規作成 | 画像上でドラッグ |
| BB 移動 | ボックス内をドラッグ |
| BB リサイズ | 四隅の ○ ハンドルをドラッグ |
| BB 削除 | ボックス右上の **×** をクリック |
| ラベル編集 | ラベルバッジ（ボックス左上のテキスト）をクリック → 入力 → **Enter** |
| ラベル編集（別経路） | 右パネルの検出リストで対象行をクリック → 名前欄を直接編集 |

### 5-2. アノテーションの保存

ツールバー右の **「学習データとして保存」** をクリック。

保存形式（YOLO フォーマット）:
```
<画像と同じフォルダ>/
├── 画像名.jpg
├── 画像名.txt        ← 各行: クラスID cx cy w h（正規化座標）
└── classes.txt       ← クラス名一覧（1行1クラス）
```

### 5-3. 既存アノテーションの読み込み

ファイルを選択した際、同名の `.txt` が存在すれば自動的に読み込まれます。

---

## 6. データセット生成と学習

### 6-1. 学習環境の準備

```cmd
pip install ultralytics
```

### 6-2. データセット構造の生成（B-1）

複数の画像にアノテーションを付けて保存した後:

1. 右パネル下部の **「学習」** セクションをクリックして展開
2. **「データセット構造を生成 ▶」** をクリック
3. 設定を入力:

   | 項目 | 説明 |
   |------|------|
   | 出力先フォルダ | 生成するデータセットの保存先（デフォルト: 画像フォルダ内の `dataset` サブフォルダ） |
   | Val 割合 | 検証データの割合（デフォルト: 20%） |

4. **「⚙ データセットを生成」** をクリック

生成されるフォルダ構造:
```
dataset\
├── images\
│   ├── train\   ← 学習画像
│   └── val\     ← 検証画像
├── labels\
│   ├── train\   ← 学習ラベル
│   └── val\     ← 検証ラベル
└── dataset.yaml ← 学習設定ファイル
```

生成が完了すると、`dataset.yaml` のパスが自動的に下の **「データセット」** 欄に入力されます。

### 6-3. 学習の実行（B-2）

1. **「学習スクリプト」** 欄: インストール済みの場合は自動入力済み。  
   空の場合は `scripts\train.py` を選択

   > 標準インストール先: `C:\Program Files\imGraph\scripts\train.py`

2. **「データセット (dataset.yaml)」** 欄: データセット生成後は自動入力済み

3. **「追加引数（任意）」** 欄に学習オプションを入力（例）:

   ```
   --epochs 100 --batch 8 --model yolov8n.pt
   ```

   | 引数 | 意味 | デフォルト |
   |------|------|-----------|
   | `--epochs` | 学習エポック数 | 50 |
   | `--batch` | バッチサイズ | 16（GPU メモリ不足なら 8 に下げる） |
   | `--model` | ベースモデル | `yolov8n.pt`（自動ダウンロード） |
   | `--imgsz` | 入力画像サイズ | 640 |
   | `--device` | デバイス指定（`cpu` / `0`） | 自動 |

4. **「▶ 学習を開始」** をクリック

学習のログが右パネルにリアルタイム表示されます。

### 6-4. 学習済みモデルの使用

学習完了時にログに表示される ONNX モデルのパスをコピーします:

```
✓ ONNX モデル: C:\Users\<ユーザー名>\runs\train\exp\weights\best.onnx
```

このパスを [3-3 章](#3-3-imgraph-での設定) の手順で **ONNX モデル** 欄に設定します。  
同じ `dataset\classes.txt` を **クラス名ファイル** 欄に設定します。

---

## 7. ソースからビルドする場合

### 7-1. 必要なツール

| ツール | 入手先 | 備考 |
|--------|--------|------|
| Node.js 18 以上 | https://nodejs.org/ | LTS 版推奨 |
| Rust (stable) | https://rustup.rs/ | `rustup-init.exe` を実行 |
| Visual Studio Build Tools | https://visualstudio.microsoft.com/ja/visual-cpp-build-tools/ | 「C++ によるデスクトップ開発」ワークロードを選択 |
| Git | https://git-scm.com/ | — |

> **注意**: Rust のインストール後は**コマンドプロンプトを再起動**してパスを反映させてください。

### 7-2. ビルド手順

```cmd
git clone https://github.com/Mojo-affinity/imGraph.git
cd imGraph
npm install
```

**開発モードで起動（ホットリロードあり）:**
```cmd
npm run tauri dev
```

**リリースビルド（インストーラー生成）:**
```cmd
set ORT_DYLIB_PATH=C:\onnxruntime\lib\onnxruntime.dll
npm run tauri build
```

生成物: `src-tauri\target\release\bundle\` 以下

| ファイル | 形式 |
|----------|------|
| `nsis\imGraph_X.X.X_x64-setup.exe` | NSIS インストーラー |
| `msi\imGraph_X.X.X_x64_en-US.msi` | MSI インストーラー |

---

## 8. トラブルシューティング

### アプリが起動しない（WebView2 エラー）

**症状**: 起動直後にエラーダイアログが表示される  
**対処**: [Microsoft Edge WebView2 ランタイム](https://developer.microsoft.com/ja-jp/microsoft-edge/webview2/) をインストール

---

### 物体検出で「ORT 初期化エラー」が出る

**原因**: `ORT_DYLIB_PATH` が未設定、またはパスが間違っている  
**対処**:
1. 環境変数 `ORT_DYLIB_PATH` が正しく設定されているか確認
2. 設定後に imGraph を**再起動**する
3. パスに `onnxruntime.dll` が実際に存在するか確認

```cmd
echo %ORT_DYLIB_PATH%
dir "%ORT_DYLIB_PATH%"
```

---

### 顔検出で「Python が見つかりません」というエラーが出る

**原因**: Python が PATH に追加されていない  
**対処**:
1. コマンドプロンプトで `python --version` を実行して確認
2. エラーが出る場合は Python を**「Add Python to PATH」チェック付き**で再インストール

---

### 顔検出で「insightface がインストールされていません」というエラーが出る

```cmd
pip install insightface onnxruntime opencv-python
```

インストール後、再度推論を実行してください。

---

### 顔検出のモデルダウンロードに失敗する

**原因**: InsightFace のモデルサーバーへのアクセスが制限されている  
**対処**:
1. [InsightFace モデルページ](https://github.com/deepinsight/insightface/tree/master/model_zoo) から `buffalo_sc` を手動ダウンロード
2. `C:\Users\<ユーザー名>\.insightface\models\buffalo_sc\` に配置
3. 顔検出 ⚙ の **モデルディレクトリ** に `C:\Users\<ユーザー名>\.insightface` を指定

---

### 学習スクリプトで「ultralytics がインストールされていません」というエラーが出る

```cmd
pip install ultralytics
```

---

### 学習中にメモリ不足エラーが出る

追加引数に `--batch 8`（または `--batch 4`）を指定してバッチサイズを下げてください。

---

### Windows Defender がインストーラーをブロックする

署名なしビルドのため警告が出る場合があります。  
**「詳細情報」→「実行」** で続行できます。  
不安な場合はソースコードから[自分でビルド](#7-ソースからビルドする場合)してください。

---

### ファイルパスに日本語・スペースが含まれる場合

ONNX モデル・スクリプト・データセットのパスは  
**英数字のみのパス**（例: `C:\imGraph\models\best.onnx`）を推奨します。  
パスに空白や日本語が含まれる場合、一部の処理が正常に動作しないことがあります。

---

## まとめ：初回セットアップ チェックリスト

```
□ imGraph インストーラーを実行してインストール完了
□ imGraph を起動して画像フォルダを開けることを確認
□ （物体検出を使う場合）ONNX Runtime をダウンロードして ORT_DYLIB_PATH を設定
□ （顔検出・学習を使う場合）Python をインストール（Add to PATH にチェック）
□ （顔検出を使う場合）pip install insightface onnxruntime opencv-python
□ （学習を使う場合）pip install ultralytics
□ imGraph を再起動して顔検出 ⚙ のスクリプトパスが自動入力されているか確認
```

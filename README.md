# imGraph

ディレクトリ構造中にある画像・動画ファイルを閲覧・タグ付け・評価できるマルチプラットフォームメディアビューワ。

## 対応環境

- Linux
- Windows

## 技術スタック

- **フロントエンド:** React 18 + TypeScript + Vite
- **バックエンド:** Tauri v2 (Rust)

## 機能

### 実装済み

- **ディレクトリスキャン** — フォルダを選択し、対応フォーマットのファイルを一覧表示
- **ファイル一覧** — サムネイル付きのファイルリスト（左サイドバー）
- **メディア表示** — 画像・動画のビューワ（中央パネル）
- **評価** — 5段階の星評価（同じ星をクリックで解除）
- **タグ付け** — タグの追加・削除
- **キーボードナビゲーション** — 矢印キーでファイルを移動（テキスト入力中は無効）
- **メタデータ永続化** — タグ・評価を `.imgraph.json` としてスキャンしたフォルダに保存

### 対応フォーマット

| 種別 | 拡張子 |
|------|--------|
| 画像 | jpg, jpeg, png, gif, bmp, webp, tiff, tif, avif |
| 動画 | mp4, webm, mkv, avi, mov, wmv, m4v, ogv |

## 開発環境のセットアップ

### 必要なもの

- [Node.js](https://nodejs.org/) v18 以上
- [Rust](https://rustup.rs/) (stable)
- Linux: `libwebkit2gtk-4.1`, `libgtk-3`, `libayatana-appindicator3` 等の依存ライブラリ

### インストール

```bash
npm install
```

### 開発サーバー起動

```bash
npm run tauri dev
```

### ビルド

```bash
npm run tauri build
```

## プロジェクト構成

```
imGraph/
├── src/                        # React フロントエンド
│   ├── types.ts                # 型定義 (MediaFile, MediaMetadata)
│   ├── hooks/
│   │   └── useMediaStore.ts    # 状態管理フック
│   ├── components/
│   │   ├── Toolbar.tsx         # ツールバー（フォルダ選択）
│   │   ├── FileList.tsx        # ファイル一覧（左サイドバー）
│   │   ├── MediaViewer.tsx     # メディア表示（中央）
│   │   └── MetadataPanel.tsx   # タグ・評価（右サイドバー）
│   ├── App.tsx                 # レイアウト・キーボードイベント
│   └── App.css                 # スタイル（ダークテーマ）
└── src-tauri/                  # Rust バックエンド
    ├── src/
    │   ├── main.rs             # エントリポイント
    │   └── lib.rs              # Tauri コマンド定義
    ├── Cargo.toml
    ├── tauri.conf.json         # ウィンドウ・セキュリティ設定
    └── capabilities/
        └── default.json        # パーミッション設定
```

### Tauri コマンド (Rust → JS)

| コマンド | 引数 | 戻り値 | 説明 |
|----------|------|--------|------|
| `scan_directory` | `path: String` | `Vec<MediaFile>` | ディレクトリをスキャンしてメディアファイル一覧を返す |
| `load_metadata` | `dir_path: String` | `HashMap<String, MediaMetadata>` | `.imgraph.json` からメタデータを読み込む |
| `save_metadata` | `dir_path: String, metadata: ...` | `()` | メタデータを `.imgraph.json` に書き込む |

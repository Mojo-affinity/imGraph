#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "ultralytics>=8.0",
# ]
# ///
"""
imGraph 学習スクリプト — YOLOv8 ファインチューニング

imGraph の「学習を開始」ボタンから以下の形式で呼び出される:
    uv run train.py --data dataset.yaml [オプション]

必須引数:
    --data      dataset.yaml のパス（imGraph のデータセット生成で作成）

オプション:
    --model     ベースモデル（デフォルト: yolov8n.pt）
                  yolov8n.pt / yolov8s.pt / yolov8m.pt / yolov8l.pt
                  または fine-tune 済みの .pt ファイルのパス
    --epochs    学習エポック数（デフォルト: 50）
    --batch     バッチサイズ（デフォルト: 16、メモリ不足なら 8 に下げる）
    --imgsz     入力画像サイズ（デフォルト: 640）
    --device    デバイス: '' (自動), 'cpu', '0' (GPU 0)（デフォルト: 自動）
    --project   出力ディレクトリ（デフォルト: runs/train）
    --name      実験名（デフォルト: exp）

学習完了後に best.pt を自動的に ONNX 形式へエクスポートする。
エクスポートされた best.onnx を imGraph の「物体検出設定 ⚙」で指定すれば推論に使用可能。

依存パッケージ（uv が自動管理）:
    ultralytics>=8.0
"""

import argparse
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="imGraph YOLOv8 学習スクリプト",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--data",    required=True,          help="dataset.yaml のパス")
    parser.add_argument("--model",   default="yolov8n.pt",   help="ベースモデル (default: yolov8n.pt)")
    parser.add_argument("--epochs",  type=int, default=50,   help="エポック数 (default: 50)")
    parser.add_argument("--batch",   type=int, default=16,   help="バッチサイズ (default: 16)")
    parser.add_argument("--imgsz",   type=int, default=640,  help="入力画像サイズ (default: 640)")
    parser.add_argument("--device",  default="",             help="デバイス: '' / 'cpu' / '0' (default: 自動)")
    parser.add_argument("--project", default="runs/train",   help="出力ディレクトリ (default: runs/train)")
    parser.add_argument("--name",    default="exp",          help="実験名 (default: exp)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # dataset.yaml の存在確認
    data_path = Path(args.data)
    if not data_path.exists():
        print(f"[ERR] dataset.yaml が見つかりません: {args.data}", flush=True)
        sys.exit(1)

    print("▶ imGraph 学習スクリプト", flush=True)
    print(f"  dataset : {args.data}", flush=True)
    print(f"  model   : {args.model}", flush=True)
    print(f"  epochs  : {args.epochs}", flush=True)
    print(f"  batch   : {args.batch}", flush=True)
    print(f"  imgsz   : {args.imgsz}", flush=True)
    print(f"  device  : {args.device or '自動'}", flush=True)
    print("", flush=True)

    # ultralytics のインポート確認
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[ERR] ultralytics がインストールされていません。", flush=True)
        print("[ERR]   uv をインストールして uv run train.py で実行するか、", flush=True)
        print("[ERR]   pip install ultralytics を実行してください。", flush=True)
        sys.exit(1)

    # ベースモデルの読み込み
    print(f"▶ モデルを読み込み中: {args.model}", flush=True)
    try:
        model = YOLO(args.model)
    except Exception as e:
        print(f"[ERR] モデル読み込み失敗: {e}", flush=True)
        sys.exit(1)

    # 学習実行
    print(f"▶ 学習を開始します（{args.epochs} エポック）", flush=True)
    try:
        results = model.train(
            data=str(data_path.resolve()),
            epochs=args.epochs,
            batch=args.batch,
            imgsz=args.imgsz,
            device=args.device or None,
            project=args.project,
            name=args.name,
            verbose=True,
        )
    except Exception as e:
        print(f"[ERR] 学習エラー: {e}", flush=True)
        sys.exit(1)

    save_dir = Path(results.save_dir)
    print("", flush=True)
    print(f"✓ 学習完了: {save_dir}", flush=True)

    # best.pt → ONNX エクスポート
    best_pt = save_dir / "weights" / "best.pt"
    if not best_pt.exists():
        print(f"[ERR] best.pt が見つかりません: {best_pt}", flush=True)
        sys.exit(1)

    print(f"▶ ONNX エクスポート中: {best_pt}", flush=True)
    try:
        export_model = YOLO(str(best_pt))
        onnx_path = export_model.export(format="onnx", imgsz=args.imgsz)
        print(f"✓ ONNX モデル: {onnx_path}", flush=True)
        print("", flush=True)
        print("── 次のステップ ─────────────────────────────────────", flush=True)
        print(f"  1. imGraph の「物体検出 ⚙」を開く", flush=True)
        print(f"  2. ONNX モデル: {onnx_path}", flush=True)
        print(f"  3. クラス名ファイル: {data_path.parent / 'classes.txt'}", flush=True)
        print("────────────────────────────────────────────────────", flush=True)
    except Exception as e:
        print(f"[ERR] ONNX エクスポート失敗: {e}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

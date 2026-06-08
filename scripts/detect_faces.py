#!/usr/bin/env python3
"""
顔検出 + 年齢推定スクリプト（InsightFace 使用）
stdout に JSON 配列を出力する。エラーは stderr に出力して exit(1)。

必要パッケージ:
    pip install insightface onnxruntime opencv-python

モデル:
    初回実行時に InsightFace が buffalo_sc を
    ~/.insightface/models/buffalo_sc/ へ自動ダウンロードする。
    --model-dir でダウンロード先ルートを変更可能。

使用例:
    python3 detect_faces.py --image /path/to/image.jpg
    python3 detect_faces.py --image /path/to/image.jpg --model-dir /custom/root
"""
import sys
import json
import argparse


def main() -> None:
    ap = argparse.ArgumentParser(description="顔検出 + 年齢推定")
    ap.add_argument("--image", required=True, help="入力画像パス")
    ap.add_argument("--model-dir", default=None,
                    help="InsightFace モデルルートディレクトリ (省略時: ~/.insightface)")
    ap.add_argument("--model-pack", default="buffalo_sc",
                    help="モデルパック名 (default: buffalo_sc)")
    ap.add_argument("--det-thresh", type=float, default=0.5,
                    help="検出スコア閾値 (default: 0.5)")
    args = ap.parse_args()

    try:
        import cv2
        from insightface.app import FaceAnalysis
    except ImportError as e:
        print(f"ImportError: {e}\n"
              "  pip install insightface onnxruntime opencv-python",
              file=sys.stderr)
        sys.exit(1)

    # モデルロード
    init_kwargs: dict = {"name": args.model_pack}
    if args.model_dir:
        init_kwargs["root"] = args.model_dir

    try:
        app = FaceAnalysis(**init_kwargs)
        app.prepare(ctx_id=-1, det_thresh=args.det_thresh)  # ctx_id=-1 = CPU
    except Exception as e:
        print(f"モデルロードエラー: {e}", file=sys.stderr)
        sys.exit(1)

    # 画像ロード
    img = cv2.imread(args.image)
    if img is None:
        print(f"画像を読み込めません: {args.image}", file=sys.stderr)
        sys.exit(1)

    h, w = img.shape[:2]

    # 推論
    try:
        faces = app.get(img)
    except Exception as e:
        print(f"推論エラー: {e}", file=sys.stderr)
        sys.exit(1)

    # 結果を BoundingBox JSON に変換
    boxes = []
    for i, face in enumerate(faces):
        x1, y1, x2, y2 = face.bbox.tolist()
        x1 = max(0.0, x1)
        y1 = max(0.0, y1)
        x2 = min(float(w), x2)
        y2 = min(float(h), y2)
        if x2 <= x1 or y2 <= y1:
            continue

        age: int | None = None
        if hasattr(face, "age") and face.age is not None:
            age = int(round(float(face.age)))

        boxes.append({
            "id": f"face-{i}",
            "x": x1 / w,
            "y": y1 / h,
            "width": (x2 - x1) / w,
            "height": (y2 - y1) / h,
            "label": "face",
            "confidence": float(face.det_score),
            "age": age,
        })

    print(json.dumps(boxes, ensure_ascii=False))


if __name__ == "__main__":
    main()

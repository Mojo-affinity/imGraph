import { useRef, useState, useCallback } from 'react'; // useState: editState, preview
import { useStore } from '../store';
import type { BoundingBox } from '../types';

// ─── Types ────────────────────────────────────────────────────

type Handle = 'tl' | 'tr' | 'bl' | 'br';

type Drag =
  | { type: 'none' }
  | { type: 'creating'; x0: number; y0: number }
  | { type: 'moving';   id: string; ox: number; oy: number; mx: number; my: number }
  | { type: 'resizing'; id: string; handle: Handle; orig: BoundingBox; mx: number; my: number };

const MIN_SIZE = 0.01; // 正規化座標での最小ボックスサイズ

// ─── Component ────────────────────────────────────────────────

interface Props {
  naturalWidth: number;
  naturalHeight: number;
}

export function BoundingBoxEditor({ naturalWidth, naturalHeight }: Props) {
  const {
    boundingBoxes, addBoundingBox, updateBoundingBox, removeBoundingBox,
    selectedBoxId, setSelectedBoxId,
  } = useStore();
  const svgRef = useRef<SVGSVGElement>(null);

  // dragRef でドラッグ状態を保持（再レンダーを最小化）
  const dragRef = useRef<Drag>({ type: 'none' });
  const [editState, setEditState] = useState<{ id: string; label: string } | null>(null);
  // 作成中のプレビュー矩形のみ state で管理（表示更新が必要なため）
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // クライアント座標 → 正規化座標 (0-1) 変換
  const toNorm = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current;
    if (!svg || !naturalWidth || !naturalHeight) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return {
      x: Math.max(0, Math.min(1, p.x / naturalWidth)),
      y: Math.max(0, Math.min(1, p.y / naturalHeight)),
    };
  }, [naturalWidth, naturalHeight]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toNorm(e.clientX, e.clientY);
    const el = e.target as SVGElement;
    const action = el.dataset.action;
    const boxId = el.dataset.boxId;

    if (action === 'delete') return; // onClick で処理

    if (action === 'move' && boxId) {
      const box = boundingBoxes.find(b => b.id === boxId);
      if (!box) return;
      setSelectedBoxId(boxId);
      setEditState(null);
      dragRef.current = { type: 'moving', id: boxId, ox: box.x, oy: box.y, mx: x, my: y };

    } else if (action === 'resize' && boxId) {
      const box = boundingBoxes.find(b => b.id === boxId);
      if (!box) return;
      setSelectedBoxId(boxId);
      dragRef.current = {
        type: 'resizing',
        id: boxId,
        handle: el.dataset.handle as Handle,
        orig: { ...box },
        mx: x, my: y,
      };

    } else {
      // 背景クリック → 作成開始
      setSelectedBoxId(null);
      setEditState(null);
      dragRef.current = { type: 'creating', x0: x, y0: y };
    }
  }, [boundingBoxes, toNorm]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag.type === 'none') return;
    const { x, y } = toNorm(e.clientX, e.clientY);

    if (drag.type === 'creating') {
      setPreview({
        x: Math.min(drag.x0, x),
        y: Math.min(drag.y0, y),
        w: Math.abs(x - drag.x0),
        h: Math.abs(y - drag.y0),
      });

    } else if (drag.type === 'moving') {
      const dx = x - drag.mx;
      const dy = y - drag.my;
      const box = boundingBoxes.find(b => b.id === drag.id);
      if (!box) return;
      updateBoundingBox(drag.id, {
        x: Math.max(0, Math.min(1 - box.width,  drag.ox + dx)),
        y: Math.max(0, Math.min(1 - box.height, drag.oy + dy)),
      });

    } else if (drag.type === 'resizing') {
      const dx = x - drag.mx;
      const dy = y - drag.my;
      const o = drag.orig;
      let bx = o.x, by = o.y, bw = o.width, bh = o.height;

      switch (drag.handle) {
        case 'tl':
          bx = Math.max(0, Math.min(o.x + o.width - MIN_SIZE,  o.x + dx));
          by = Math.max(0, Math.min(o.y + o.height - MIN_SIZE, o.y + dy));
          bw = o.x + o.width  - bx;
          bh = o.y + o.height - by;
          break;
        case 'tr':
          by = Math.max(0, Math.min(o.y + o.height - MIN_SIZE, o.y + dy));
          bh = o.y + o.height - by;
          bw = Math.min(1 - o.x, Math.max(MIN_SIZE, o.width + dx));
          break;
        case 'bl':
          bx = Math.max(0, Math.min(o.x + o.width - MIN_SIZE, o.x + dx));
          bw = o.x + o.width - bx;
          bh = Math.min(1 - o.y, Math.max(MIN_SIZE, o.height + dy));
          break;
        case 'br':
          bw = Math.min(1 - o.x, Math.max(MIN_SIZE, o.width + dx));
          bh = Math.min(1 - o.y, Math.max(MIN_SIZE, o.height + dy));
          break;
      }
      updateBoundingBox(drag.id, { x: bx, y: by, width: bw, height: bh });
    }
  }, [boundingBoxes, updateBoundingBox, toNorm]);

  const onPointerUp = useCallback((_e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag.type === 'creating' && preview && preview.w > MIN_SIZE && preview.h > MIN_SIZE) {
      const box: BoundingBox = {
        id: `bbox-${Date.now()}`,
        x: preview.x, y: preview.y,
        width: preview.w, height: preview.h,
        label: 'object',
        confidence: 1.0,
      };
      addBoundingBox(box);
      setSelectedBoxId(box.id);
    }
    dragRef.current = { type: 'none' };
    setPreview(null);
  }, [preview, addBoundingBox]);

  // ── 描画スケール ──────────────────────────────────────────
  const W = naturalWidth  || 1;
  const H = naturalHeight || 1;
  const fs = Math.max(10, Math.min(W, H) * 0.022); // フォントサイズ (SVG単位)
  const hr = Math.max(5,  Math.min(W, H) * 0.009); // ハンドル半幅

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="bbox-editor"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {boundingBoxes.map(box => {
        const px = box.x * W,     py = box.y * H;
        const pw = box.width * W, ph = box.height * H;
        const sel = box.id === selectedBoxId;
        const stroke = sel ? '#f0b429' : '#4f8ef0';
        const labelText = box.age != null
          ? `${box.label} (${box.age}歳)`
          : box.label;
        const confText = box.confidence < 1.0
          ? ` ${Math.round(box.confidence * 100)}%`
          : '';

        const handles: { h: Handle; x: number; y: number; cur: string }[] = [
          { h: 'tl', x: px,      y: py,      cur: 'nw-resize' },
          { h: 'tr', x: px + pw, y: py,      cur: 'ne-resize' },
          { h: 'bl', x: px,      y: py + ph, cur: 'sw-resize' },
          { h: 'br', x: px + pw, y: py + ph, cur: 'se-resize' },
        ];

        return (
          <g key={box.id}>
            {/* ボックス本体 */}
            <rect
              x={px} y={py} width={pw} height={ph}
              fill={sel ? 'rgba(240,180,41,0.08)' : 'rgba(79,142,240,0.10)'}
              stroke={stroke}
              strokeWidth={sel ? 2.5 : 1.5}
              data-action="move"
              data-box-id={box.id}
              style={{ cursor: 'move' }}
            />

            {/* ラベル背景 */}
            <rect
              x={px} y={py - fs * 1.6}
              width={Math.max(pw, (labelText + confText).length * fs * 0.6)}
              height={fs * 1.6}
              fill={sel ? 'rgba(240,180,41,0.9)' : 'rgba(79,142,240,0.9)'}
              rx={3}
              style={{ pointerEvents: 'none' }}
            />
            {/* ラベルテキスト */}
            <text
              x={px + fs * 0.3} y={py - fs * 0.35}
              fontSize={fs} fill="white" fontWeight="600"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {labelText}{confText}
            </text>

            {/* 削除ボタン */}
            <g
              data-action="delete"
              data-box-id={box.id}
              style={{ cursor: 'pointer' }}
              onClick={e => { e.stopPropagation(); removeBoundingBox(box.id); }}
            >
              <circle cx={px + pw} cy={py} r={fs * 0.8} fill="#e05555" />
              <text
                x={px + pw} y={py}
                textAnchor="middle" dominantBaseline="central"
                fontSize={fs} fill="white" fontWeight="bold"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >×</text>
            </g>

            {/* 選択時: ラベル編集ヒント / インライン入力 */}
            {sel && !editState?.id && (
              <text
                x={px + pw / 2} y={py + ph / 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize={fs * 0.85}
                fill="rgba(255,255,255,0.45)"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                onDoubleClick={e => {
                  e.stopPropagation();
                  setEditState({ id: box.id, label: box.label });
                }}
              >
                ダブルクリックでラベル編集
              </text>
            )}
            {sel && editState?.id === box.id && (
              <foreignObject
                x={px + pw * 0.05} y={py + ph / 2 - fs * 1.1}
                width={pw * 0.9} height={fs * 2.2}
              >
                <input
                  value={editState.label}
                  onChange={e => setEditState({ id: box.id, label: e.target.value })}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      updateBoundingBox(box.id, { label: editState.label });
                      setEditState(null);
                    }
                    if (e.key === 'Escape') setEditState(null);
                  }}
                  onBlur={() => {
                    updateBoundingBox(box.id, { label: editState.label });
                    setEditState(null);
                  }}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  style={{
                    width: '100%', height: '100%',
                    background: '#141414', color: '#e8e8e8',
                    border: '2px solid #4f8ef0', borderRadius: '4px',
                    padding: `${fs * 0.15}px ${fs * 0.3}px`,
                    fontSize: `${fs}px`, outline: 'none',
                  }}
                />
              </foreignObject>
            )}

            {/* リサイズハンドル（選択時のみ） */}
            {sel && handles.map(({ h, x: hx, y: hy, cur }) => (
              <rect
                key={h}
                x={hx - hr} y={hy - hr}
                width={hr * 2} height={hr * 2}
                fill="white" stroke={stroke} strokeWidth={1.5} rx={2}
                data-action="resize"
                data-box-id={box.id}
                data-handle={h}
                style={{ cursor: cur }}
              />
            ))}
          </g>
        );
      })}

      {/* 作成中プレビュー */}
      {preview && preview.w > 0 && preview.h > 0 && (
        <rect
          x={preview.x * W} y={preview.y * H}
          width={preview.w * W} height={preview.h * H}
          fill="rgba(79,142,240,0.06)"
          stroke="#4f8ef0" strokeWidth={1.5}
          strokeDasharray={`${W * 0.012} ${W * 0.006}`}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  );
}

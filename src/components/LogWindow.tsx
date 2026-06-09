import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { LogEntry } from '../types';

const LEVEL_CLASS: Record<LogEntry['level'], string> = {
  info:  'log-entry--info',
  warn:  'log-entry--warn',
  error: 'log-entry--error',
};

export default function LogWindow() {
  const appLogs        = useStore(s => s.appLogs);
  const clearAppLogs   = useStore(s => s.clearAppLogs);
  const setShowLogWindow = useStore(s => s.setShowLogWindow);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [pos, setPos]   = useState({ x: window.innerWidth - 440, y: window.innerHeight - 340 });
  const [size, setSize] = useState({ w: 420, h: 300 });
  const drag  = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const resize = useRef<{ startX: number; startY: number; ow: number; oh: number } | null>(null);

  // 新しいログが来たら自動スクロール
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [appLogs]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startY: e.clientY, ox: pos.x, oy: pos.y };
    const move = (me: MouseEvent) => {
      if (!drag.current) return;
      setPos({
        x: Math.max(0, drag.current.ox + me.clientX - drag.current.startX),
        y: Math.max(0, drag.current.oy + me.clientY - drag.current.startY),
      });
    };
    const up = () => { drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resize.current = { startX: e.clientX, startY: e.clientY, ow: size.w, oh: size.h };
    const move = (me: MouseEvent) => {
      if (!resize.current) return;
      setSize({
        w: Math.max(280, resize.current.ow + me.clientX - resize.current.startX),
        h: Math.max(160, resize.current.oh + me.clientY - resize.current.startY),
      });
    };
    const up = () => { resize.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const copyAll = () => {
    const text = appLogs.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div
      className="log-window"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      <div className="log-window__header" onMouseDown={onDragStart}>
        <span className="log-window__title">ログ</span>
        <span className="log-window__count">{appLogs.length}</span>
        <div className="log-window__actions">
          <button onClick={copyAll} title="クリップボードにコピー">コピー</button>
          <button onClick={clearAppLogs} title="クリア">クリア</button>
          <button onClick={() => setShowLogWindow(false)} title="閉じる">✕</button>
        </div>
      </div>
      <div className="log-window__body" ref={bodyRef}>
        {appLogs.length === 0 ? (
          <div className="log-window__empty">ログなし</div>
        ) : (
          appLogs.map(entry => (
            <div key={entry.id} className={`log-entry ${LEVEL_CLASS[entry.level]}`}>
              <span className="log-entry__time">{entry.timestamp}</span>
              <span className="log-entry__msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
      <div className="log-window__resize" onMouseDown={onResizeStart} />
    </div>
  );
}

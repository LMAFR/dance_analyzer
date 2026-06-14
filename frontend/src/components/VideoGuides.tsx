import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Overlay "tools" for the video: an almost-transparent gear button in the bottom
// corner expands a little toolbar. The first tools add draggable reference lines —
// a vertical one you slide left/right and a horizontal one you slide up/down — plus
// an undo that removes the last line added. Built to grow: add more buttons later.

type Axis = 'v' | 'h';
interface Guide {
  id: number;
  axis: Axis;
  pos: number; // 0..1 fraction of the video box (x for vertical, y for horizontal)
}

const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const VLineIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="3" x2="12" y2="21" />
    <path d="M8 8l-2 4 2 4M16 8l2 4-2 4" strokeWidth="1.4" />
  </svg>
);
const HLineIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="12" x2="21" y2="12" />
    <path d="M8 8l4-2 4 2M8 16l4 2 4-2" strokeWidth="1.4" />
  </svg>
);
const UndoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
  </svg>
);

export function VideoGuides() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const dragRef = useRef<{ id: number; axis: Axis } | null>(null);

  const add = (axis: Axis) => setGuides((g) => [...g, { id: idRef.current++, axis, pos: 0.5 }]);
  const undo = () => setGuides((g) => g.slice(0, -1));

  // Ctrl/Cmd+Z removes the last guide (only while some exist, so we don't swallow
  // the shortcut from anything else on the page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && guides.length) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guides.length]);

  const onLineDown = (e: ReactPointerEvent, guide: Guide) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: guide.id, axis: guide.axis };
  };
  const onLineMove = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const raw = d.axis === 'v' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
    const pos = Math.max(0, Math.min(1, raw));
    setGuides((g) => g.map((gg) => (gg.id === d.id ? { ...gg, pos } : gg)));
  }, []);
  const onLineUp = (e: ReactPointerEvent) => {
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  return (
    <div className="video-guides" ref={wrapRef}>
      {guides.map((g) => (
        <div
          key={g.id}
          className={`guide-line ${g.axis}`}
          style={g.axis === 'v' ? { left: `${g.pos * 100}%` } : { top: `${g.pos * 100}%` }}
          onPointerDown={(e) => onLineDown(e, g)}
          onPointerMove={onLineMove}
          onPointerUp={onLineUp}
        />
      ))}

      <div className={`vtools ${open ? 'open' : ''}`}>
        {open && (
          <div className="vtools-actions">
            <button className="vtool" onClick={() => add('v')} title="Add a vertical guide line" aria-label="Add vertical line">
              <VLineIcon />
            </button>
            <button className="vtool" onClick={() => add('h')} title="Add a horizontal guide line" aria-label="Add horizontal line">
              <HLineIcon />
            </button>
            <button className="vtool" onClick={undo} disabled={!guides.length} title="Undo last guide" aria-label="Undo">
              <UndoIcon />
            </button>
          </div>
        )}
        <button
          className="vtools-toggle"
          onClick={() => setOpen((o) => !o)}
          title="Video tools"
          aria-label="Video tools"
        >
          <GearIcon />
        </button>
      </div>
    </div>
  );
}

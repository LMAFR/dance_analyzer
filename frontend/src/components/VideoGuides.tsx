import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Overlay "tools" for the video: an almost-transparent gear button in the bottom
// corner expands a little toolbar. Tools so far:
//  - a vertical reference line you slide left/right,
//  - a horizontal reference line you slide up/down,
//  - a spotlight rectangle: draw a box, everything outside it is darkened (one at
//    a time; draggable + resizable),
//  - undo the last thing added (also Ctrl/Cmd+Z).
// Everything is stored in fractions of the video box so it scales to any size and
// persists across the main/PiP views (the component stays mounted). Built to grow.

type Line = { id: number; kind: 'v' | 'h'; pos: number };
type RectItem = { id: number; kind: 'rect'; x: number; y: number; w: number; h: number };
type Item = Line | RectItem;
type Box = { x: number; y: number; w: number; h: number };
type Handle = 'nw' | 'ne' | 'sw' | 'se';

const MIN = 0.04; // smallest rectangle side (fraction)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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
const RectIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
    <rect x="4" y="6" width="16" height="12" rx="1" strokeDasharray="3 2.4" />
  </svg>
);
const UndoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
  </svg>
);

const boxStyle = (b: Box) => ({
  left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
});
// SVG path (in a 0..100 viewBox) that fills everything except the box -> darken outside.
const maskPath = (b: Box) => {
  const X = b.x * 100, Y = b.y * 100, W = b.w * 100, H = b.h * 100;
  return `M0 0H100V100H0Z M${X} ${Y}H${X + W}V${Y + H}H${X}Z`;
};

export function VideoGuides() {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Box | null>(null); // rectangle being drawn

  const wrapRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const lineDrag = useRef<{ id: number; axis: 'v' | 'h' } | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const rectDrag = useRef<{ mode: Handle; sx: number; sy: number; r0: Box } | null>(null);

  const rect = items.find((i): i is RectItem => i.kind === 'rect') ?? null;
  const lines = items.filter((i): i is Line => i.kind !== 'rect');

  const addLine = (axis: 'v' | 'h') =>
    setItems((s) => [...s, { id: idRef.current++, kind: axis, pos: 0.5 }]);
  const undo = () => setItems((s) => s.slice(0, -1));

  // Pointer position as a 0..1 fraction of the video box.
  const frac = useCallback((e: ReactPointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }, []);

  // Ctrl/Cmd+Z removes the last item (only while some exist, so we don't swallow
  // the shortcut from anything else on the page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && items.length) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length]);

  // ---- guide lines ----
  const onLineDown = (e: ReactPointerEvent, line: Line) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lineDrag.current = { id: line.id, axis: line.kind };
  };
  const onLineMove = useCallback((e: ReactPointerEvent) => {
    const d = lineDrag.current;
    if (!d) return;
    const f = frac(e);
    const pos = d.axis === 'v' ? f.x : f.y;
    setItems((s) => s.map((it) => (it.id === d.id ? { ...it, pos } : it)));
  }, [frac]);
  const onLineUp = (e: ReactPointerEvent) => {
    lineDrag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  // ---- draw a new rectangle ----
  const onDrawDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const f = frac(e);
    drawStart.current = f;
    setDraft({ x: f.x, y: f.y, w: 0, h: 0 });
  };
  const onDrawMove = (e: ReactPointerEvent) => {
    const s = drawStart.current;
    if (!s) return;
    const f = frac(e);
    setDraft({ x: Math.min(s.x, f.x), y: Math.min(s.y, f.y), w: Math.abs(f.x - s.x), h: Math.abs(f.y - s.y) });
  };
  const onDrawUp = () => {
    const d = draft;
    drawStart.current = null;
    setDrawing(false);
    setDraft(null);
    if (d && d.w >= MIN && d.h >= MIN) {
      const nr: RectItem = { id: idRef.current++, kind: 'rect', ...d };
      setItems((s) => [...s.filter((i) => i.kind !== 'rect'), nr]); // one rect at a time
    }
  };

  // ---- resize the existing rectangle (corner handles only; not draggable, so it
  //      never competes with the guide lines) ----
  const onRectDown = (e: ReactPointerEvent, mode: Handle) => {
    if (!rect) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const f = frac(e);
    rectDrag.current = { mode, sx: f.x, sy: f.y, r0: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
  };
  const onRectMove = (e: ReactPointerEvent) => {
    const m = rectDrag.current;
    if (!m) return;
    const f = frac(e);
    const dx = f.x - m.sx, dy = f.y - m.sy;
    const r0 = m.r0;
    let { x, y, w, h } = r0;
    const right = r0.x + r0.w, bottom = r0.y + r0.h;
    if (m.mode.includes('w')) { const nl = Math.max(0, Math.min(r0.x + dx, right - MIN)); x = nl; w = right - nl; }
    if (m.mode.includes('e')) { const nr2 = Math.max(r0.x + MIN, Math.min(right + dx, 1)); w = nr2 - r0.x; }
    if (m.mode.includes('n')) { const nt = Math.max(0, Math.min(r0.y + dy, bottom - MIN)); y = nt; h = bottom - nt; }
    if (m.mode.includes('s')) { const nbm = Math.max(r0.y + MIN, Math.min(bottom + dy, 1)); h = nbm - r0.y; }
    setItems((s) => s.map((it) => (it.kind === 'rect' ? { ...it, x, y, w, h } : it)));
  };
  const onRectUp = (e: ReactPointerEvent) => {
    rectDrag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const activeRect: Box | null = draft ?? rect;
  const editable = !drawing && !!rect;

  return (
    <div className="video-guides" ref={wrapRef}>
      <div className="guide-clip">
        {/* Rectangle + darken mask sit below the lines so the lines are always on
            top and stay grabbable, even where they cross the box. */}
        {activeRect && (
          <svg className="rect-mask" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={maskPath(activeRect)} fill="#000" fillRule="evenodd" opacity="0.62" />
          </svg>
        )}
        {activeRect && (
          <div className="rect-frame" style={boxStyle(activeRect)}>
            {editable && (['nw', 'ne', 'sw', 'se'] as const).map((h) => (
              <span
                key={h}
                className={`rh rh-${h}`}
                onPointerDown={(e) => onRectDown(e, h)}
                onPointerMove={onRectMove}
                onPointerUp={onRectUp}
              />
            ))}
          </div>
        )}

        {lines.map((g) => (
          <div
            key={g.id}
            className={`guide-line ${g.kind}`}
            style={g.kind === 'v' ? { left: `${g.pos * 100}%` } : { top: `${g.pos * 100}%` }}
            onPointerDown={(e) => onLineDown(e, g)}
            onPointerMove={onLineMove}
            onPointerUp={onLineUp}
          />
        ))}

        {drawing && (
          <div
            className="draw-surface"
            onPointerDown={onDrawDown}
            onPointerMove={onDrawMove}
            onPointerUp={onDrawUp}
          />
        )}
      </div>

      {/* stopPropagation so tapping/dragging the toolbar doesn't drag the PiP. */}
      <div className={`vtools ${open ? 'open' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
        {open && (
          <div className="vtools-actions">
            <button className="vtool" onClick={() => addLine('v')} title="Add a vertical guide line" aria-label="Add vertical line">
              <VLineIcon />
            </button>
            <button className="vtool" onClick={() => addLine('h')} title="Add a horizontal guide line" aria-label="Add horizontal line">
              <HLineIcon />
            </button>
            <button
              className={`vtool ${drawing ? 'active' : ''}`}
              onClick={() => setDrawing((d) => !d)}
              title={drawing ? 'Cancel — drag on the video to draw' : 'Spotlight: draw a box, darken the rest'}
              aria-label="Spotlight rectangle"
            >
              <RectIcon />
            </button>
            <button className="vtool" onClick={undo} disabled={!items.length} title="Undo last" aria-label="Undo">
              <UndoIcon />
            </button>
          </div>
        )}
        <button className="vtools-toggle" onClick={() => setOpen((o) => !o)} title="Video tools" aria-label="Video tools">
          <GearIcon />
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { STEP_COLORS, type StepMarker } from '../beatgrid';

interface IntensityGraphProps {
  envelope: number[];
  currentTime: number;
  duration: number;
  label: string;
  color: string;
  active: boolean;
  overlay?: boolean;
  onSeek?: (time: number) => void;
  markers?: StepMarker[];
  loopRegion?: { start: number; end: number } | null;
  onSelectRegion?: (start: number, end: number) => void;
  pickMode?: boolean;
  onPick?: (time: number) => void;
  height?: number;
  /** Fill the parent's height instead of using a fixed pixel height. */
  fill?: boolean;
  /** Visible time window (s). Defaults to the whole track. Used to wrap one
      graph across several rows at higher horizontal resolution. */
  tStart?: number;
  tEnd?: number;
  /** Zoom/pan: report a new visible time window from pinch / wheel gestures. */
  onViewChange?: (start: number, end: number) => void;
}

const DRAG_PX = 5;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function sampleEnvelope(env: number[], time: number, duration: number): number {
  if (env.length === 0 || duration <= 0) return 0;
  const pos = (time / duration) * (env.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  const a = env[clamp(i, 0, env.length - 1)];
  const b = env[clamp(i + 1, 0, env.length - 1)];
  return a + (b - a) * f;
}

export function IntensityGraph({
  envelope,
  currentTime,
  duration,
  label,
  color,
  active,
  overlay = false,
  onSeek,
  markers = [],
  loopRegion = null,
  onSelectRegion,
  pickMode = false,
  onPick,
  height = 110,
  fill = false,
  tStart,
  tEnd,
  onViewChange,
}: IntensityGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<number | null>(null);
  const [dragPx, setDragPx] = useState<{ a: number; b: number } | null>(null);
  const [hoverPx, setHoverPx] = useState<number | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [settled, setSettled] = useState(false);
  // Multi-touch pinch/pan state.
  const pointers = useRef<Map<number, number>>(new Map()); // id -> clientX
  const pinch = useRef<{ dist: number; mid: number } | null>(null);
  const wasGesture = useRef(false);

  // Redraw sharply whenever the canvas is resized (avoids the blurry-then-sharp race).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setBox({ w: Math.round(cr.width), h: Math.round(cr.height) });
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Mark unsettled when the target height changes (mask the resize with a spinner).
  useEffect(() => { setSettled(false); }, [height]);

  const winStart = tStart ?? 0;
  const winEnd = tEnd ?? duration;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const span = winEnd - winStart || 1;
    const xOfTime = (t: number) => ((t - winStart) / span) * w;
    const yOf = (v: number) => h - v * (h - 6) - 3;

    ctx.fillStyle = overlay ? 'rgba(0,0,0,0.28)' : '#11141c';
    ctx.fillRect(0, 0, w, h);

    // Loop region shading (clipped to window).
    if (loopRegion && loopRegion.end > winStart && loopRegion.start < winEnd) {
      const x0 = xOfTime(Math.max(loopRegion.start, winStart));
      const x1 = xOfTime(Math.min(loopRegion.end, winEnd));
      ctx.fillStyle = 'rgba(79,157,255,0.18)';
      ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.strokeStyle = 'rgba(79,157,255,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, 0); ctx.lineTo(x0, h);
      ctx.moveTo(x1, 0); ctx.lineTo(x1, h);
      ctx.stroke();
    }

    // Envelope (only the samples within the window).
    const n = envelope.length;
    if (n > 1 && duration > 0) {
      const dim = active ? 1 : 0.28;
      const idxOfTime = (t: number) => (t / duration) * (n - 1);
      const i0 = clamp(Math.floor(idxOfTime(winStart)) - 1, 0, n - 1);
      const i1 = clamp(Math.ceil(idxOfTime(winEnd)) + 1, 0, n - 1);
      const timeOfIdx = (i: number) => (i / (n - 1)) * duration;

      ctx.beginPath();
      ctx.moveTo(xOfTime(timeOfIdx(i0)), h);
      for (let i = i0; i <= i1; i++) ctx.lineTo(xOfTime(timeOfIdx(i)), yOf(envelope[i]));
      ctx.lineTo(xOfTime(timeOfIdx(i1)), h);
      ctx.closePath();
      ctx.globalAlpha = (overlay ? 0.35 : 0.25) * dim;
      ctx.fillStyle = color;
      ctx.fill();

      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const x = xOfTime(timeOfIdx(i));
        const y = yOf(envelope[i]);
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = dim;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Phrase lines + step bullets (within window).
    for (const m of markers) {
      if (m.time < winStart || m.time > winEnd) continue;
      if (m.phrase) {
        const x = xOfTime(m.time);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(120,230,160,0.45)';
        ctx.lineWidth = 1;
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
        ctx.stroke();
      }
    }
    for (const m of markers) {
      if (m.time < winStart || m.time > winEnd) continue;
      const x = xOfTime(m.time);
      const y = yOf(sampleEnvelope(envelope, m.time, duration));
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = STEP_COLORS[m.stepIndex];
      ctx.globalAlpha = active ? 1 : 0.4;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Drag selection preview.
    if (dragPx) {
      const a = Math.min(dragPx.a, dragPx.b);
      const b = Math.max(dragPx.a, dragPx.b);
      ctx.fillStyle = 'rgba(79,157,255,0.22)';
      ctx.fillRect(a, 0, b - a, h);
    }

    // Hover preview line while picking.
    if (pickMode && hoverPx !== null && dragStart.current === null) {
      ctx.beginPath();
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 1.5;
      ctx.moveTo(hoverPx, 0); ctx.lineTo(hoverPx, h);
      ctx.stroke();
    }

    // Playhead (only if within window).
    if (duration > 0 && currentTime >= winStart && currentTime <= winEnd) {
      const px = xOfTime(currentTime);
      ctx.beginPath();
      ctx.moveTo(px, 0); ctx.lineTo(px, h);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = overlay ? 'rgba(255,255,255,0.9)' : '#ffffff';
      ctx.stroke();
    }

    // Label.
    ctx.globalAlpha = active ? 0.9 : 0.4;
    ctx.fillStyle = overlay ? '#ffffff' : '#cfd6e4';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(label, 8, 16);
    ctx.globalAlpha = 1;

    // Reveal once the backing store matches the laid-out size (sharp).
    if (box.w > 0 && Math.abs(box.w - w) < 1.5 && Math.abs(box.h - h) < 1.5) {
      if (!settled) requestAnimationFrame(() => setSettled(true));
    }
  }, [envelope, currentTime, duration, label, color, active, overlay, markers, loopRegion, dragPx, hoverPx, pickMode, winStart, winEnd, box, settled, height]);

  const timeAtX = (clientX: number, rect: DOMRect) => {
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    return winStart + frac * (winEnd - winStart);
  };

  // --- Pinch / pan (two fingers) + wheel zoom, reported via onViewChange. ---
  const pinchState = (rect: DOMRect) => {
    const xs = [...pointers.current.values()].map((cx) => cx - rect.left);
    return { dist: Math.abs(xs[0] - xs[1]) || 1, mid: (xs[0] + xs[1]) / 2 };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    pointers.current.set(e.pointerId, e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      // Enter pinch/pan; cancel any single-finger drag-select.
      wasGesture.current = true;
      dragStart.current = null;
      setDragPx(null);
      pinch.current = pinchState(rect);
      return;
    }
    const x = e.clientX - rect.left;
    dragStart.current = x;
    if (onSelectRegion) setDragPx({ a: x, b: x });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, e.clientX);

    if (pointers.current.size >= 2 && pinch.current && onViewChange) {
      const w = rect.width;
      const span = winEnd - winStart;
      const next = pinchState(rect);
      const factor = pinch.current.dist / next.dist; // fingers apart -> zoom in
      // Pan so content follows the fingers' midpoint, then zoom about the new mid.
      const panned = winStart - ((next.mid - pinch.current.mid) / w) * span;
      const center = panned + (next.mid / w) * span;
      const newSpan = span * factor;
      const newStart = center - (next.mid / w) * newSpan;
      onViewChange(newStart, newStart + newSpan);
      pinch.current = next;
      return;
    }

    const x = e.clientX - rect.left;
    setHoverPx(x);
    if (dragStart.current !== null && onSelectRegion) setDragPx({ a: dragStart.current, b: x });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;

    if (dragStart.current === null) {
      // Don't treat lifting a pinch finger as a click.
      if (pointers.current.size === 0) wasGesture.current = false;
      return;
    }
    const x0 = dragStart.current;
    const x1 = e.clientX - rect.left;
    dragStart.current = null;
    setDragPx(null);
    if (wasGesture.current) { wasGesture.current = false; return; }

    if (Math.abs(x1 - x0) < DRAG_PX) {
      // A tap seeks (or sets the beat anchor in pick mode).
      const t = timeAtX(e.clientX, rect);
      if (pickMode) onPick?.(t);
      else onSeek?.(t);
    } else if (onSelectRegion) {
      // A drag selects a loop region (only when looping is enabled).
      const ta = timeAtX(rect.left + Math.min(x0, x1), rect);
      const tb = timeAtX(rect.left + Math.max(x0, x1), rect);
      onSelectRegion(ta, tb);
    }
    // Otherwise (drag with looping off): inspect only — don't move the playhead.
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!onViewChange || duration <= 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const span = winEnd - winStart;
    const center = winStart + frac * span;
    const newSpan = span * Math.exp(e.deltaY * 0.0015);
    const newStart = center - frac * newSpan;
    onViewChange(newStart, newStart + newSpan);
  };

  const onDoubleClick = () => onViewChange?.(0, duration); // reset zoom

  return (
    <div className="ig-wrap" style={{ height: fill ? '100%' : height }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverPx(null)}
        onWheel={onViewChange ? onWheel : undefined}
        onDoubleClick={onDoubleClick}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          borderRadius: 8,
          cursor: pickMode ? 'crosshair' : onSeek ? 'pointer' : 'default',
          touchAction: 'none',
          visibility: settled ? 'visible' : 'hidden',
        }}
      />
      {!settled && (
        <div className="ig-spinner">
          <div className="spinner" />
        </div>
      )}
    </div>
  );
}

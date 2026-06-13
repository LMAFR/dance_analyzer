import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AudioEngine, type StemSource } from '../audio/AudioEngine';
import { IntensityGraph } from './IntensityGraph';
import { BeatGridPanel, type PickMode } from './BeatGridPanel';
import { computeStepMarkers, DEFAULT_BEATGRID, type BeatGridConfig } from '../beatgrid';
import { fmtTime } from '../format';
import { exportClip } from '../api';
import './Player.css';

export interface StemConfig {
  id: string;
  label: string;
  url: string;
  color: string;
  envelope?: number[];
}

interface PlayerProps {
  trackId: string;
  videoUrl: string;
  stems: StemConfig[];
}

const ENVELOPE_POINTS = 600;
const WRAP_ROWS = 3; // a lone featured graph wraps its timeline across this many rows

interface Pip { x: number; y: number; w: number }

const MaximizeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 9 4 4 9 4" />
    <polyline points="20 9 20 4 15 4" />
    <polyline points="4 15 4 20 9 20" />
    <polyline points="20 15 20 20 15 20" />
  </svg>
);

const LoopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z" />
  </svg>
);

const MuteIcon = ({ muted }: { muted: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 9 5 15 9 15 14 19 14 5 9 9 5 9" fill="currentColor" stroke="none" />
    {muted ? (
      <>
        <line x1="17" y1="9" x2="22" y2="14" />
        <line x1="22" y1="9" x2="17" y2="14" />
      </>
    ) : (
      <path d="M17.5 8.5a5 5 0 0 1 0 7" />
    )}
  </svg>
);

export function Player({ trackId, videoUrl, stems }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);

  const [ready, setReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [envelopes, setEnvelopes] = useState<Record<string, number[]>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [fullscreen, setFullscreen] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const [videoAspect, setVideoAspect] = useState<number | undefined>(undefined);
  const [featured, setFeatured] = useState<Set<string>>(() => new Set(stems.map((s) => s.id)));
  const [beatCfg, setBeatCfg] = useState<BeatGridConfig>(DEFAULT_BEATGRID);
  const [pickMode, setPickMode] = useState<PickMode>('none');
  const [loopRegion, setLoopRegion] = useState<{ start: number; end: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState<{ start: number; end: number } | null>(null); // zoom/pan window
  // Drag-to-loop is opt-in (off by default on phones, so a drag doesn't make a
  // loop and single-finger drag stays free; two-finger pinch still zooms).
  const [loopEnabled, setLoopEnabled] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 880 : true
  );
  const [vh, setVh] = useState(typeof window !== 'undefined' ? window.innerHeight : 800);
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280);
  const isMobile = vw <= 880;
  const [pip, setPip] = useState<Pip | null>(null);
  const [beatBarH, setBeatBarH] = useState(0);
  const beatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setReady(false);
    setVideoReady(false);
    setLoadError(null);
    let disposed = false;
    const engine = new AudioEngine(video);
    engineRef.current = engine;
    const sources: StemSource[] = stems.map((s) => ({ id: s.id, url: s.url }));
    engine
      .load(sources)
      .then(() => {
        if (disposed) return; // engine was torn down during load
        setDuration(engine.duration);
        const env: Record<string, number[]> = {};
        for (const s of stems) env[s.id] = s.envelope ?? engine.envelope(s.id, ENVELOPE_POINTS);
        setEnvelopes(env);
        setReady(true);
      })
      .catch((e) => {
        if (disposed) return;
        console.error('engine load failed', e);
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    engine.onTick = (t) => setTime(t);
    engine.onEnded = () => setPlaying(false); // reset transport to ▶ at end
    return () => {
      disposed = true;
      engine.onTick = null;
      engine.onEnded = null;
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  useEffect(() => {
    const onResize = () => { setVh(window.innerHeight); setVw(window.innerWidth); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Measure the beat-grid panel's natural height so the fullscreen mute/solo
  // panel and minimized graphs can match it (the panel keeps its own height).
  useEffect(() => {
    const el = beatRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBeatBarH(el.offsetHeight));
    ro.observe(el);
    setBeatBarH(el.offsetHeight);
    return () => ro.disconnect();
  }, [fullscreen, swapped]);

  // The video floats as a PiP whenever graphs own the main area in fullscreen,
  // or on phones (where graphs-in-main always uses the floating PiP).
  const pipActive = swapped && (fullscreen || isMobile);
  useEffect(() => {
    if (pipActive && !pip) {
      // Bigger by default on phones (12% is unusably small there).
      const frac = isMobile ? 0.5 : 0.12;
      const w = Math.round(window.innerWidth * frac);
      // Sit lower and a bit further left so it clears each graph's expand/mute buttons.
      const margin = Math.round(window.innerWidth * 0.07);
      setPip({ x: window.innerWidth - w - margin, y: Math.round(window.innerHeight * 0.12), w });
    }
    if (!pipActive && pip) setPip(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipActive]);

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying) { engine.pause(); setPlaying(false); }
    else { engine.play(); setPlaying(true); }
  }, []);

  const seek = useCallback((t: number) => {
    engineRef.current?.seek(t);
    setTime(t);
  }, []);

  const toggleMute = useCallback((id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !engine.isMuted(id);
    engine.setMuted(id, next);
    setMuted((m) => ({ ...m, [id]: next }));
  }, []);

  const maximizeGraph = (id: string) => {
    // On phones there's no featured/rail split — just toggle into graphs-in-main.
    if (isMobile) { setSwapped(true); return; }
    if (!swapped) { setFeatured(new Set([id])); setSwapped(true); return; }
    const next = new Set(featured);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (next.size === 0) setSwapped(false);
    else setFeatured(next);
  };
  const maximizeVideo = () => setSwapped(false);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (!document.fullscreenElement) stage.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  const onPick = useCallback(
    (t: number) => {
      setBeatCfg((c) =>
        pickMode === 'one'
          ? { ...c, anchor: t, anchorSet: true }
          : pickMode === 'two'
            ? { ...c, beatDuration: Math.max(0.05, Math.abs(t - c.anchor)), beatSet: true }
            : c
      );
      setPickMode('none');
    },
    [pickMode]
  );

  const onSelectRegion = useCallback((a: number, b: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setLoop(a, b);
    setLoopRegion(engine.loopRange);
  }, []);

  const clearLoop = useCallback(() => {
    engineRef.current?.clearLoop();
    setLoopRegion(null);
  }, []);

  // Export a clip: crop to the loop region (or whole track) with the currently
  // audible (un-muted) stems mixed as the audio.
  const onExport = useCallback(async () => {
    const start = loopRegion?.start ?? 0;
    const end = loopRegion?.end ?? duration;
    const chosen = stems.filter((s) => !muted[s.id]).map((s) => s.id);
    setExporting(true);
    try {
      const blob = await exportClip(trackId, start, end, chosen);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${trackId}_clip.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
    }
  }, [trackId, loopRegion, duration, stems, muted]);

  // PiP drag / resize. Pointer capture is tracked and released defensively:
  // Firefox can drop the implicit pointerup release when the captured subtree
  // re-renders mid-drag (setPip fires every move), and a stuck capture swallows
  // every later click — freezing the whole UI. endGesture() always releases.
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sw: number } | null>(null);
  const capturedRef = useRef<{ el: HTMLElement; id: number } | null>(null);

  const capture = useCallback((el: HTMLElement, id: number) => {
    try { el.setPointerCapture(id); capturedRef.current = { el, id }; } catch { /* unsupported / invalid state */ }
  }, []);
  const endGesture = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
    const c = capturedRef.current;
    if (c) {
      try { c.el.releasePointerCapture(c.id); } catch { /* already released */ }
      capturedRef.current = null;
    }
  }, []);

  // Global safety net: any pointerup/cancel anywhere ends the gesture, even if
  // the holder's own handler was unmounted mid-drag (e.g. swapped flipped off).
  useEffect(() => {
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    return () => {
      window.removeEventListener('pointerup', endGesture);
      window.removeEventListener('pointercancel', endGesture);
    };
  }, [endGesture]);

  const onPipPointerDown = (e: React.PointerEvent) => {
    if (!pip || resizeRef.current) return;
    dragRef.current = { dx: e.clientX - pip.x, dy: e.clientY - pip.y };
    capture(e.currentTarget as HTMLElement, e.pointerId); // stable holder, not e.target
  };
  const onPipPointerMove = (e: React.PointerEvent) => {
    if (!pip) return;
    if (resizeRef.current) {
      const w = Math.max(110, resizeRef.current.sw + (e.clientX - resizeRef.current.sx));
      setPip({ ...pip, w });
    } else if (dragRef.current) {
      setPip({ ...pip, x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
    }
  };
  const onPipPointerUp = endGesture;
  const onResizeDown = (e: React.PointerEvent) => {
    if (!pip) return;
    e.stopPropagation();
    resizeRef.current = { sx: e.clientX, sw: pip.w };
    capture(e.currentTarget as HTMLElement, e.pointerId);
  };

  // Shared zoom/pan window across all graphs (clamped; full window -> null).
  const onViewChange = useCallback(
    (start: number, end: number) => {
      const dur = duration || 0;
      const MIN = 0.25;
      let s = Math.max(0, Math.min(start, end));
      let e = Math.min(dur, Math.max(start, end));
      if (e - s < MIN) {
        const c = (s + e) / 2;
        s = Math.max(0, c - MIN / 2);
        e = Math.min(dur, s + MIN);
      }
      if (e - s >= dur - 0.01) setView(null); // fully zoomed out -> full view
      else setView({ start: s, end: e });
    },
    [duration]
  );

  const markers = useMemo(() => computeStepMarkers(beatCfg, duration), [beatCfg, duration]);

  const isActive = (id: string) => !muted[id];
  const loading = !ready || !videoReady;

  // On phones we keep it simple: all three graphs live in the main area (no
  // featured/rail split), and the video floats as a PiP over them.
  const featuredStems = isMobile ? stems : stems.filter((s) => featured.has(s.id));
  const railStems = isMobile ? [] : stems.filter((s) => !featured.has(s.id));

  const graphProps = (s: StemConfig) => ({
    label: s.label, color: s.color, envelope: envelopes[s.id] ?? [],
    currentTime: time, duration, active: isActive(s.id), onSeek: seek,
    markers, loopRegion, onSelectRegion: loopEnabled ? onSelectRegion : undefined,
    pickMode: pickMode !== 'none', onPick, onViewChange,
  });

  const graphControls = (id: string, inMain: boolean) => (
    <div className="graph-controls">
      <button
        className={`gbtn ${muted[id] ? 'muted' : ''}`}
        onClick={() => toggleMute(id)}
        title={muted[id] ? 'Unmute' : 'Mute'}
      >
        <MuteIcon muted={!!muted[id]} />
      </button>
      <button
        className={`gbtn ${inMain ? 'active' : ''}`}
        onClick={() => maximizeGraph(id)}
        title={inMain ? 'Remove from main view' : 'Show this graph in the main view'}
      >
        <MaximizeIcon />
      </button>
    </div>
  );

  const renderGraphs = (list: StemConfig[], overlay: boolean, height: number) =>
    list.map((s) => (
      <div className="graph-wrap" key={s.id}>
        <IntensityGraph
          {...graphProps(s)}
          overlay={overlay}
          height={height}
          tStart={view?.start}
          tEnd={view?.end}
        />
        {graphControls(s.id, swapped && featured.has(s.id))}
      </div>
    ));

  // A lone featured graph wraps across WRAP_ROWS rows for 3x horizontal resolution.
  const renderWrapped = (s: StemConfig, overlay: boolean, rowH: number) => {
    const seg = duration / WRAP_ROWS;
    return (
      <div className="graph-wrap wrapped" key={s.id}>
        {Array.from({ length: WRAP_ROWS }).map((_, i) => (
          <IntensityGraph
            key={i}
            {...graphProps(s)}
            overlay={overlay}
            height={rowH}
            tStart={i * seg}
            tEnd={(i + 1) * seg}
          />
        ))}
        {graphControls(s.id, true)}
      </div>
    );
  };

  // Featured graphs divide the full main height (no upper cap), so 2 featured
  // fill 1.5 rows each, 3 fill one row each.
  const featuredH = () => {
    const c = featuredStems.length || 1;
    return Math.max(90, Math.floor((vh - 280) / c));
  };
  const overlayH = () => {
    const c = featuredStems.length || 1;
    return Math.max(80, Math.floor((vh - 200) / c));
  };

  // The main graph area. "big" = windowed main, or graphs filling the fullscreen
  // screen (swapped); otherwise it's a small overlay floating on the video.
  const renderMain = (overlay: boolean) => {
    // Mobile: the three graphs, equal size, no wrapping/featuring.
    if (isMobile) {
      const c = featuredStems.length || 1;
      const h = Math.max(150, Math.floor((vh - (overlay ? 150 : 210)) / c));
      return renderGraphs(featuredStems, overlay, h);
    }
    const big = !overlay || swapped;
    // A lone graph wraps to 3 rows only at full view; once zoomed/panned it
    // becomes a single windowed graph the user can pan/zoom freely.
    if (featuredStems.length === 1 && !view) {
      const rowH = big
        ? Math.max(80, Math.floor((overlay ? vh - 200 : vh - 280) / WRAP_ROWS))
        : 64;
      return renderWrapped(featuredStems[0], overlay, rowH);
    }
    const h = big ? (overlay ? overlayH() : featuredH()) : 84;
    return renderGraphs(featuredStems, overlay, h);
  };

  const beatPanel = (
    <BeatGridPanel
      cfg={beatCfg} onChange={setBeatCfg} pickMode={pickMode} setPickMode={setPickMode}
      loopRegion={loopRegion} onClearLoop={clearLoop}
    />
  );

  // Swapped windowed: size the video to fill the column down to where the
  // minimized graphs sit at the bottom — matching the featured graphs' height
  // so the two columns align with no gap or overflow.
  const GAP = 12;
  const railRowH = 92;
  const railH = railStems.length ? railStems.length * railRowH + (railStems.length - 1) * 8 : 0;
  const mainGraphsH =
    featuredStems.length === 1
      ? Math.max(80, Math.floor((vh - 280) / WRAP_ROWS)) * WRAP_ROWS + (WRAP_ROWS - 1) * 10
      : featuredH() * featuredStems.length + (featuredStems.length - 1) * GAP;
  const swappedVideoH = Math.max(140, mainGraphsH - railH - (railH ? GAP : 0));

  const transport = (
    <div className="transport">
      <button className="btn play" onClick={togglePlay} disabled={loading}>{playing ? '❚❚' : '▶'}</button>
      <span className="time">
        <span className="t-cur">{fmtTime(time)}</span>
        <span className="t-tot"> / {fmtTime(duration)}</span>
      </span>
      <input className="scrub" type="range" min={0} max={duration || 0} step={0.001}
        value={time} onChange={(e) => seek(Number(e.target.value))} />
      <button
        className={loopEnabled ? 'btn active' : 'btn'}
        onClick={() => setLoopEnabled((v) => !v)}
        title={loopEnabled ? 'Loop-drag on — drag a graph to loop a section' : 'Loop-drag off — drag does not create loops'}
      >
        <span className="btn-icon"><LoopIcon /></span>
        <span className="btn-label">{loopEnabled ? 'Loop on' : 'Loop off'}</span>
      </button>
      {loopRegion && (
        <button className="btn loop-active" onClick={clearLoop} title="Clear the looped section">
          <span className="loop-range">{fmtTime(loopRegion.start)}–{fmtTime(loopRegion.end)} </span>✕
        </button>
      )}
      {view && (
        <button className="btn" onClick={() => setView(null)} title="Reset zoom (fit all)">
          <span className="btn-icon fit">FIT</span>
        </button>
      )}
      <button
        className="btn"
        onClick={onExport}
        disabled={exporting || loading}
        title="Download the looped section (or whole track) with the audible layers"
      >
        <span className="btn-icon">⤓</span>
        <span className="btn-label">{exporting ? 'Exporting…' : 'Export'}</span>
      </button>
      <button className="btn" onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        <span className="btn-icon"><MaximizeIcon /></span>
        <span className="btn-label">{fullscreen ? 'Exit FS' : 'Fullscreen'}</span>
      </button>
    </div>
  );

  return (
    <div className={`player ${swapped ? 'swapped' : ''}`}>
      <div
        className={`area-video stage ${fullscreen ? 'fs' : ''} ${pipActive && !fullscreen ? 'collapsed' : ''}`}
        ref={stageRef}
        style={{
          aspectRatio: fullscreen || pipActive ? undefined : videoAspect,
          // The desktop two-column height math doesn't apply once the layout
          // collapses to one column on phones (CSS handles it there). When the
          // video floats as a PiP (mobile), the stage cell collapses.
          height: pipActive && !fullscreen ? 0 : (!fullscreen && swapped && vw > 880 ? swappedVideoH : undefined),
        }}
      >
        <div
          className={`video-holder ${pipActive ? 'pip' : ''}`}
          style={pipActive && pip ? { left: pip.x, top: pip.y, width: pip.w } : undefined}
          onPointerDown={pipActive ? onPipPointerDown : undefined}
          onPointerMove={pipActive ? onPipPointerMove : undefined}
          onPointerUp={pipActive ? onPipPointerUp : undefined}
        >
          <video
            ref={videoRef} src={videoUrl} className="video" playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight);
            }}
            onLoadedData={() => setVideoReady(true)}
            onCanPlay={() => setVideoReady(true)}
            onError={() => {
              const err = videoRef.current?.error;
              setLoadError(`Video failed to load${err ? ` (code ${err.code})` : ''}`);
            }}
          />
          {swapped && (
            <button className="maximize-btn video-max" onPointerDown={(e) => e.stopPropagation()}
              onClick={maximizeVideo} title="Show the video in the main view">
              <MaximizeIcon />
            </button>
          )}
          {pipActive && <div className="pip-resize" onPointerDown={onResizeDown} title="Drag to resize" />}
        </div>

        {loadError ? (
          <div className="spinner-overlay error">
            <span>⚠ {loadError}</span>
          </div>
        ) : loading && (
          <div className="spinner-overlay">
            <div className="spinner" />
            <span>{!ready ? 'Loading stems…' : 'Loading video…'}</span>
          </div>
        )}

        {fullscreen && (
          <div className="overlay-graphs">
            {swapped ? renderMain(true) : renderGraphs(stems, true, 84)}
          </div>
        )}
        {fullscreen && (
          <div className={`overlay-controls ${swapped ? 'wide' : ''}`}>
            <div className="bp-measure" ref={beatRef}>{beatPanel}</div>
            {swapped && railStems.length > 0 && (
              <div className="overlay-rail" style={{ height: beatBarH || undefined }}>
                {railStems.map((s) => (
                  <div className="graph-wrap" key={s.id}>
                    <IntensityGraph {...graphProps(s)} overlay fill />
                    {graphControls(s.id, false)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {fullscreen && transport}
      </div>

      <div className="area-graphs graphs">
        {swapped ? renderMain(false) : renderGraphs(stems, false, 110)}
      </div>

      {/* Non-featured graphs (swapped only) — kept at normal size, still usable. */}
      <div className="area-rail">
        {swapped && railStems.length > 0 && <div className="rail-graphs">{renderGraphs(railStems, false, 92)}</div>}
      </div>

      <aside className="area-side side">
        {beatPanel}
      </aside>

      {!fullscreen && <div className="area-trans">{transport}</div>}
    </div>
  );
}

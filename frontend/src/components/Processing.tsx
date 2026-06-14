import './Processing.css';

interface ProcessingProps {
  videoUrl: string;
  poster: string | null;
  progress: number; // 0..1
  stage: string;
}

const STAGE_LABELS: Record<string, string> = {
  preparing: 'Preparing video',
  extracting: 'Extracting audio',
  separating: 'Separating music layers',
  mixing: 'Mixing stems',
  encoding: 'Encoding audio',
  analysing: 'Analysing intensity',
};

const PLACEHOLDERS = [
  { label: 'Instrumental', color: '#4f9dff' },
  { label: 'Voice / Lyrics', color: '#ff7ac6' },
  { label: 'Percussion', color: '#ffce4f' },
];

// Shown while the stems are still separating: the (already-transcoded) video is
// fully playable here; the graph panel fills in once separation finishes.
export function Processing({ videoUrl, poster, progress, stage }: ProcessingProps) {
  const pct = Math.round(progress * 100);
  const label = STAGE_LABELS[stage] ?? 'Processing';

  return (
    <div className="processing-view">
      <div className="pv-stage">
        <video src={videoUrl} poster={poster ?? undefined} className="pv-video" controls playsInline autoPlay muted />
      </div>

      <aside className="pv-rail">
        <div className="pv-graphs">
          {PLACEHOLDERS.map((p) => (
            <div className="pv-graph" key={p.label}>
              <span className="pv-dot" style={{ background: p.color }} />
              <span className="pv-name">{p.label}</span>
              <div className="spinner" />
            </div>
          ))}
        </div>
        <div className="pv-progress">
          <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
          <p className="pv-label">{label} · {pct}%</p>
          <p className="pv-hint">You can already watch and scrub the video. The music
            graphs &amp; per-layer controls unlock when separation finishes.</p>
        </div>
      </aside>
    </div>
  );
}

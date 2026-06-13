import { useEffect, useState } from 'react';
import { Player, type StemConfig } from './components/Player';
import { Upload } from './components/Upload';
import { Processing } from './components/Processing';
import { deleteTrack, getEnvelopes, getJob, getManifest, trackFileUrl } from './api';
import './App.css';

// Display metadata per stem id (the backend only knows ids + urls).
const STEM_META: Record<string, { label: string; color: string }> = {
  instrumental: { label: 'Instrumental', color: '#4f9dff' },
  voice: { label: 'Voice / Lyrics', color: '#ff7ac6' },
  percussion: { label: 'Percussion', color: '#ffce4f' },
};

const STEM_ORDER = ['instrumental', 'voice', 'percussion'];

type Phase = 'loading' | 'processing' | 'ready' | 'error';

export default function App() {
  const [trackId, setTrackId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('track')
  );
  const [phase, setPhase] = useState<Phase>('loading');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [stems, setStems] = useState<StemConfig[]>([]);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trackId) return;
    let cancelled = false;
    let misses = 0;
    setPhase('loading');
    setVideoUrl(null);
    setStems([]);

    const poll = async () => {
      try {
        const manifest = await getManifest(trackId);
        if (cancelled) return;
        misses = 0;
        setVideoUrl(trackFileUrl(trackId, manifest.video));

        if (manifest.ready && manifest.envelopes) {
          const env = await getEnvelopes(trackId, manifest.envelopes);
          if (cancelled) return;
          const built: StemConfig[] = manifest.stems
            .map((s) => ({
              id: s.id,
              label: STEM_META[s.id]?.label ?? s.id,
              color: STEM_META[s.id]?.color ?? '#8aa',
              url: trackFileUrl(trackId, s.url),
              envelope: env.stems[s.id],
            }))
            .sort((a, b) => STEM_ORDER.indexOf(a.id) - STEM_ORDER.indexOf(b.id));
          setStems(built);
          setPhase('ready');
          return; // stop polling
        }

        // Partial: video is viewable, stems still separating.
        setPhase('processing');
        try {
          const job = await getJob(trackId);
          if (!cancelled) {
            setProgress(job.progress);
            setStage(job.stage);
          }
        } catch {
          /* job may be gone after a restart; keep showing the video */
        }
        if (!cancelled) window.setTimeout(poll, 1500);
      } catch {
        // Manifest not there (yet, or reaped). Retry a few times, then give up.
        misses += 1;
        if (misses > 6) {
          if (!cancelled) {
            setError('Track not found (it may have expired).');
            setPhase('error');
          }
          return;
        }
        if (!cancelled) window.setTimeout(poll, 1500);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  const reset = () => {
    if (trackId) deleteTrack(trackId);
    window.history.replaceState({}, '', window.location.pathname);
    setTrackId(null);
    setPhase('loading');
    setVideoUrl(null);
    setStems([]);
    setError(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>DancersDeck</h1>
        {trackId ? (
          <button className="link" onClick={reset}>
            ← New video
          </button>
        ) : (
          <span className="tag">upload</span>
        )}
      </header>

      {!trackId && <Upload onReady={setTrackId} />}
      {trackId && phase === 'loading' && <p className="status">Loading track…</p>}
      {trackId && phase === 'error' && <p className="status error">{error}</p>}
      {trackId && phase === 'processing' && videoUrl && (
        <Processing videoUrl={videoUrl} progress={progress} stage={stage} />
      )}
      {trackId && phase === 'ready' && videoUrl && (
        <Player trackId={trackId} videoUrl={videoUrl} stems={stems} />
      )}
    </div>
  );
}

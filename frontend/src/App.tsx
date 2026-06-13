import { useEffect, useState } from 'react';
import { Player, type StemConfig } from './components/Player';
import { Upload } from './components/Upload';
import { getEnvelopes, getManifest, trackFileUrl } from './api';
import './App.css';

// Display metadata per stem id (the backend only knows ids + urls).
const STEM_META: Record<string, { label: string; color: string }> = {
  instrumental: { label: 'Instrumental', color: '#4f9dff' },
  voice: { label: 'Voice / Lyrics', color: '#ff7ac6' },
  percussion: { label: 'Percussion', color: '#ffce4f' },
};

interface LoadedTrack {
  videoUrl: string;
  stems: StemConfig[];
}

export default function App() {
  const [trackId, setTrackId] = useState<string | null>(null);
  const [track, setTrack] = useState<LoadedTrack | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trackId) return;
    let cancelled = false;
    (async () => {
      try {
        const manifest = await getManifest(trackId);
        const env = await getEnvelopes(trackId, manifest.envelopes);
        if (cancelled) return;
        const stems: StemConfig[] = manifest.stems.map((s) => ({
          id: s.id,
          label: STEM_META[s.id]?.label ?? s.id,
          color: STEM_META[s.id]?.color ?? '#8aa',
          url: trackFileUrl(trackId, s.url),
          envelope: env.stems[s.id],
        }));
        // Stable display order: instrumental, voice, percussion.
        const order = ['instrumental', 'voice', 'percussion'];
        stems.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        setTrack({ videoUrl: trackFileUrl(trackId, manifest.video), stems });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  const reset = () => {
    setTrackId(null);
    setTrack(null);
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
      {trackId && !track && !error && <p className="status">Loading track…</p>}
      {error && <p className="status error">{error}</p>}
      {track && <Player videoUrl={track.videoUrl} stems={track.stems} />}
    </div>
  );
}

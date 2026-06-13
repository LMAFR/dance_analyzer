// AudioEngine: plays N stems via Web Audio as the master clock, and slaves an
// HTMLVideoElement to it. All stems are decoded from the same source so they are
// sample-aligned with each other; we only actively sync the video to the audio.
//
// Design (see plan "The hard part: audio <-> video sync"):
//  - Audio is the master clock. On play, every stem's AudioBufferSourceNode is
//    started at the same audioContext time with the same offset -> perfect
//    stem-to-stem alignment.
//  - A rAF loop computes the expected media time from the audio clock and nudges
//    the video (playbackRate micro-correction, or a hard seek for large gaps) so
//    audio never glitches.

export type StemId = string;

export interface StemSource {
  id: StemId;
  url: string;
}

export interface AudioEngineOptions {
  /** Drift (s) above which we micro-correct via playbackRate. */
  softDriftThreshold?: number;
  /** Drift (s) above which we hard-seek the video instead. */
  hardDriftThreshold?: number;
  /** Strength of the playbackRate correction. */
  correctionGain?: number;
}

interface Stem {
  id: StemId;
  buffer: AudioBuffer;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  muted: boolean;
}

const DEFAULTS: Required<AudioEngineOptions> = {
  softDriftThreshold: 0.06, // 60 ms
  hardDriftThreshold: 0.4, // 400 ms -> jump
  correctionGain: 0.5,
};

export class AudioEngine {
  private ctx: AudioContext;
  private video: HTMLVideoElement;
  private opts: Required<AudioEngineOptions>;
  private stems = new Map<StemId, Stem>();
  private soloed = new Set<StemId>();

  private playing = false;
  /** Set once dispose() runs so an in-flight load() bails instead of building
      nodes on a closed AudioContext (React StrictMode double-mounts the effect). */
  private disposed = false;
  /** audioContext.currentTime captured when playback (re)started. */
  private startCtxTime = 0;
  /** media offset (s) playback (re)started from. */
  private startOffset = 0;
  private rafId: number | null = null;
  /** Active loop region (s), or null. Playback wraps to start at the loop end. */
  private loopRegion: { start: number; end: number } | null = null;

  /** Total media duration (s) — min across stems. */
  duration = 0;

  /** Optional callback fired each rAF with the current media time. */
  onTick: ((time: number) => void) | null = null;

  /** Fired once when playback runs off the end of the media (auto-stop). */
  onEnded: (() => void) | null = null;

  constructor(video: HTMLVideoElement, opts: AudioEngineOptions = {}) {
    this.video = video;
    this.opts = { ...DEFAULTS, ...opts };
    this.ctx = new AudioContext();
    // Video is visual-only; its own track is silenced.
    this.video.muted = true;
  }

  /** Fetch + decode every stem and wire gain nodes. */
  async load(sources: StemSource[]): Promise<void> {
    const decoded = await Promise.all(
      sources.map(async (s) => {
        const res = await fetch(s.url);
        if (!res.ok) throw new Error(`fetch ${s.id} failed: HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(arr).catch((e) => {
          throw new Error(`decode ${s.id} failed: ${e?.message ?? e}`);
        });
        return { id: s.id, buffer };
      })
    );
    // Disposed mid-load (StrictMode remount / unmount): don't touch the closed ctx.
    if (this.disposed) return;
    this.duration = Math.min(...decoded.map((d) => d.buffer.duration));
    for (const d of decoded) {
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      this.stems.set(d.id, {
        id: d.id,
        buffer: d.buffer,
        gain,
        source: null,
        muted: false,
      });
    }
  }

  /** Effective gain accounts for solo: if anything is soloed, only soloed stems play. */
  private applyGains() {
    const anySolo = this.soloed.size > 0;
    for (const stem of this.stems.values()) {
      const audible = anySolo ? this.soloed.has(stem.id) : !stem.muted;
      stem.gain.gain.value = audible ? 1 : 0;
    }
  }

  setMuted(id: StemId, muted: boolean) {
    const stem = this.stems.get(id);
    if (!stem) return;
    stem.muted = muted;
    this.applyGains();
  }

  toggleSolo(id: StemId) {
    if (this.soloed.has(id)) this.soloed.delete(id);
    else this.soloed.add(id);
    this.applyGains();
  }

  isMuted(id: StemId) {
    return this.stems.get(id)?.muted ?? false;
  }

  isSoloed(id: StemId) {
    return this.soloed.has(id);
  }

  get isPlaying() {
    return this.playing;
  }

  /** Current media time, derived from the audio master clock while playing. */
  get currentTime(): number {
    if (!this.playing) return this.startOffset;
    return this.startOffset + (this.ctx.currentTime - this.startCtxTime);
  }

  /** Set (or update) the loop region. Jumps into it if currently outside. */
  setLoop(start: number, end: number) {
    const a = Math.max(0, Math.min(start, end));
    const b = Math.min(this.duration, Math.max(start, end));
    if (b - a < 0.05) return; // ignore trivially small selections
    this.loopRegion = { start: a, end: b };
    const t = this.currentTime;
    if (t < a || t >= b) this.seek(a);
  }

  clearLoop() {
    this.loopRegion = null;
  }

  get loopRange() {
    return this.loopRegion;
  }

  async play() {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    // If a loop is set and we're parked outside it, enter at the loop start.
    if (this.loopRegion) {
      const { start, end } = this.loopRegion;
      if (this.startOffset < start || this.startOffset >= end) this.startOffset = start;
    }
    this.startSourcesAt(this.startOffset);
    this.video.currentTime = this.startOffset;
    this.video.playbackRate = 1;
    await this.video.play().catch(() => {});
    this.playing = true;
    this.loop();
  }

  pause() {
    if (!this.playing) return;
    const t = this.currentTime;
    this.stopSources();
    this.video.pause();
    this.playing = false;
    this.startOffset = Math.min(t, this.duration);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.onTick?.(this.startOffset);
  }

  /** Seek to an absolute media time (s). Works whether playing or paused. */
  seek(time: number) {
    const t = Math.max(0, Math.min(time, this.duration));
    if (this.playing) {
      this.stopSources();
      this.startSourcesAt(t);
      this.video.currentTime = t;
    } else {
      this.startOffset = t;
      this.video.currentTime = t;
    }
    this.onTick?.(t);
  }

  private startSourcesAt(offset: number) {
    this.applyGains();
    this.startCtxTime = this.ctx.currentTime;
    this.startOffset = offset;
    for (const stem of this.stems.values()) {
      const src = this.ctx.createBufferSource();
      src.buffer = stem.buffer;
      src.connect(stem.gain);
      src.start(this.startCtxTime, offset);
      stem.source = src;
    }
  }

  private stopSources() {
    for (const stem of this.stems.values()) {
      if (stem.source) {
        try {
          stem.source.stop();
        } catch {
          /* already stopped */
        }
        stem.source.disconnect();
        stem.source = null;
      }
    }
  }

  private loop = () => {
    if (!this.playing) return;
    const audioTime = this.currentTime;

    // Loop region -> wrap back to the start when we reach the end.
    if (this.loopRegion && audioTime >= this.loopRegion.end) {
      this.seek(this.loopRegion.start);
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    // End of media -> stop.
    if (audioTime >= this.duration) {
      this.pause();
      this.seek(0);
      this.onEnded?.();
      return;
    }

    // Slave the video to the audio clock.
    const drift = this.video.currentTime - audioTime; // +ve: video ahead
    const abs = Math.abs(drift);
    if (abs > this.opts.hardDriftThreshold) {
      this.video.currentTime = audioTime;
      this.video.playbackRate = 1;
    } else if (abs > this.opts.softDriftThreshold) {
      // Nudge: if video is behind, speed it up slightly, and vice versa.
      this.video.playbackRate = 1 - drift * this.opts.correctionGain;
    } else {
      this.video.playbackRate = 1;
    }

    this.onTick?.(audioTime);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Compute a downsampled RMS-intensity envelope (0..1) for a stem. */
  envelope(id: StemId, points: number): number[] {
    const stem = this.stems.get(id);
    if (!stem) return [];
    const data = stem.buffer.getChannelData(0);
    const block = Math.floor(data.length / points);
    const out: number[] = [];
    let max = 1e-6;
    for (let i = 0; i < points; i++) {
      let sum = 0;
      const start = i * block;
      const end = Math.min(start + block, data.length);
      for (let j = start; j < end; j++) sum += data[j] * data[j];
      const rms = Math.sqrt(sum / Math.max(1, end - start));
      out.push(rms);
      if (rms > max) max = rms;
    }
    return out.map((v) => v / max);
  }

  dispose() {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.stopSources();
    this.ctx.close();
  }
}

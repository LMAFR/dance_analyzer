# Architecture

```
┌──────────────── Frontend (React + TS + Vite) ───────────────┐
│  Upload → poll job status → Processing view → Player view    │
│  Player:                                                     │
│    <video> (muted)  ── visual, slaved to the audio clock     │
│    AudioEngine (Web Audio) ── master clock + 3 stems/gains   │
│    3× Canvas intensity graphs ── playhead from the clock     │
│    Beat grid · loops · export · speed · video tools overlay  │
└──────────────────────────────────────────────────────────-──┘
                         │ REST + static files
┌──────────────── Backend (FastAPI) ──────────────────────────┐
│  POST /api/uploads  → validate → enqueue job                 │
│  worker: ffmpeg (transcode+poster) → partial manifest →      │
│          ffmpeg (extract wav) → Demucs htdemucs (4 stems) →  │
│          fold 4→3 → encode m4a → RMS envelopes → manifest    │
│  GET /api/jobs/{id} · GET /api/tracks/{id} · static files    │
│  POST /api/tracks/{id}/export · DELETE /api/tracks/{id}      │
└──────────────────────────────────────────────────────────-──┘
```

## Frontend

React + TypeScript + Vite. Key files:

- **`src/audio/AudioEngine.ts`** — the heart of the app. Web Audio is the **master
  clock**; the `<video>` element is muted and **slaved** to it.
  - On play, all stems' `AudioBufferSourceNode`s start at the same `audioContext`
    time with the same offset → the three stems are sample-aligned for free.
  - A `requestAnimationFrame` loop computes the expected media time from the audio
    clock and **nudges the video** via `playbackRate` (or hard-seeks on a big gap)
    so the audio never glitches.
  - **Mute/solo** = `GainNode` 0/1 (solo mutes the others).
  - **Playback speed** (`setRate`) re-anchors the clock and applies to the stem
    sources + video.
  - **Buffering gate**: the video is the only streamed part (stems are decoded in
    memory), so when it runs short of data we *hold everything together* — pause the
    video AND suspend the AudioContext (freezing time + graphs) — and resume both
    once the video can play again (`readyState >= HAVE_FUTURE_DATA`), driven from the
    rAF loop rather than relying solely on the `playing` event.
  - **iOS audio**: Web Audio on iOS plays on the ringer channel (silenced by the
    mute switch and easy to leave locked). On the first play gesture we play a tiny
    inaudible looping `<audio>` element (and set `navigator.audioSession.type`) to
    flip iOS into the media-playback session, plus a 1-sample silent buffer to unlock
    the context. `play()` is fully synchronous so the video + audio both unlock inside
    the user's tap.

- **`src/components/Player.tsx`** — main UI: video stage, graphs, transport
  (play/scrub/time, kebab menu with export + speed), loop toggle, beat-grid panel,
  fullscreen, and the mobile model (floating PiP video, graph pan/zoom, swap
  graphs↔video in the main spot).
- **`src/components/IntensityGraph.tsx`** — Canvas graph: time-windowed envelope
  rendering, pinch/pan zoom, loop selection by dragging, step-marker bullets.
- **`src/components/BeatGridPanel.tsx`** — Zouk beat-grid controls (dynamics I–V,
  set pickers, phrase length).
- **`src/components/VideoGuides.tsx`** — the on-video tools overlay (gear button →
  guide lines + spotlight rectangle + undo). See [features.md](features.md).
- **`src/components/Processing.tsx`** — shows the (already transcoded) video while
  the stems are still separating.
- **`src/App.tsx`** — polls the manifest, switches Upload → Processing → Player.

## Backend

FastAPI + a single in-process job worker (threading) with a TTL reaper. Files:

- **`backend/app/separation.py`** — the pipeline:
  1. Transcode the upload to browser-friendly H.264 / 8-bit `yuv420p`, **keeping
     audio** (phone uploads are often HEVC/10-bit that browsers can't play), and grab
     a first-frame `poster.jpg`. Write a **partial manifest** (`ready:false`) so the
     player can show/scrub the video immediately.
  2. Extract `audio.wav`.
  3. **Demucs `htdemucs`** (CPU) → 4 stems (drums/bass/vocals/other).
  4. **Fold 4→3**: `percussion=drums`, `voice=vocals`, `instrumental=bass+other`.
  5. Encode each of the 3 stems to `.m4a` (AAC).
  6. RMS **envelopes** per stem → `envelopes.json`. Write the full manifest
     (`ready:true`).
  - Also `export_clip()` for the crop+download feature.
- **`backend/app/main.py`** — routes + upload validation (type/size/duration),
  env-configurable limits (`DATA_DIR`, `MAX_MB`, `MAX_SECS`, `MAX_TRACKS`,
  `TRACK_TTL`, `ALLOWED_ORIGINS`), export, delete, health.
- **`backend/app/jobs.py`** — single-worker queue, `video_ready` callback, TTL
  reaper + count-cap prune, temp-upload cleanup.
- **`backend/app/envelope.py`** — RMS envelope extraction.

PyTorch must be the **CPU** build:
`pip install torch torchaudio torchcodec --index-url https://download.pytorch.org/whl/cpu`
(torchaudio ≥ 2.11 needs torchcodec for I/O).

## Deployment topology

- `docker-compose.yml` (compose **v1.29**): `web` = Caddy serving the built SPA and
  proxying `/api` to the backend, published on host `:8090`; `backend` = uvicorn on
  `:8008` internal; track data in the `dd_data` volume; `restart: unless-stopped`.
- On the VPS, **nginx** owns 80/443 and the `sk-arn.com` vhost proxies to
  `localhost:8090`.
- Recreate with `docker-compose down && docker-compose up -d` (compose v1.29 can hit
  `KeyError: 'ContainerConfig'` on a plain `up -d` recreate; named volumes persist).

## A/V sync — the hard part

Audio is the master clock, video is slaved (see `AudioEngine.ts`). This keeps the
audio glitch-free (most important for the dancer's musical judgement) and lets the
video micro-correct invisibly. The three stems are derived from one source so they
stay sample-aligned with each other; only the stems↔video relationship is actively
synced.

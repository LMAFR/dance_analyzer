# DancersDeck (dance_analyzer)

A DJ-style tool for dancers to review their videos against the music. Play a
dance video in a main panel and, beside it, three **intensity-over-time graphs**
with the song decoupled into **instrumental**, **voice/lyrics** and
**percussion**. Mute any stem from its graph, overlay a configurable **Zouk
step grid** (mark count "1" + "2", pick a dynamic, see each step as a colored
bullet on the curve), **loop** a dragged section, and go **fullscreen** with the
graphs filling the screen and the video as a movable PiP.

## How it works

```
Browser (React + Vite)
  ├─ <video> (muted) — visual master
  ├─ Web Audio engine — 3 stems played as the master clock; video slaved to it
  └─ Canvas intensity graphs + Zouk step grid + loop selection
        │  REST + static media
Backend (FastAPI)
  upload → ffmpeg (extract audio + transcode video to H.264)
         → Demucs htdemucs (drums/bass/vocals/other)
         → fold to 3 (percussion=drums, voice=vocals, instrumental=bass+other)
         → encode m4a stems + RMS envelopes.json + manifest.json
```

Separation runs as an async job (it takes minutes on CPU), with a progress UI.

## Prerequisites

- **Python 3.10+**, **Node 18+**
- **ffmpeg** on your PATH (provides the libraries `torchcodec` needs too)
- ~3–4 GB disk for the PyTorch/Demucs install + model weights

## Run locally

### 1. Backend (FastAPI + Demucs)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install --upgrade pip
# CPU PyTorch stack (matched +cpu builds) — must come from this index:
pip install torch torchaudio torchcodec --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn app.main:app --port 8008 --reload
```

First separation downloads the htdemucs weights (~80 MB) automatically.
Processed tracks are written to `backend/data/<id>/` (git-ignored).

### 2. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Vite proxies `/api` → `http://localhost:8008`, so just open
**http://localhost:5173**, upload a dance video, wait for processing, and play.

> The backend port (8008) is set in `frontend/vite.config.ts`. Change both if needed.

## Layout

```
frontend/
  src/audio/AudioEngine.ts          Web Audio engine + audio-master A/V sync + loop
  src/components/Player.tsx          Player: video, graphs, fullscreen, layout
  src/components/IntensityGraph.tsx  Canvas graph: envelope, step bullets, playhead
  src/components/BeatGridPanel.tsx   Zouk step-grid controls
  src/beatgrid.ts                    Step-pattern math (dynamics I–V)
backend/
  app/main.py                        API: upload, job status, manifest, media
  app/jobs.py                        Single-worker job queue
  app/separation.py                  ffmpeg + Demucs + fold + envelopes pipeline
  app/envelope.py                    RMS intensity envelope
```

## Deploy (Docker)

The whole stack runs via `docker-compose`:
- **backend** — FastAPI + Demucs (CPU); processed tracks persist in a named volume.
- **web** — Caddy serving the built frontend and proxying `/api` → backend.

```bash
cp .env.example .env        # adjust limits / port / domain
docker-compose up -d --build
```

By default the site is served as **plain HTTP on `HTTP_PORT` (8090)** — put that
behind your existing reverse proxy. For **standalone HTTPS**, set
`SITE_ADDRESS=your.domain` in `.env`, uncomment the `443:443` line in
`docker-compose.yml`, and Caddy fetches a Let's Encrypt cert automatically.

Backend env vars (also settable in `.env`): `MAX_MB` (upload size, default 200),
`MAX_SECS` (max duration, default 600), `ALLOWED_ORIGINS`, `DANCERSDECK_DATA_DIR`.

The backend image bakes in the htdemucs weights, so the first separation is fast.

## Performance

Where the wall-clock time goes for an upload (measured on the CPU-only VPS, ~24 s
1080p clip):

| Phase | Time | Bound by |
|-------|------|----------|
| Upload transfer | depends on file size + the user's uplink | network |
| Video transcode (H.264) | ~6–8 s | CPU (libx264) |
| Demucs separation | ~30 s (≈1.2× clip length) | **CPU — dominant** |
| Fold + encode + envelopes | ~5 s | CPU/IO |

Conclusions:
- **Perceived latency is the thing to fix, and it is**: the video is transcoded
  first and shown immediately (partial manifest / "video while processing"), so
  the user waits ~8 s for playback instead of ~45 s for the whole job.
- **Demucs is the floor** on CPU and dominates. The only large *actual* speed-up
  is a **GPU** (htdemucs runs ~10× faster on GPU); everything else is marginal.
- **Parallelising transcode + separation is not worth it here**: both are
  CPU-bound and the box has no spare cores, so running them together mostly trades
  contention for little wall-clock gain.
- **Biggest upload-transfer win (future)**: client-side downscale to ~720p before
  upload (WebCodecs / ffmpeg.wasm) — cuts transfer *and* transcode time, but it's
  a sizable feature; deferred.

## TODO / known limitations

- **Pitch shifts with playback speed.** Speed control uses Web Audio
  `playbackRate` on the stems, so 0.5×/2× also shift the pitch. Pitch-preserved
  slow-mo would need time-stretching (e.g. an `AudioWorklet`/phase-vocoder or a
  library like SoundTouch) — deferred.
- **Landscape mobile layout not done.** The phone UI is tuned for portrait; for
  now landscape is blocked with a "rotate to portrait" overlay. TODO: design a
  proper landscape phone layout and drop the overlay.
- **Landscape source videos untested.** Only portrait clips have been tried.
  TODO: verify the player, PiP, fullscreen (cover-fit), and aspect handling with
  landscape (wide) videos, primarily on desktop.
- **GPU separation for speed.** Demucs is the CPU-bound bottleneck. TODO: try
  offloading separation to a GPU host (e.g. RunPod / Vast.ai) — Demucs runs
  ~10× faster on GPU — to cut upload-to-ready time.
- **Export honouring the spotlight rectangle.** The video-tools spotlight
  rectangle is currently a view-only overlay (it darkens outside the box but isn't
  baked into the exported clip). TODO: let the user choose, when exporting, between
  (a) **cropping** to just the spotlighted box, or (b) the full video frame as seen
  (optionally with the darkening burned in). Not hard: the rectangle is stored as
  fractions of the video box, so it maps to an ffmpeg `crop=w:h:x:y` filter (×
  source dimensions) in `export_clip()`; pass the rect (and mode) from the export UI
  through `exportClip` to the backend. The only fiddly part is mapping fractions to
  even pixel values and keeping it in sync with the video's display vs. encoded size.

## Notes

- Uploads are validated (type, size, duration) and transcoded to
  **H.264 / 8-bit yuv420p** so phone HEVC clips play in the browser.
- Stem mapping: Demucs `htdemucs` → percussion=`drums`, voice=`vocals`,
  instrumental=`bass`+`other`.
- The job queue is a single in-process worker (one separation at a time). Jobs
  are in-memory, so a backend restart loses in-flight jobs; completed tracks
  persist on disk.

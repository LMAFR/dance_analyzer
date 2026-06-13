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

## Notes

- Uploads are transcoded to **H.264 / 8-bit yuv420p** so phone HEVC clips play in
  the browser.
- Stem mapping: Demucs `htdemucs` → percussion=`drums`, voice=`vocals`,
  instrumental=`bass`+`other`.

## Roadmap

Upload size/length validation, error states, and a Dockerized worker for VPS
deployment (Milestone 6).

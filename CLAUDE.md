# CLAUDE.md — guidance for Claude Code instances working in this repo

DancersDeck (repo `dance_analyzer`) is a web app for dancers to review their own
dance videos against the music: the video plays in a main panel while three
intensity-over-time graphs (instrumental, voice, percussion) — decoupled from the
song — show how each layer moves, with per-layer mute/solo, a beat grid, loops,
crop/export, and on-video drawing tools.

## Read this first
Full documentation lives in [`docs/`](docs/README.md):
- [`docs/architecture.md`](docs/architecture.md) — how the frontend, backend, and A/V sync work.
- [`docs/features.md`](docs/features.md) — every user-facing feature and where it lives in the code.
- [`docs/history.md`](docs/history.md) — the journey/changelog that got us here (context for why things are the way they are).
- [`docs/workflow.md`](docs/workflow.md) — **branching + deploy workflow. Read before pushing or deploying.**

## Branch & deploy workflow (important)
- **`dev`** = active development. Make all changes here and test **locally** (`cd frontend && npm run dev`, plus the backend) before anything reaches the live domain.
- **`main`** = production. The live site **https://sk-arn.com is built and deployed from `main`**, not `dev`.
- Flow: work on `dev` → user verifies locally → open a PR `dev` → `main` → merge → deploy `main`.
- See [`docs/workflow.md`](docs/workflow.md) for the exact deploy commands.

## Repo shape
- `frontend/` — React + TypeScript + Vite. The audio↔video sync engine is `frontend/src/audio/AudioEngine.ts` (read its header). The player UI is `frontend/src/components/Player.tsx`.
- `backend/` — FastAPI + Demucs (`htdemucs`, CPU) + ffmpeg separation pipeline.
- `docker-compose.yml` — Caddy (SPA + `/api` proxy) on host `:8090`, uvicorn backend on `:8008` internal. nginx on the VPS owns 80/443 and proxies the `sk-arn.com` vhost to `localhost:8090`.

## Conventions
- Build check before committing: `cd frontend && npx tsc -b && npm run build`.
- `docker-compose` here is v1.29 — recreate with `docker-compose down && docker-compose up -d` (a plain `up -d` can hit `KeyError: 'ContainerConfig'`).
- PyTorch must be the CPU build: `torch torchaudio torchcodec --index-url https://download.pytorch.org/whl/cpu`.

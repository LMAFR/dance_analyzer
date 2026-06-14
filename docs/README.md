# DancersDeck documentation

DancersDeck (repo `dance_analyzer`) is a DJ-style web app for dancers to review
their own dance videos against the music. The video plays in a main panel; three
intensity-over-time graphs — **instrumental**, **voice/lyrics**, **percussion** —
decoupled from the song show how each layer moves over time, with per-layer
mute/solo, a beat grid, loop regions, crop/export, playback-speed control, and
on-video drawing tools (guide lines + a spotlight rectangle).

Users upload a video; the backend separates the audio into the three layers
(Demucs on CPU) and computes intensity envelopes; the frontend plays everything
back in tight audio↔video sync.

## Contents
- [architecture.md](architecture.md) — frontend, backend, the A/V sync engine, deployment topology.
- [features.md](features.md) — every user-facing feature and where it lives in code.
- [history.md](history.md) — how we got here (milestones + notable fixes), useful as context.
- [workflow.md](workflow.md) — branching (`dev` vs `main`) and the deploy procedure.

## TL;DR
- **Frontend**: React + TS + Vite. `frontend/src/audio/AudioEngine.ts` is the master clock (Web Audio) that slaves the `<video>`. `frontend/src/components/Player.tsx` is the main UI.
- **Backend**: FastAPI + ffmpeg + Demucs `htdemucs` (CPU). Pipeline in `backend/app/separation.py`.
- **Live**: https://sk-arn.com, built and deployed from the **`main`** branch via docker-compose. Develop on **`dev`**, test locally, then merge to `main` and deploy.

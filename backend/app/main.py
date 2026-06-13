"""DancersDeck backend API.

POST /api/uploads        -> {job_id}      (enqueue separation)
GET  /api/jobs/{id}      -> job status    (poll for progress)
GET  /api/tracks/{id}    -> manifest.json
GET  /api/tracks/{id}/{file} -> static media (video, stems, envelopes)

Configuration (env vars):
  DANCERSDECK_DATA_DIR   where processed tracks are written (default: ../data)
  DANCERSDECK_MAX_MB     max upload size in MB (default: 200)
  DANCERSDECK_MAX_SECS   max video duration in seconds (default: 600)
  ALLOWED_ORIGINS        comma-separated CORS origins (default: *)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .jobs import JobManager
from .separation import export_clip

DATA_DIR = Path(
    os.environ.get("DANCERSDECK_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data"))
)
MAX_BYTES = int(os.environ.get("DANCERSDECK_MAX_MB", "200")) * 1024 * 1024
MAX_DURATION = float(os.environ.get("DANCERSDECK_MAX_SECS", "600"))  # 10 min
MAX_TRACKS = int(os.environ.get("DANCERSDECK_MAX_TRACKS", "40"))
# Tracks are ephemeral — auto-deleted this many seconds after creation (default 3h).
TRACK_TTL = int(os.environ.get("DANCERSDECK_TRACK_TTL_SECS", "10800"))
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
ALLOWED_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"}

app = FastAPI(title="DancersDeck")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs = JobManager(DATA_DIR, max_tracks=MAX_TRACKS, ttl_secs=TRACK_TTL)


def _probe_duration(path: str) -> float | None:
    """Return the video duration in seconds, or None if it can't be read."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", path],
            check=True, capture_output=True, text=True,
        )
        return float(out.stdout.strip())
    except (subprocess.CalledProcessError, ValueError):
        return None


@app.post("/api/uploads")
async def upload(file: UploadFile = File(...)) -> JSONResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, f"Unsupported file type: {suffix or 'unknown'}")

    # Stream to a temp file with a size cap.
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    size = 0
    try:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_BYTES:
                tmp.close()
                Path(tmp.name).unlink(missing_ok=True)
                raise HTTPException(413, f"File too large (max {MAX_BYTES // (1024 * 1024)} MB)")
            tmp.write(chunk)
    finally:
        tmp.close()

    # Reject anything that isn't a readable video, or that's too long.
    duration = _probe_duration(tmp.name)
    if duration is None:
        Path(tmp.name).unlink(missing_ok=True)
        raise HTTPException(400, "Could not read a video stream from that file")
    if duration > MAX_DURATION:
        Path(tmp.name).unlink(missing_ok=True)
        raise HTTPException(
            413, f"Video too long ({duration:.0f}s; max {MAX_DURATION:.0f}s)"
        )

    job_id = jobs.submit(tmp.name)
    return JSONResponse({"job_id": job_id})


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job.public()


@app.get("/api/tracks/{track_id}")
def manifest(track_id: str) -> dict:
    path = DATA_DIR / track_id / "manifest.json"
    if not path.exists():
        raise HTTPException(404, "Track not found")
    return json.loads(path.read_text())


@app.get("/api/tracks/{track_id}/{filename}")
def track_file(track_id: str, filename: str) -> FileResponse:
    # Prevent path traversal.
    safe = Path(filename).name
    path = (DATA_DIR / track_id / safe).resolve()
    root = (DATA_DIR / track_id).resolve()
    if root not in path.parents or not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path)


class ExportRequest(BaseModel):
    start: float
    end: float
    stems: list[str]


@app.post("/api/tracks/{track_id}/export")
def export(track_id: str, req: ExportRequest) -> FileResponse:
    track_dir = (DATA_DIR / track_id).resolve()
    if not (track_dir / "manifest.json").exists():
        raise HTTPException(404, "Track not found")
    if req.end <= req.start:
        raise HTTPException(400, "end must be after start")

    out = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    out.close()
    try:
        export_clip(str(track_dir), req.start, req.end, req.stems, out.name)
    except Exception as e:  # noqa: BLE001
        Path(out.name).unlink(missing_ok=True)
        raise HTTPException(500, f"Export failed: {e}")

    return FileResponse(
        out.name,
        media_type="video/mp4",
        filename=f"{track_id}_clip.mp4",
        background=BackgroundTask(lambda: Path(out.name).unlink(missing_ok=True)),
    )


@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str) -> dict:
    """Explicitly drop a track's data (called when the user moves on)."""
    d = (DATA_DIR / track_id).resolve()
    if d.parent != DATA_DIR.resolve() or not d.is_dir():
        raise HTTPException(404, "Track not found")
    shutil.rmtree(d, ignore_errors=True)
    return {"deleted": track_id}


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}

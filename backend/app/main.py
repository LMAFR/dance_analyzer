"""DancersDeck backend API.

POST /api/uploads        -> {job_id}      (enqueue separation)
GET  /api/jobs/{id}      -> job status    (poll for progress)
GET  /api/tracks/{id}    -> manifest.json
GET  /api/tracks/{id}/{file} -> static media (video, stems, envelopes)
"""
from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .jobs import JobManager

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MAX_BYTES = 200 * 1024 * 1024  # 200 MB cap (plan v1 limit)
ALLOWED_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"}

app = FastAPI(title="DancersDeck")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before VPS deploy
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs = JobManager(DATA_DIR)


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
                raise HTTPException(413, "File too large (max 200 MB)")
            tmp.write(chunk)
    finally:
        tmp.close()

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


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}

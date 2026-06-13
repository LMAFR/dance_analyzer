"""In-process job queue for the separation pipeline.

A single worker thread serializes jobs so the CPU-only box runs one separation
at a time. The job interface (submit / get) is deliberately small so it can be
swapped for RQ/Celery + Redis later (Milestone 6) without touching the API layer.
"""
from __future__ import annotations

import shutil
import threading
import traceback
import uuid
from dataclasses import dataclass, asdict
from pathlib import Path
from queue import Queue
from typing import Optional

from .separation import process_track


@dataclass
class Job:
    id: str
    state: str = "queued"  # queued | processing | done | error
    stage: str = ""        # extracting | separating | mixing | encoding | analysing
    progress: float = 0.0  # 0..1
    track_id: Optional[str] = None
    error: Optional[str] = None

    def public(self) -> dict:
        return asdict(self)


class JobManager:
    def __init__(self, data_dir: Path, max_tracks: int = 40):
        self.data_dir = data_dir
        self.max_tracks = max_tracks
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._queue: "Queue[tuple[str, str]]" = Queue()
        self._worker = threading.Thread(target=self._run, daemon=True)
        self._worker.start()

    def _prune_tracks(self) -> None:
        """Keep only the most recent `max_tracks` processed tracks (by mtime)."""
        if self.max_tracks <= 0:
            return
        tracks = [
            d for d in self.data_dir.iterdir()
            if d.is_dir() and (d / "manifest.json").exists()
        ]
        tracks.sort(key=lambda d: d.stat().st_mtime, reverse=True)
        for old in tracks[self.max_tracks:]:
            shutil.rmtree(old, ignore_errors=True)

    def submit(self, video_path: str) -> str:
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._jobs[job_id] = Job(id=job_id)
        self._queue.put((job_id, video_path))
        return job_id

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def _update(self, job_id: str, **kw) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for k, v in kw.items():
                setattr(job, k, v)

    def _run(self) -> None:
        while True:
            job_id, video_path = self._queue.get()
            track_id = job_id  # one track per job
            try:
                self._update(job_id, state="processing", stage="extracting")

                def progress(stage: str, frac: float) -> None:
                    self._update(job_id, stage=stage, progress=frac)

                process_track(
                    video_path,
                    str(self.data_dir / track_id),
                    track_id,
                    progress,
                )
                self._update(
                    job_id, state="done", stage="", progress=1.0, track_id=track_id
                )
                self._prune_tracks()
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                self._update(job_id, state="error", error=str(e))
            finally:
                # The upload was streamed to a temp file; drop it once processed.
                Path(video_path).unlink(missing_ok=True)
                self._queue.task_done()

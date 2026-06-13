"""Audio separation pipeline.

ffmpeg (extract audio) -> Demucs htdemucs (4 stems) -> fold to 3 stems
(percussion=drums, voice=vocals, instrumental=bass+other) -> encode m4a ->
RMS envelopes.json + manifest.json.

The 4->3 fold is the core mapping from the plan: Demucs natively outputs
drums/bass/vocals/other; we sum bass+other into "instrumental".
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf

from .envelope import compute_envelope

# Stage -> progress fraction (0..1) shown when the stage *starts*. Reporting at
# the start means the UI displays the stage actually in progress (important for
# the slow "separating" step, which dominates the wall-clock time).
STAGES = {
    "extracting": 0.02,
    "separating": 0.10,
    "mixing": 0.82,
    "encoding": 0.88,
    "analysing": 0.96,
}

# Demucs source stems -> our 3-stem mapping.
DEMUCS_MODEL = "htdemucs"
STEM_MAP = {
    "percussion": ["drums"],
    "voice": ["vocals"],
    "instrumental": ["bass", "other"],
}

ProgressCb = Callable[[str, float], None]


@dataclass
class TrackResult:
    track_id: str
    duration: float
    video: str
    stems: dict[str, str]  # id -> relative m4a path
    envelopes_path: str


def _run(cmd: list[str], **kw) -> None:
    subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def _ffmpeg_extract_audio(video: Path, out_wav: Path) -> None:
    _run([
        "ffmpeg", "-y", "-i", str(video),
        "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le",
        str(out_wav),
    ])


def _transcode_web_video(src: Path, out: Path) -> None:
    """Re-encode to browser-friendly H.264 / 8-bit yuv420p.

    Phone uploads are often HEVC (and 10-bit), which most browsers can't play in
    a <video>. We strip the audio (the stems carry it; the player mutes the
    video) and put the moov atom up front for streaming.
    """
    _run([
        "ffmpeg", "-y", "-i", str(src),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "veryfast",
        "-movflags", "+faststart", "-an",
        str(out),
    ])


def _demucs_separate(wav: Path, out_dir: Path) -> Path:
    """Run Demucs; return the directory holding the 4 stem wavs."""
    _run([
        sys.executable, "-m", "demucs",
        "-n", DEMUCS_MODEL,
        "-o", str(out_dir),
        str(wav),
    ])
    # Demucs writes <out_dir>/<model>/<input-stem-name>/{drums,bass,vocals,other}.wav
    stem_dir = out_dir / DEMUCS_MODEL / wav.stem
    if not stem_dir.exists():
        raise RuntimeError(f"Demucs output not found at {stem_dir}")
    return stem_dir


def _fold_stems(stem_dir: Path, work: Path) -> dict[str, Path]:
    """Sum Demucs stems into our 3, writing wavs. Returns id -> wav path."""
    out: dict[str, Path] = {}
    for target, sources in STEM_MAP.items():
        mix = None
        sr = 44100
        for name in sources:
            data, sr = sf.read(stem_dir / f"{name}.wav", dtype="float32", always_2d=True)
            mix = data if mix is None else mix + data
        assert mix is not None
        # Guard against summed clipping.
        peak = float(np.max(np.abs(mix))) if mix.size else 0.0
        if peak > 1.0:
            mix = mix / peak
        path = work / f"{target}.wav"
        sf.write(path, mix, sr)
        out[target] = path
    return out


def _encode_m4a(wav: Path, out_m4a: Path) -> None:
    _run([
        "ffmpeg", "-y", "-i", str(wav),
        "-c:a", "aac", "-b:a", "160k",
        str(out_m4a),
    ])


def process_track(
    video_path: str,
    track_dir: str,
    track_id: str,
    progress: ProgressCb | None = None,
) -> TrackResult:
    """Run the full pipeline. Outputs land in `track_dir`."""
    def report(stage: str) -> None:
        if progress:
            progress(stage, STAGES[stage])

    tdir = Path(track_dir)
    tdir.mkdir(parents=True, exist_ok=True)
    work = tdir / "_work"
    work.mkdir(exist_ok=True)

    video = Path(video_path)

    # 1. Extract audio + transcode the video to a browser-playable codec.
    report("extracting")
    audio_wav = work / "audio.wav"
    _ffmpeg_extract_audio(video, audio_wav)
    video_out = tdir / "video.mp4"
    _transcode_web_video(video, video_out)

    # 2. Separate (the slow CPU step that dominates wall-clock time).
    report("separating")
    stem_dir = _demucs_separate(audio_wav, work / "demucs")

    # 3. Fold 4 -> 3.
    report("mixing")
    folded = _fold_stems(stem_dir, work)

    # 4. Encode web stems.
    report("encoding")
    stem_paths: dict[str, str] = {}
    for sid, wav in folded.items():
        m4a = tdir / f"{sid}.m4a"
        _encode_m4a(wav, m4a)
        stem_paths[sid] = m4a.name

    # 5. Envelopes.
    report("analysing")
    envelopes: dict[str, object] = {}
    duration = 0.0
    for sid, wav in folded.items():
        samples, dur = compute_envelope(str(wav))
        envelopes[sid] = samples
        duration = max(duration, dur)
    env_doc = {"duration": round(duration, 3), "fps": 15, "stems": envelopes}
    env_path = tdir / "envelopes.json"
    env_path.write_text(json.dumps(env_doc))

    result = TrackResult(
        track_id=track_id,
        duration=round(duration, 3),
        video=video_out.name,
        stems=stem_paths,
        envelopes_path=env_path.name,
    )
    manifest = {
        "id": track_id,
        "duration": result.duration,
        "video": result.video,
        "stems": [
            {"id": sid, "url": path} for sid, path in stem_paths.items()
        ],
        "envelopes": env_path.name,
    }
    (tdir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    # Clean intermediate files.
    shutil.rmtree(work, ignore_errors=True)
    return result

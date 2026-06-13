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
    "preparing": 0.01,   # transcode the video first -> it becomes viewable
    "extracting": 0.06,
    "separating": 0.12,
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
    """Re-encode to browser-friendly H.264 / 8-bit yuv420p, keeping the original
    audio so the clip is watchable (with sound) while stems are still separating.

    Phone uploads are often HEVC (and 10-bit), which most browsers can't play in
    a <video>; moov up front for streaming.
    """
    _run([
        "ffmpeg", "-y", "-i", str(src),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        str(out),
    ])


def _probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        check=True, capture_output=True, text=True,
    )
    return round(float(out.stdout.strip()), 3)


def _write_manifest(tdir: Path, track_id: str, duration: float,
                    stems: dict[str, str], env_name: str | None, ready: bool) -> None:
    manifest = {
        "id": track_id,
        "duration": duration,
        "video": "video.mp4",
        "stems": [{"id": sid, "url": path} for sid, path in stems.items()],
        "envelopes": env_name,
        "ready": ready,
    }
    (tdir / "manifest.json").write_text(json.dumps(manifest, indent=2))


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


def export_clip(track_dir: str, start: float, end: float, stem_ids: list[str], out_path: str) -> None:
    """Render a cropped clip: video trimmed to [start, end] with only the chosen
    stems mixed as its audio. Used by the "crop + download" feature."""
    tdir = Path(track_dir)
    video = tdir / "video.mp4"
    if not video.exists():
        raise FileNotFoundError("video.mp4 missing")
    start = max(0.0, start)
    end = max(start + 0.1, end)

    # Input 0 = video (trimmed); inputs 1..N = chosen stems (trimmed).
    cmd = ["ffmpeg", "-y", "-ss", f"{start}", "-to", f"{end}", "-i", str(video)]
    stems = [s for s in stem_ids if (tdir / f"{s}.m4a").exists()]
    for s in stems:
        cmd += ["-ss", f"{start}", "-to", f"{end}", "-i", str(tdir / f"{s}.m4a")]

    if stems:
        mix = "".join(f"[{i + 1}:a]" for i in range(len(stems)))
        cmd += [
            "-filter_complex", f"{mix}amix=inputs={len(stems)}:normalize=0[a]",
            "-map", "0:v", "-map", "[a]",
            "-c:a", "aac", "-b:a", "192k",
        ]
    else:
        cmd += ["-map", "0:v", "-an"]  # all stems off -> silent clip

    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path]
    _run(cmd)


def process_track(
    video_path: str,
    track_dir: str,
    track_id: str,
    progress: ProgressCb | None = None,
    on_video_ready: Callable[[float], None] | None = None,
) -> TrackResult:
    """Run the full pipeline. Outputs land in `track_dir`.

    The video is transcoded first and a partial manifest (ready=false) is written
    so the player can show/play it immediately while the stems separate.
    """
    def report(stage: str) -> None:
        if progress:
            progress(stage, STAGES[stage])

    tdir = Path(track_dir)
    tdir.mkdir(parents=True, exist_ok=True)
    work = tdir / "_work"
    work.mkdir(exist_ok=True)

    video = Path(video_path)

    # 1. Transcode the video FIRST so it's viewable right away; publish a partial
    #    manifest and notify the caller that the video is ready.
    report("preparing")
    video_out = tdir / "video.mp4"
    _transcode_web_video(video, video_out)
    duration = _probe_duration(video_out)
    _write_manifest(tdir, track_id, duration, stems={}, env_name=None, ready=False)
    if on_video_ready:
        on_video_ready(duration)

    # 2. Extract audio for separation.
    report("extracting")
    audio_wav = work / "audio.wav"
    _ffmpeg_extract_audio(video, audio_wav)

    # 3. Separate (the slow CPU step that dominates wall-clock time).
    report("separating")
    stem_dir = _demucs_separate(audio_wav, work / "demucs")

    # 4. Fold 4 -> 3.
    report("mixing")
    folded = _fold_stems(stem_dir, work)

    # 5. Encode web stems.
    report("encoding")
    stem_paths: dict[str, str] = {}
    for sid, wav in folded.items():
        m4a = tdir / f"{sid}.m4a"
        _encode_m4a(wav, m4a)
        stem_paths[sid] = m4a.name

    # 6. Envelopes.
    report("analysing")
    envelopes: dict[str, object] = {}
    for sid, wav in folded.items():
        samples, dur = compute_envelope(str(wav))
        envelopes[sid] = samples
        duration = max(duration, dur)
    env_doc = {"duration": round(duration, 3), "fps": 15, "stems": envelopes}
    env_path = tdir / "envelopes.json"
    env_path.write_text(json.dumps(env_doc))

    # 7. Finalize: full manifest (ready=true).
    _write_manifest(tdir, track_id, round(duration, 3), stem_paths, env_path.name, ready=True)

    shutil.rmtree(work, ignore_errors=True)
    return TrackResult(
        track_id=track_id,
        duration=round(duration, 3),
        video=video_out.name,
        stems=stem_paths,
        envelopes_path=env_path.name,
    )

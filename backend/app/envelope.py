"""RMS-intensity envelope extraction for a stem.

Produces a downsampled, normalized (0..1) intensity curve over time, which the
frontend draws as the intensity graph (Y = intensity, X = time).
"""
from __future__ import annotations

import numpy as np
import soundfile as sf


def compute_envelope(wav_path: str, fps: float = 15.0) -> tuple[list[float], float]:
    """Return (samples, duration_seconds).

    `fps` is the number of envelope points per second of audio. ~15 keeps the
    JSON small while staying smooth for a line graph.
    """
    data, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    duration = len(mono) / sr

    hop = max(1, int(round(sr / fps)))
    n_frames = int(np.ceil(len(mono) / hop))
    # Pad to a whole number of frames, then RMS per frame.
    padded = np.zeros(n_frames * hop, dtype="float32")
    padded[: len(mono)] = mono
    frames = padded.reshape(n_frames, hop)
    rms = np.sqrt(np.mean(frames * frames, axis=1))

    peak = float(rms.max()) if rms.size else 0.0
    if peak > 1e-6:
        rms = rms / peak
    return rms.astype(float).round(4).tolist(), duration

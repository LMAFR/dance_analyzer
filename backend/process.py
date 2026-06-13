#!/usr/bin/env python
"""CLI to run the separation pipeline on one video (Milestone 2 test harness).

Usage:
    venv/bin/python process.py <video> [track_id]

Outputs to backend/data/<track_id>/.
"""
import sys
import time
from pathlib import Path

from app.separation import process_track

DATA_DIR = Path(__file__).parent / "data"


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    video = sys.argv[1]
    track_id = sys.argv[2] if len(sys.argv) > 2 else Path(video).stem

    out = DATA_DIR / track_id
    start = time.time()

    def progress(stage: str, frac: float) -> None:
        print(f"[{frac*100:5.1f}%] {stage}  (+{time.time()-start:.1f}s)")

    print(f"Processing {video} -> {out}")
    result = process_track(video, str(out), track_id, progress)
    print(f"\nDone in {time.time()-start:.1f}s")
    print(f"  duration : {result.duration}s")
    print(f"  video    : {result.video}")
    print(f"  stems    : {result.stems}")
    print(f"  manifest : {out/'manifest.json'}")


if __name__ == "__main__":
    main()

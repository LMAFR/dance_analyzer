# Features

A tour of what the app does, grouped by area, with pointers to the code.

## Upload & processing
- **Upload** a dance video (drag-drop / file picker). Validated for type, size and
  duration. `frontend/src/components/Upload.tsx`, `backend/app/main.py`.
- **Watch while it processes**: the video is transcoded first and shown immediately
  (playable + scrubbable) with a progress bar while the music layers separate in the
  background. `frontend/src/components/Processing.tsx`.
- **Ephemeral storage**: tracks are reaped after a TTL and capped in count;
  "← New video" deletes the current track. `backend/app/jobs.py`.

## Playback & sync
- **Three music layers** decoupled from the song: instrumental, voice/lyrics,
  percussion (Demucs `htdemucs`, folded 4→3).
- **Tight A/V sync**: Web Audio master clock, video slaved via `playbackRate`
  nudging. `frontend/src/audio/AudioEngine.ts`.
- **Per-layer mute / solo** via gain nodes (mute buttons live on the graphs).
- **Tap-to-play** circle on the video; transport with play/scrub/time.
- **Playback speed** 0.25×–2× (kebab `⋮` menu).
- **Loop region**: opt-in loop toggle (∞); drag on a graph to select the loop range;
  edge auto-pan while selecting.
- **Buffering hold**: if the video runs short of data, the whole app freezes
  together (video + audio + graphs + one spinner) and resumes in sync — never video
  running while the music/graphs are stuck (or vice-versa).
- **iOS audio handling**: media-session unlock so the Web Audio stems aren't silenced
  by the phone's ring switch; gesture-safe play.

## Intensity graphs
- **Canvas intensity-over-time graphs**, one per layer, with a synced playhead.
  `frontend/src/components/IntensityGraph.tsx`.
- **Zoom & pan**: pinch / wheel zoom, drag to pan when zoomed, follow-playhead while
  playing.
- **Show 1, 2 or 3 graphs** in the main spot; a lone graph spans more rows.
- In **fullscreen**, graphs become a semi-transparent overlay on the video.

## Beat grid (Zouk)
- **Beat-grid panel**: Zouk dynamics patterns I–V, set pickers, phrase length;
  step markers rendered as coloured bullets (three green tones) on the graphs.
  `frontend/src/components/BeatGridPanel.tsx`, `frontend/src/beatgrid.ts`.

## Video tools overlay
An almost-transparent **⚙ gear** in the video's bottom-right corner (mobile +
desktop) expands a small toolbar. `frontend/src/components/VideoGuides.tsx`.
- **Vertical guide line** — drag left/right.
- **Horizontal guide line** — drag up/down.
- **Spotlight rectangle** — draw a box; everything outside it is darkened. One at a
  time; **resize-only** via subtle corner handles (large touch targets, in a
  non-clipped layer so corners are grabbable). Guide lines always render above the
  rectangle so they stay movable inside the box.
- **Undo** the last item (also **Ctrl/Cmd+Z**).
- Everything is stored as fractions of the video box, so it **scales** to any size
  and **persists** across the main ⇄ floating-PiP views.

## Export
- **Crop + download**: render a clip trimmed to the loop/selected range, mixing only
  the chosen stems as its audio. `exportClip` in `frontend/src/api.ts`,
  `export_clip()` in `backend/app/separation.py`.

## Mobile
- Portrait-tuned layout; **rotate-to-portrait** prompt in landscape.
- **Floating PiP video** when graphs are in the main spot (draggable + resizable;
  resize grip bottom-left, tools gear bottom-right).
- Swap graphs ↔ video in the main spot via the maximize (⛶) buttons (no separate
  fullscreen button on phones).
- Larger touch targets throughout.

## Known TODOs (see repo README)
- Pitch-preserved speed change (time-stretch).
- Landscape phone layout; testing landscape source videos.
- GPU separation (RunPod / Vast.ai) for faster processing.

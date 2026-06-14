# History — how we got here

Context for future iterations: the path the project took and why some things are the
way they are. Roughly chronological.

## Planning & build (milestones)
- **Plan**: a DJ-style dance-video review app. Decisions: users upload their own
  videos; CPU-only VPS (no GPU) → async processing with a progress UI; local dev
  first, then deploy. Audio source separation = Demucs `htdemucs` (folded 4→3).
- **M1 Sync spike** — `<video>` + Web Audio stems + the audio-master sync loop +
  mute/solo. Proved the riskiest piece (A/V sync).
- **M2 Pipeline** — FastAPI upload → ffmpeg → Demucs → 3-stem fold → `envelopes.json`.
- **M3 Async jobs + progress UI**.
- **M4 Player UI** — Canvas intensity graphs, playhead, transport, click-to-seek.
- **M5 Fullscreen transparent overlay** + styling.
- **M6 Hardening** — input limits, error states, Dockerized deploy to **sk-arn.com**.

## v2 features
- Crop + download **export** (time range + chosen stems).
- **Playback speed** 0.25×–2×.
- **Ephemeral** track storage (TTL reaper + count cap).
- Show/scrub the **video while stems are still processing**.

## Beat grid & graph UX
- Zouk **beat grid** (dynamics I–V, set pickers, phrase length); step markers as
  coloured bullets.
- Mute buttons moved **onto the graphs** (dropped the separate solo/mute legend).
- Graph **zoom/pan**, follow-playhead, show 1/2/3 graphs in the main spot, lone graph
  spanning more rows.
- **Loop** simplified to a single opt-in ∞ toggle (disabling the loop also clears the
  current selection); drag-to-select with edge auto-pan.

## Mobile
- Portrait-tuned layout; **rotate-to-portrait** prompt for landscape.
- **Floating PiP** video when graphs are in the main spot (draggable + resizable).
- For phones, "fullscreen" was folded into the swap model (no separate FS button);
  swap graphs ↔ video via the maximize buttons.
- Lots of touch-target / spacing polish.

## The iOS audio/playback saga (notable, hard-won)
Several iterations to get reliable playback on iPhone Safari:
- Black video / stuck "loading": iOS doesn't fire `canplay` until play → gate
  playback on the stems being decoded, not on a flaky `canplay`; and call
  `video.play()` **before** awaiting `ctx.resume()` so the user gesture isn't lost.
- A **tap-to-play** circle gives iOS the direct gesture.
- **No audio** despite video playing: start the Web Audio stem sources **inside** the
  play gesture; then the real fix — flip iOS into the media-playback audio session
  (tiny inaudible looping `<audio>` element) so the stems aren't silenced by the ring
  switch. Verified working on device.
- First-frame **poster** to avoid a black frame before play.

## Video tools overlay
- Almost-transparent **⚙ gear** → toolbar.
- **Guide lines** (vertical/horizontal, draggable), persisting across views and
  scaling to the video size.
- **Spotlight rectangle**: draw a box, darken outside; one at a time; made
  **resize-only** (so it doesn't fight the lines), lines kept above it, subtle
  corner handles moved to a **non-clipped** layer with large touch targets so corners
  are reliably grabbable.
- Play glyph reduced to a centered circle so the PiP stays draggable and the play tap
  works when the video is a PiP.

## Buffering gate (two-sided)
- First: video froze while graphs kept running (waited for processing).
- Later inverse bug: video ran while audio/graphs were frozen behind a stuck spinner.
- Final design: **hold everything together** — pause the video + suspend the audio,
  enter only when the video genuinely lacks data, and recover from the rAF loop once
  it can play again (don't depend on the `playing` event).

## Workflow change
Adopted a **`dev` (develop/test locally) → `main` (deployed to the domain)** branch
workflow. See [workflow.md](workflow.md).

// Beat/step grid for Zouk. The dancer marks where count "1" lands (`anchor`) and
// where count "2" lands; the gap is one beat (`beatDuration`). A "dynamic" is a
// triple-step pattern given as the three count positions within the 2-beat basic.
// From those we place a bullet on each graph at the exact moment of every step,
// repeating across the song.

export interface ZoukDynamic {
  id: string;
  label: string;
  counts: [number, number, number]; // step positions in counts (count 1 = the "1")
}

// The 5 Zouk dynamics. Each triple-step spans the 2-beat basic (count 1 -> count 3).
export const ZOUK_DYNAMICS: ZoukDynamic[] = [
  { id: 'I', label: 'I · 1 · 1.75 · 2.5', counts: [1, 1.75, 2.5] },
  { id: 'II', label: 'II · 1 · 2 · 2.5', counts: [1, 2, 2.5] },
  { id: 'III', label: 'III · 1 · 1.5 · 2', counts: [1, 1.5, 2] },
  { id: 'IV', label: 'IV · 1 · 1.75 · 2', counts: [1, 1.75, 2] },
  { id: 'V', label: 'V · 0.5 · 1 · 2', counts: [0.5, 1, 2] },
];

// The zouk basic spans 2 beats; a new phrase every 8 cycles.
export const CYCLE_BEATS = 2;
export const PHRASE_CYCLES = 8;

// Three tones of green for the 1st / 2nd / 3rd step of each triple.
export const STEP_COLORS = ['#9bf6b0', '#39d353', '#157f3c'];
export const STEP_NAMES = ['1st step', '2nd step', '3rd step'];

export interface BeatGridConfig {
  enabled: boolean;
  anchor: number; // time (s) of count "1"
  anchorSet: boolean;
  beatDuration: number; // seconds per beat (count 1 -> count 2)
  beatSet: boolean;
  dynamicId: string;
}

export const DEFAULT_BEATGRID: BeatGridConfig = {
  enabled: true,
  anchor: 0,
  anchorSet: false,
  beatDuration: 0.5,
  beatSet: false,
  dynamicId: 'II',
};

export interface StepMarker {
  time: number;
  stepIndex: 0 | 1 | 2; // which of the triple
  label: string; // musical count, e.g. "1", "2.5"
  phrase: boolean; // start of a new 8-cycle phrase
}

export function getDynamic(id: string): ZoukDynamic {
  return ZOUK_DYNAMICS.find((d) => d.id === id) ?? ZOUK_DYNAMICS[1];
}

export function gridReady(cfg: BeatGridConfig): boolean {
  return cfg.enabled && cfg.anchorSet && cfg.beatSet && cfg.beatDuration > 0;
}

const fmtCount = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '').replace(/\.$/, '');

export function computeStepMarkers(
  cfg: BeatGridConfig,
  duration: number
): StepMarker[] {
  const markers: StepMarker[] = [];
  if (!gridReady(cfg) || duration <= 0) return markers;

  const dyn = getDynamic(cfg.dynamicId);
  const offsets = dyn.counts.map((c) => c - 1); // beats from the "1"
  const cycleSeconds = CYCLE_BEATS * cfg.beatDuration;
  const firstCycle = Math.floor((0 - cfg.anchor) / cycleSeconds) - 1;
  const lastCycle = Math.ceil((duration - cfg.anchor) / cycleSeconds) + 1;

  for (let k = firstCycle; k <= lastCycle; k++) {
    const phraseStart = ((k % PHRASE_CYCLES) + PHRASE_CYCLES) % PHRASE_CYCLES === 0;
    offsets.forEach((offset, i) => {
      const beatPos = k * CYCLE_BEATS + offset;
      const time = cfg.anchor + beatPos * cfg.beatDuration;
      if (time < 0 || time > duration) return;
      markers.push({
        time,
        stepIndex: i as 0 | 1 | 2,
        label: fmtCount(beatPos + 1),
        phrase: phraseStart && i === 0,
      });
    });
  }
  return markers;
}

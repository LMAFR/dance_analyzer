// Time formatting with millisecond precision — the beat anchor needs ms accuracy.
export function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00.000';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t - Math.floor(t)) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

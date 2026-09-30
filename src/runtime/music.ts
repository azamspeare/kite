import type { MusicAnalysis } from '../shared/types';

export type MusicGrid = 'beat' | 'bar' | 'phrase' | 'half' | 'quarter';

export interface MusicSection {
  start: number;
  end: number;
  label: string;
  energy: number;
}

/**
 * The music as seen from inside one scene. Every time is scene-local seconds
 * (0 = the first frame of this scene), so animations keyed to beats stay in
 * sync when scenes are moved or re-timed.
 */
export interface Music {
  /** False when the project has no track; the grid then falls back to 120 BPM starting at t = 0. */
  hasTrack: boolean;
  bpm: number;
  /** Seconds per beat. */
  beatLength: number;
  beatsPerBar: number;
  beats: number[];
  downbeats: number[];
  phrases: number[];
  sections: MusicSection[];
  accents: { t: number; strength: number }[];
  /** Time of the nth beat at/after the scene start (fractional n interpolates, n < 0 goes back). */
  beat(n: number): number;
  /** Time of the nth bar start (downbeat) at/after the scene start. */
  bar(n: number): number;
  /** Time of the nth phrase start at/after the scene start. */
  phrase(n: number): number;
  /** Nearest grid time to t. */
  snap(t: number, grid?: MusicGrid): number;
  /** 1 exactly on each grid hit, decaying exponentially afterwards — for beat-reactive pulses. */
  pulse(t: number, options?: { grid?: MusicGrid; decay?: number }): number;
  /** 0 → 1 progress through the current beat. */
  beatPhase(t: number): number;
}

const EPS = 0.005;

function indexAtOrAfter(arr: number[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Value at (possibly fractional / out of range) index k of an ascending grid with fallback spacing. */
function gridValue(arr: number[], k: number, spacing: number): number {
  if (arr.length === 0) return k * spacing;
  const last = arr.length - 1;
  if (k < 0) return arr[0] + k * spacing;
  if (k > last) return arr[last] + (k - last) * spacing;
  const i = Math.floor(k);
  const f = k - i;
  return f === 0 ? arr[i] : arr[i] + (arr[i + 1] - arr[i]) * f;
}

function nth(arr: number[], n: number, spacing: number): number {
  const i0 = indexAtOrAfter(arr, -EPS);
  if (arr.length === 0 || i0 >= arr.length) {
    // No grid points after the scene start: extrapolate from the last known point.
    const lastPoint = arr.length ? arr[arr.length - 1] : 0;
    const stepsToZero = Math.ceil((-EPS - lastPoint) / spacing);
    return lastPoint + (stepsToZero + n) * spacing;
  }
  return gridValue(arr, i0 + n, spacing);
}

function subdivide(beats: number[], parts: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    out.push(beats[i]);
    if (i + 1 < beats.length) {
      const step = (beats[i + 1] - beats[i]) / parts;
      for (let p = 1; p < parts; p++) out.push(beats[i] + step * p);
    }
  }
  return out;
}

function nearest(arr: number[], t: number): number {
  if (arr.length === 0) return t;
  const i = indexAtOrAfter(arr, t);
  if (i <= 0) return arr[0];
  if (i >= arr.length) return arr[arr.length - 1];
  return t - arr[i - 1] <= arr[i] - t ? arr[i - 1] : arr[i];
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function diffs(arr: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] - arr[i - 1]);
  return out;
}

export function createMusic(input: {
  analysis: MusicAnalysis | null;
  /** Track time at video t = 0. */
  musicStart: number;
  /** Scene start in video time. */
  sceneStart: number;
  sceneDuration: number;
}): Music {
  const { analysis, musicStart, sceneStart, sceneDuration } = input;
  let hasTrack = false;
  let bpm = 120;
  let beatsPerBar = 4;
  let beats: number[];
  let downbeats: number[];
  let phrases: number[];
  let sections: MusicSection[] = [];
  let accents: { t: number; strength: number }[] = [];

  if (analysis && analysis.beats.length > 1) {
    hasTrack = true;
    const offset = musicStart + sceneStart;
    const local = (x: number) => Math.round((x - offset) * 10000) / 10000;
    bpm = analysis.bpm;
    beatsPerBar = analysis.beatsPerBar || 4;
    beats = analysis.beats.map(local);
    downbeats = analysis.downbeats.map(local);
    phrases = analysis.phrases.map(local);
    sections = analysis.sections.map((s) => ({ ...s, start: local(s.start), end: local(s.end) }));
    accents = analysis.accents.map((a) => ({ t: local(a.t), strength: a.strength }));
  } else {
    const count = Math.ceil((sceneDuration + 8) / 0.5);
    beats = Array.from({ length: count + 8 }, (_, i) => (i - 8) * 0.5);
    downbeats = beats.filter((_, i) => (i - 8) % 4 === 0);
    phrases = beats.filter((_, i) => (i - 8) % 32 === 0);
  }

  const beatLength = median(diffs(beats), 60 / bpm);
  const barLength = median(diffs(downbeats), beatLength * beatsPerBar);
  const phraseLength = median(diffs(phrases), barLength * 8);
  const grids: Record<MusicGrid, () => number[]> = {
    beat: () => beats,
    bar: () => downbeats,
    phrase: () => phrases,
    half: () => subdivide(beats, 2),
    quarter: () => subdivide(beats, 4),
  };
  const cache = new Map<MusicGrid, number[]>();
  const grid = (g: MusicGrid) => {
    let arr = cache.get(g);
    if (!arr) {
      arr = grids[g]();
      cache.set(g, arr);
    }
    return arr;
  };

  return {
    hasTrack,
    bpm,
    beatLength,
    beatsPerBar,
    beats,
    downbeats,
    phrases,
    sections,
    accents,
    beat: (n) => nth(beats, n, beatLength),
    bar: (n) => nth(downbeats, n, barLength),
    phrase: (n) => nth(phrases, n, phraseLength),
    snap: (t, g = 'beat') => nearest(grid(g), t),
    pulse: (t, options = {}) => {
      const arr = grid(options.grid ?? 'beat');
      const i = indexAtOrAfter(arr, t + 1e-9) - 1;
      if (i < 0) return 0;
      return Math.exp(-(options.decay ?? 6) * (t - arr[i]));
    },
    beatPhase: (t) => {
      const i = indexAtOrAfter(beats, t + 1e-9) - 1;
      if (i < 0 || i + 1 >= beats.length) return (((t / beatLength) % 1) + 1) % 1;
      return (t - beats[i]) / (beats[i + 1] - beats[i]);
    },
  };
}

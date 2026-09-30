import type { ResolvedCue } from '../../src/shared/types';
import { db, silence, type Stereo } from './audio';

/** A library sound ready to be placed: its samples and where its loudest moment is (seconds). */
export interface CueSource {
  audio: Stereo;
  peak: number;
}

/** Where a cue actually sounds, in video seconds, after `align`, `pitch` and `duration`. */
export interface Placement {
  cue: ResolvedCue;
  start: number;
  end: number;
  /** Playback rate from the pitch shift. */
  rate: number;
  /** Video time of the sound's loudest moment. */
  peakAt: number;
}

/** Master ceiling: −1 dBFS. */
export const CEILING = 10 ** (-1 / 20);
/** Seconds the whole mix fades out over at the end of the video (as renders always did). */
export const END_FADE = 0.6;
const CUT_FADE = 0.01;

export function placeCue(cue: ResolvedCue, source: CueSource): Placement {
  const rate = 2 ** (cue.pitch / 12);
  const length = source.audio.left.length / source.audio.sampleRate / rate;
  const peak = source.peak / rate;
  const start = cue.t - (cue.align === 'peak' ? peak : 0);
  const end = start + Math.min(length, cue.duration ?? Infinity);
  return { cue, start, end, rate, peakAt: start + peak };
}

/** Channel gains for Web Audio's StereoPannerNode with stereo input (the preview uses that node). */
export function panGains(pan: number): { ll: number; rl: number; lr: number; rr: number } {
  if (pan <= 0) {
    const x = ((pan + 1) * Math.PI) / 2;
    // out L = L + R·cos(x), out R = R·sin(x)
    return { ll: 1, rl: Math.cos(x), lr: 0, rr: Math.sin(x) };
  }
  const x = (pan * Math.PI) / 2;
  // out L = L·cos(x), out R = R + L·sin(x)
  return { ll: Math.cos(x), rl: 0, lr: Math.sin(x), rr: 1 };
}

/** 4th-order Butterworth low-pass (two biquads), in place: keeps pitched-up sounds from aliasing. */
function lowpass(signal: Float32Array, cutoff: number, sampleRate: number): Float32Array {
  const out = new Float32Array(signal);
  const w = (2 * Math.PI * Math.min(cutoff, sampleRate * 0.49)) / sampleRate;
  for (const q of [0.5412, 1.3066]) {
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    const b0 = (1 - cos) / 2 / a0;
    const b1 = (1 - cos) / a0;
    const b2 = b0;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x0 = out[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      out[i] = y0;
    }
  }
  return out;
}

const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  (((-0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3) * t + (p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3)) * t + (-0.5 * p0 + 0.5 * p2)) * t +
  p1;

/**
 * Add one placed cue into `out`, whose sample 0 is video time `origin`. The cue's volume, pan, pitch
 * (resampling with cubic interpolation) and duration cut (short fade) are applied.
 */
export function renderCue(out: Stereo, origin: number, place: Placement, source: CueSource): void {
  const sr = out.sampleRate;
  const src = source.audio;
  let left = src.left;
  let right = src.right;
  const step = place.rate * (src.sampleRate / sr);
  if (step > 1.02) {
    const cutoff = (0.45 * src.sampleRate) / step;
    left = lowpass(left, cutoff, src.sampleRate);
    right = lowpass(right, cutoff, src.sampleRate);
  }
  const g = panGains(place.cue.pan);
  const volume = place.cue.volume;
  const s0 = (place.start - origin) * sr;
  const s1 = (place.end - origin) * sr;
  const from = Math.max(0, Math.ceil(s0));
  const to = Math.min(out.left.length, Math.floor(s1));
  const cut = place.cue.duration !== undefined && place.end - place.start < src.left.length / src.sampleRate / place.rate - 1e-6;
  const fadeSamples = CUT_FADE * sr;
  const last = src.left.length - 1;
  const at = (arr: Float32Array, i: number) => arr[i < 0 ? 0 : i > last ? last : i];
  for (let n = from; n < to; n++) {
    const pos = (n - s0) * step;
    const i = Math.floor(pos);
    if (i > last) break;
    const f = pos - i;
    const l = cubic(at(left, i - 1), at(left, i), at(left, i + 1), at(left, i + 2), f);
    const r = cubic(at(right, i - 1), at(right, i), at(right, i + 1), at(right, i + 2), f);
    let gain = volume;
    if (cut && s1 - n < fadeSamples) gain *= Math.max(0, (s1 - n) / fadeSamples);
    out.left[n] += (l * g.ll + r * g.rl) * gain;
    out.right[n] += (l * g.lr + r * g.rr) * gain;
  }
}

export interface LimiterStats {
  /** Deepest gain reduction, dB (≤ 0), and when. */
  maxReductionDb: number;
  maxAt: number;
  /** Seconds during which the limiter pulled more than 1 dB. */
  limitedSeconds: number;
}

/**
 * Look-ahead peak limiter (offline, so no added latency): the gain reaches its target exactly on each
 * peak, ramps in over the look-ahead window and recovers with an exponential release. Returns the gain curve.
 */
export function limit(
  audio: Stereo,
  ceiling = CEILING,
  lookahead = 0.005,
  release = 0.08,
): { gain: Float32Array; stats: LimiterStats } {
  const n = audio.left.length;
  const sr = audio.sampleRate;
  const la = Math.max(1, Math.round(lookahead * sr));
  const target = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(audio.left[i]), Math.abs(audio.right[i]));
    target[i] = p > ceiling ? ceiling / p : 1;
  }
  // Sliding minimum over [i, i + la] (monotonic deque).
  const minAhead = new Float32Array(n);
  const deque = new Int32Array(n + la + 1);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && target[deque[tail - 1]] >= target[i]) tail--;
    deque[tail++] = i;
    while (deque[head] > i + la) head++;
    minAhead[i] = target[deque[head]];
  }
  // Moving average of the look-ahead minimum: a smooth ramp that still lands on the target at the peak.
  const gain = new Float32Array(n);
  let sum = 0;
  const releaseCoef = 1 - Math.exp(-1 / (release * sr));
  let g = 1;
  let maxReduction = 1;
  let maxAt = 0;
  let limited = 0;
  for (let i = 0; i < n; i++) {
    sum += minAhead[i];
    if (i >= la) sum -= minAhead[i - la];
    // Every look-ahead window averaged here covers sample i, so the average never exceeds its target.
    const want = i >= la ? sum / la : (sum + (la - i - 1) * minAhead[0]) / la;
    g = want < g ? want : g + (want - g) * releaseCoef;
    gain[i] = g;
    if (g < maxReduction) {
      maxReduction = g;
      maxAt = i;
    }
    if (g < 0.891) limited++;
  }
  for (let i = 0; i < n; i++) {
    const l = audio.left[i] * gain[i];
    const r = audio.right[i] * gain[i];
    audio.left[i] = l > ceiling ? ceiling : l < -ceiling ? -ceiling : l;
    audio.right[i] = r > ceiling ? ceiling : r < -ceiling ? -ceiling : r;
  }
  return {
    gain,
    stats: { maxReductionDb: Math.min(0, db(maxReduction)), maxAt: maxAt / sr, limitedSeconds: limited / sr },
  };
}

export interface MixInput {
  sampleRate: number;
  /** Video length in seconds. */
  duration: number;
  /** The soundtrack's window for this video (sample 0 = video t 0) and its volume. */
  music: { audio: Stereo; volume: number } | null;
  cues: { cue: ResolvedCue; source: CueSource }[];
  /** Keep the music and effects buses and the limiter's gain curve (for check_audio). */
  keepBuses?: boolean;
}

export interface MixResult {
  /** Master: music + effects → limiter → end fade. */
  audio: Stereo;
  placements: Placement[];
  limiter: LimiterStats;
  music?: Stereo;
  sfx?: Stereo;
  gain?: Float32Array;
}

/** Music (with its volume) plus every cue, limited to −1 dBFS, with a short fade-in and the end fade. */
export function mix(input: MixInput): MixResult {
  const sr = input.sampleRate;
  const frames = Math.max(1, Math.round(input.duration * sr));
  const master = silence(sr, frames);
  let musicBus: Stereo | undefined;
  if (input.music) {
    const src = input.music.audio;
    const v = input.music.volume;
    const count = Math.min(frames, src.left.length);
    if (input.keepBuses) musicBus = silence(sr, frames);
    for (let i = 0; i < count; i++) {
      master.left[i] = src.left[i] * v;
      master.right[i] = src.right[i] * v;
    }
    if (musicBus) {
      musicBus.left.set(master.left);
      musicBus.right.set(master.right);
    }
  }
  const sfxBus = input.keepBuses ? silence(sr, frames) : undefined;
  const placements: Placement[] = [];
  for (const { cue, source } of input.cues) {
    const place = placeCue(cue, source);
    placements.push(place);
    renderCue(sfxBus ?? master, 0, place, source);
  }
  if (sfxBus) {
    for (let i = 0; i < frames; i++) {
      master.left[i] += sfxBus.left[i];
      master.right[i] += sfxBus.right[i];
    }
  }
  const { gain, stats } = limit(master);
  const fadeIn = Math.min(frames, Math.round(0.005 * sr));
  for (let i = 0; i < fadeIn; i++) {
    master.left[i] *= i / fadeIn;
    master.right[i] *= i / fadeIn;
  }
  const fadeFrom = Math.max(0, frames - Math.round(END_FADE * sr));
  for (let i = fadeFrom; i < frames; i++) {
    const f = (frames - i) / (frames - fadeFrom);
    master.left[i] *= f;
    master.right[i] *= f;
  }
  return {
    audio: master,
    placements,
    limiter: stats,
    ...(input.keepBuses ? { music: musicBus ?? silence(sr, frames), sfx: sfxBus, gain } : {}),
  };
}

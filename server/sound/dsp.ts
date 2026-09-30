// DSP building blocks for the sound-effects synthesizer (synth.ts). Everything here is deterministic:
// randomness comes from a seeded generator, so the same recipe always renders the same samples.

export const TAU = Math.PI * 2;

export interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

export function stereo(samples: number): Stereo {
  return { left: new Float32Array(samples), right: new Float32Array(samples) };
}

// ---------------------------------------------------------------------------
// Randomness

/** mulberry32: a tiny, fast, seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, for mixing names into seeds. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** 0 … 1 */
  float(): number {
    return this.next();
  }

  /** −1 … 1 */
  bipolar(): number {
    return this.next() * 2 - 1;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in min … max (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 1 ± amount: natural variation of a frequency or a level. */
  jitter(amount: number): number {
    return 1 + amount * this.bipolar();
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }
}

/** Pink noise from white (Paul Kellet's refined filter), roughly unit level. */
export class Pink {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  process(white: number): number {
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.969 * this.b2 + white * 0.153852;
    this.b3 = 0.8665 * this.b3 + white * 0.3104856;
    this.b4 = 0.55 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.016898;
    const out = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
    this.b6 = white * 0.115926;
    return out * 0.2;
  }
}

// ---------------------------------------------------------------------------
// Envelopes and shaping

/** 0 → 1 over `seconds` with a raised-cosine curve (click-free attack), then 1. */
export function rise(t: number, seconds: number): number {
  if (t <= 0) return 0;
  if (t >= seconds) return 1;
  const x = t / seconds;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

/** 1 → 0 between `from` and `to` with a raised-cosine curve. */
export function fall(t: number, from: number, to: number): number {
  if (t <= from) return 1;
  if (t >= to) return 0;
  const x = (t - from) / (to - from);
  return 0.5 + 0.5 * Math.cos(Math.PI * x);
}

/** Exponential decay with time constant tau (seconds); −60 dB after 6.9 tau. */
export function decay(t: number, tau: number): number {
  return t <= 0 ? 1 : Math.exp(-t / tau);
}

export function smoothstep(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Gentle tanh saturation, unity gain for small signals at drive 1. */
export function saturate(x: number, drive: number): number {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/** Equal-power pan gains for −1 (left) … 1 (right), normalized so the center is 1 / 1. */
export function panGains(pan: number): [number, number] {
  const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(angle) * Math.SQRT2, Math.sin(angle) * Math.SQRT2];
}

// ---------------------------------------------------------------------------
// Filters

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peak';

/** RBJ-cookbook biquad (transposed direct form II). Call `set` again to sweep it. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(
    private sampleRate: number,
    private type: FilterType,
    freq: number,
    q = Math.SQRT1_2,
    gainDb = 0,
  ) {
    this.set(freq, q, gainDb);
  }

  set(freq: number, q = Math.SQRT1_2, gainDb = 0) {
    const f = clamp(freq, 10, this.sampleRate * 0.45);
    const w0 = (TAU * f) / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(0.05, q));
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (this.type) {
      case 'lowpass':
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = (1 - cos) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = (1 + cos) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        // Constant 0 dB peak gain.
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case 'peak': {
        const A = 10 ** (gainDb / 40);
        b0 = 1 + alpha * A;
        b1 = -2 * cos;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos;
        a2 = 1 - alpha / A;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  run(buffer: Float32Array): Float32Array {
    for (let i = 0; i < buffer.length; i++) buffer[i] = this.process(buffer[i]);
    return buffer;
  }
}

/** One-pole lowpass; cheap smoothing and gentle tone control. */
export class OnePole {
  private y = 0;
  private a: number;

  constructor(sampleRate: number, freq: number) {
    this.a = 1 - Math.exp((-TAU * freq) / sampleRate);
  }

  process(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/** Two-pole resonator: rings at `freq` and falls 60 dB in `decay60` seconds. An impulse of 1 peaks near 1. */
export class Resonator {
  private c1: number;
  private c2: number;
  private g: number;
  private y1 = 0;
  private y2 = 0;

  constructor(sampleRate: number, freq: number, decay60: number) {
    const f = clamp(freq, 20, sampleRate * 0.45);
    const r = Math.exp(-6.908 / (Math.max(0.001, decay60) * sampleRate));
    const w = (TAU * f) / sampleRate;
    this.c1 = 2 * r * Math.cos(w);
    this.c2 = -r * r;
    this.g = Math.sin(w);
  }

  process(x: number): number {
    const y = this.g * x + this.c1 * this.y1 + this.c2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Remove DC and subsonic drift (one-pole highpass). */
export function dcBlock(buffer: Float32Array, sampleRate: number, cutoff = 12): Float32Array {
  const r = 1 - (TAU * cutoff) / sampleRate;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < buffer.length; i++) {
    const x = buffer[i];
    const y = x - x1 + r * y1;
    x1 = x;
    y1 = y;
    buffer[i] = y;
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Oscillators

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Phase-accumulating oscillator with band-limited saw and square (polyBLEP). */
export class Osc {
  constructor(
    private sampleRate: number,
    public phase = 0,
  ) {}

  private advance(freq: number): number {
    const dt = Math.min(0.49, Math.max(0, freq / this.sampleRate));
    this.phase += dt;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);
    return dt;
  }

  sine(freq: number): number {
    const v = Math.sin(TAU * this.phase);
    this.advance(freq);
    return v;
  }

  saw(freq: number): number {
    const dt = Math.min(0.49, Math.max(1e-6, freq / this.sampleRate));
    const v = 2 * this.phase - 1 - polyBlep(this.phase, dt);
    this.advance(freq);
    return v;
  }

  square(freq: number): number {
    const dt = Math.min(0.49, Math.max(1e-6, freq / this.sampleRate));
    let v = this.phase < 0.5 ? 1 : -1;
    v += polyBlep(this.phase, dt);
    v -= polyBlep((this.phase + 0.5) % 1, dt);
    this.advance(freq);
    return v;
  }
}

// ---------------------------------------------------------------------------
// Space: a Freeverb-style stereo reverb and a ping-pong echo

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

export interface ReverbOptions {
  /** 0 … 1: longer decay. */
  room: number;
  /** 0 … 1: high-frequency damping of the decay. */
  damp: number;
  /** 0 … 1: stereo width of the wet signal. */
  width?: number;
  /** Scales the delay lines: below 1 is a smaller, tighter space (default 1). */
  size?: number;
}

/** Seconds until the tail has fallen 60 dB (from the comb feedback). */
export function reverbTime(room: number, size = 1): number {
  const feedback = 0.7 + 0.28 * clamp(room, 0, 1);
  const meanDelay = (COMB_TUNING.reduce((s, x) => s + x, 0) / COMB_TUNING.length / 44100) * size;
  return meanDelay * (-3 / Math.log10(feedback));
}

function freeverbRaw(input: Stereo, sampleRate: number, opts: ReverbOptions): Stereo {
  const scale = (sampleRate / 44100) * clamp(opts.size ?? 1, 0.2, 2);
  const feedback = 0.7 + 0.28 * clamp(opts.room, 0, 1);
  const damp1 = 0.4 * clamp(opts.damp, 0, 1);
  const damp2 = 1 - damp1;
  const width = clamp(opts.width ?? 1, 0, 1);
  const wet1 = width / 2 + 0.5;
  const wet2 = (1 - width) / 2;
  const n = input.left.length;
  const out = stereo(n);
  const mono = new Float32Array(n);
  for (let s = 0; s < n; s++) mono[s] = (input.left[s] + input.right[s]) * 0.015;
  const channel = (spread: number, target: Float32Array) => {
    const combs = COMB_TUNING.map((len) => new Float32Array(Math.round((len + spread) * scale)));
    const combIndex = new Int32Array(combs.length);
    const combStore = new Float64Array(combs.length);
    const allpasses = ALLPASS_TUNING.map((len) => new Float32Array(Math.round((len + spread) * scale)));
    const allpassIndex = new Int32Array(allpasses.length);
    for (let s = 0; s < n; s++) {
      const x = mono[s];
      let acc = 0;
      for (let k = 0; k < combs.length; k++) {
        const buf = combs[k];
        const i = combIndex[k];
        const y = buf[i];
        const store = y * damp2 + combStore[k] * damp1;
        combStore[k] = store;
        buf[i] = x + store * feedback;
        combIndex[k] = i + 1 >= buf.length ? 0 : i + 1;
        acc += y;
      }
      for (let k = 0; k < allpasses.length; k++) {
        const buf = allpasses[k];
        const i = allpassIndex[k];
        const b = buf[i];
        buf[i] = acc + b * 0.5;
        allpassIndex[k] = i + 1 >= buf.length ? 0 : i + 1;
        acc = b - acc;
      }
      target[s] = acc;
    }
  };
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  channel(0, l);
  channel(STEREO_SPREAD, r);
  for (let s = 0; s < n; s++) {
    out.left[s] = l[s] * wet1 + r[s] * wet2;
    out.right[s] = r[s] * wet1 + l[s] * wet2;
  }
  return out;
}

const irEnergy = new Map<string, number>();

/** Energy of the reverb's impulse response, so wet levels mean the same thing for every room. */
function reverbEnergy(sampleRate: number, opts: ReverbOptions): number {
  const key = [sampleRate, opts.room, opts.damp, opts.width ?? 1, opts.size ?? 1].map((v) => v.toFixed(3)).join('|');
  const cached = irEnergy.get(key);
  if (cached !== undefined) return cached;
  const n = Math.ceil(Math.min(8, reverbTime(opts.room, opts.size) * 1.2 + 0.1) * sampleRate);
  const impulse = stereo(n);
  impulse.left[0] = 1;
  impulse.right[0] = 1;
  const ir = freeverbRaw(impulse, sampleRate, opts);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ir.left[i] * ir.left[i] + ir.right[i] * ir.right[i];
  // The dry impulse (1 in each channel) has energy 2.
  const energy = Math.max(1e-12, sum / 2);
  irEnergy.set(key, energy);
  return energy;
}

/**
 * Wet signal only, scaled so `level` 1 carries about as much energy as the dry input.
 * Pad the input with enough silence for the tail first (reverbTime).
 */
export function reverb(input: Stereo, sampleRate: number, opts: ReverbOptions & { level: number; predelay?: number }): Stereo {
  const wet = freeverbRaw(input, sampleRate, opts);
  const gain = opts.level / Math.sqrt(reverbEnergy(sampleRate, opts));
  const delay = Math.max(0, Math.round((opts.predelay ?? 0) * sampleRate));
  const n = input.left.length;
  const out = stereo(n);
  for (let i = n - 1; i >= delay; i--) {
    out.left[i] = wet.left[i - delay] * gain;
    out.right[i] = wet.right[i - delay] * gain;
  }
  return out;
}

/** Add filtered ping-pong echoes of `input` into itself (pad the input first). */
export function pingPong(
  input: Stereo,
  sampleRate: number,
  opts: { delayLeft: number; delayRight: number; feedback: number; lowpass: number; level: number },
) {
  const n = input.left.length;
  const dl = Math.max(1, Math.round(opts.delayLeft * sampleRate));
  const dr = Math.max(1, Math.round(opts.delayRight * sampleRate));
  const bufL = new Float32Array(dl);
  const bufR = new Float32Array(dr);
  const lpL = new OnePole(sampleRate, opts.lowpass);
  const lpR = new OnePole(sampleRate, opts.lowpass);
  let iL = 0;
  let iR = 0;
  for (let s = 0; s < n; s++) {
    const outL = bufL[iL];
    const outR = bufR[iR];
    const mono = (input.left[s] + input.right[s]) * 0.5;
    // Left repeats feed the right line and vice versa.
    bufL[iL] = lpL.process(mono + outR * opts.feedback);
    bufR[iR] = lpR.process(outL * opts.feedback);
    if (++iL >= dl) iL = 0;
    if (++iR >= dr) iR = 0;
    input.left[s] += outL * opts.level;
    input.right[s] += outR * opts.level;
  }
}

// ---------------------------------------------------------------------------
// Buffer helpers

/** Add a mono signal into a stereo buffer at `offset` samples with per-channel gains. */
export function addMono(out: Stereo, src: Float32Array, offset: number, gainLeft = 1, gainRight = gainLeft) {
  const start = Math.max(0, offset);
  const end = Math.min(out.left.length, offset + src.length);
  for (let i = start; i < end; i++) {
    const v = src[i - offset];
    out.left[i] += v * gainLeft;
    out.right[i] += v * gainRight;
  }
}

/** A copy of `audio` with `extra` samples of silence appended (room for tails and echoes). */
export function padded(audio: Stereo, extra: number): Stereo {
  const out = stereo(audio.left.length + Math.max(0, Math.round(extra)));
  out.left.set(audio.left);
  out.right.set(audio.right);
  return out;
}

export function reversed(audio: Stereo): Stereo {
  const n = audio.left.length;
  const out = stereo(n);
  for (let i = 0; i < n; i++) {
    out.left[i] = audio.left[n - 1 - i];
    out.right[i] = audio.right[n - 1 - i];
  }
  return out;
}

export function peakOf(audio: Stereo): { value: number; index: number } {
  let value = 0;
  let index = 0;
  for (let i = 0; i < audio.left.length; i++) {
    const v = Math.max(Math.abs(audio.left[i]), Math.abs(audio.right[i]));
    if (v > value) {
      value = v;
      index = i;
    }
  }
  return { value, index };
}

/** RMS of the loudest `window`-sample stretch (both channels), sliding in steps of window / 10. */
export function loudestRms(audio: Stereo, window: number): number {
  const n = audio.left.length;
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + audio.left[i] * audio.left[i] + audio.right[i] * audio.right[i];
  if (n <= window) return Math.sqrt(sq[n] / (2 * window));
  const step = Math.max(1, Math.floor(window / 10));
  let best = 0;
  for (let start = 0; start + window <= n; start += step) best = Math.max(best, sq[start + window] - sq[start]);
  best = Math.max(best, sq[n] - sq[n - window]);
  return Math.sqrt(best / (2 * window));
}

function biquadRaw(src: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const out = new Float32Array(src.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

/** ITU-R BS.1770 K-weighting at 48 kHz, plus a 100 Hz low cut: roughly how loud a sound feels on real speakers. */
function perceptual(src: Float32Array, sampleRate: number): Float32Array {
  const shelf = biquadRaw(src, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
  const rlb = biquadRaw(shelf, 1, -2, 1, -1.99004745483398, 0.99007225036621);
  return new Biquad(sampleRate, 'highpass', 100, Math.SQRT1_2).run(rlb);
}

/** Loudest `window`-sample stretch of the perceptually weighted signal (RMS, both channels). Expects 48 kHz. */
export function loudness(audio: Stereo, sampleRate: number, window: number): number {
  return loudestRms({ left: perceptual(audio.left, sampleRate), right: perceptual(audio.right, sampleRate) }, window);
}

export function scale(audio: Stereo, gain: number) {
  for (let i = 0; i < audio.left.length; i++) {
    audio.left[i] *= gain;
    audio.right[i] *= gain;
  }
}

/** Raised-cosine fade over the first `samples` samples. */
export function fadeIn(audio: Stereo, samples: number) {
  const n = Math.min(audio.left.length, Math.max(1, Math.round(samples)));
  for (let i = 0; i < n; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
    audio.left[i] *= g;
    audio.right[i] *= g;
  }
}

/** Raised-cosine fade over the last `samples` samples. */
export function fadeOut(audio: Stereo, samples: number) {
  const total = audio.left.length;
  const n = Math.min(total, Math.max(1, Math.round(samples)));
  for (let i = 0; i < n; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / n);
    audio.left[total - n + i] *= g;
    audio.right[total - n + i] *= g;
  }
}

/** Cut samples [start, end). */
export function slice(audio: Stereo, start: number, end: number): Stereo {
  return { left: audio.left.slice(start, end), right: audio.right.slice(start, end) };
}

/** Index of the last sample louder than `threshold` (absolute), or -1. */
export function lastAbove(audio: Stereo, threshold: number): number {
  for (let i = audio.left.length - 1; i >= 0; i--) {
    if (Math.abs(audio.left[i]) > threshold || Math.abs(audio.right[i]) > threshold) return i;
  }
  return -1;
}

/** Index of the first sample louder than `threshold` (absolute), or -1. */
export function firstAbove(audio: Stereo, threshold: number): number {
  for (let i = 0; i < audio.left.length; i++) {
    if (Math.abs(audio.left[i]) > threshold || Math.abs(audio.right[i]) > threshold) return i;
  }
  return -1;
}

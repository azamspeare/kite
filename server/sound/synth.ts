// Procedural sound effects for motion design: 22 presets with a few musical knobs.
// Deterministic: the same preset and parameters always render the same samples.

import {
  Biquad,
  Osc,
  Pink,
  Resonator,
  Rng,
  TAU,
  addMono,
  clamp,
  dcBlock,
  decay,
  fadeIn,
  fadeOut,
  fall,
  firstAbove,
  hashString,
  lastAbove,
  loudness,
  padded,
  panGains,
  peakOf,
  pingPong,
  reverb,
  reverbTime,
  reversed,
  rise,
  saturate,
  scale,
  slice,
  smoothstep,
  stereo,
  type FilterType,
  type Stereo,
} from './dsp';

export const SYNTH_SAMPLE_RATE = 48000;
/** Bump when any preset's output changes, so cached renders are redone. */
export const SYNTH_VERSION = 1;

export const PRESET_NAMES = [
  'click',
  'tap',
  'tick',
  'toggle',
  'keystroke',
  'enter',
  'pop',
  'blip',
  'ping',
  'ding',
  'chime',
  'error',
  'whoosh',
  'swish',
  'riser',
  'reverse',
  'impact',
  'thud',
  'sub-drop',
  'glitch',
  'sparkle',
  'shutter',
] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export interface SynthParams {
  /** Semitones, −24 … 24 (default 0). */
  pitch?: number;
  /** Seconds of the main body (each preset has its own range); a tail may ring on after it. */
  length?: number;
  /** 0 … 1 (default 0.5): filter cutoffs, harmonics, click level. */
  brightness?: number;
  /** 0 … 1 (default 0.5): low-end body, thump, sub. */
  weight?: number;
  /** 0 … 1: room, reverb and ring-out (default per preset). */
  tail?: number;
  /** −1 … 1: stereo travel for whoosh, swish, riser and reverse (1 = left → right). Default 0. */
  motion?: number;
  /** Changes the small random details, so variants of the same sound differ naturally. Default 1. */
  seed?: number;
}

export interface PresetInfo {
  name: PresetName;
  description: string;
  length: { default: number; min: number; max: number };
}

export interface StereoAudio {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

const SR = SYNTH_SAMPLE_RATE;
/** Loudest 50 ms window lands at −16 dB RMS (perceptually weighted), unless that would push the peak past −1 dBFS. */
const TARGET_RMS = 10 ** (-16 / 20);
const CEILING = 0.891;

interface Ctx {
  p: Required<SynthParams>;
  rng: Rng;
  /** Pitch as a frequency ratio. */
  pf: number;
}

/** How `tail` maps onto the reverb for a preset. */
interface Space {
  /** Room size at tail 0 and tail 1. */
  room: [number, number];
  damp: number;
  /** Wet level at tail 1 (1 ≈ as much energy as the dry sound). */
  level: number;
  predelay: number;
  /** Keep lows out of the reverb. */
  highpass: number;
  /** Delay-line scale: below 1 is a smaller, tighter room. */
  size?: number;
}

interface PresetDef {
  description: string;
  length: { default: number; min: number; max: number };
  /** Default for the tail knob. */
  tail: number;
  space: Space;
  render: (ctx: Ctx) => Stereo;
  /** The preset applies its own space (reverse reverbs before it flips). */
  ownSpace?: boolean;
  /** DC-blocker corner; lower for sub-heavy sounds. */
  lowCut?: number;
}

// ---------------------------------------------------------------------------
// Helpers

/** Samples for a duration (at least 1). */
const n = (seconds: number) => Math.max(1, Math.ceil(seconds * SR));
/** Sample offset of a time. */
const at = (seconds: number) => Math.max(0, Math.round(seconds * SR));

/** A short noise burst: a contact, a click, the excitation of a resonant body. */
function burst(rng: Rng, tau: number, attack = 0.00015, seconds = tau * 8 + attack): Float32Array {
  const out = new Float32Array(n(seconds));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = rng.bipolar() * rise(t, attack) * decay(t, tau);
  }
  return out;
}

function filtered(src: Float32Array, type: FilterType, freq: number, q?: number): Float32Array {
  return new Biquad(SR, type, freq, q).run(src.slice());
}

function scaled(src: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] * gain;
  return out;
}

/**
 * A strike to ring resonant modes with: a smooth pulse (the same spectrum every time, so the modes keep their
 * balance) plus a little noise for texture. Shorter pulses excite higher modes.
 */
function strike(rng: Rng, width: number, noise = 0.3, tau = width * 1.5): Float32Array {
  const pulse = n(width);
  const area = pulse / 2;
  const out = new Float32Array(n(width + tau * 8));
  for (let i = 0; i < out.length; i++) {
    const shape = i < pulse ? Math.sin((Math.PI * i) / pulse) ** 2 : 0;
    out[i] = (shape + noise * rng.bipolar() * decay(i / SR, tau)) / area;
  }
  return out;
}

/** Ring a set of resonant modes with an excitation (modal synthesis of small hard objects). */
function modes(excitation: Float32Array, list: { freq: number; decay: number; level: number }[], seconds: number): Float32Array {
  const out = new Float32Array(n(seconds));
  for (const mode of list) {
    if (mode.level <= 0) continue;
    const r = new Resonator(SR, mode.freq, mode.decay);
    for (let i = 0; i < out.length; i++) out[i] += r.process(i < excitation.length ? excitation[i] : 0) * mode.level;
  }
  return out;
}

/** Normalize to peak 1, then saturate: the same warmth whatever the raw level of the layers. */
function drive(audio: Stereo, amount: number): Stereo {
  const peak = peakOf(audio).value;
  if (peak < 1e-12) return audio;
  for (let i = 0; i < audio.left.length; i++) {
    audio.left[i] = saturate(audio.left[i] / peak, amount);
    audio.right[i] = saturate(audio.right[i] / peak, amount);
  }
  return audio;
}

/** Stereo travel from −motion to +motion across the whole buffer (equal power). */
function travel(audio: Stereo, motion: number) {
  if (Math.abs(motion) < 1e-3) return;
  const total = audio.left.length;
  for (let i = 0; i < total; i++) {
    const [gl, gr] = panGains(motion * ((2 * i) / Math.max(1, total - 1) - 1));
    audio.left[i] *= gl;
    audio.right[i] *= gr;
  }
}

function withSpace(dry: Stereo, tail: number, space: Space): Stereo {
  if (tail < 0.005) return dry;
  const room = Math.round((space.room[0] + (space.room[1] - space.room[0]) * tail) * 100) / 100;
  const size = space.size ?? 1;
  const out = padded(dry, (Math.min(6, reverbTime(room, size) * 1.1) + space.predelay) * SR);
  const send = { left: out.left.slice(), right: out.right.slice() };
  new Biquad(SR, 'highpass', space.highpass, 0.6).run(send.left);
  new Biquad(SR, 'highpass', space.highpass, 0.6).run(send.right);
  const wet = reverb(send, SR, { room, size, damp: space.damp, width: 1, level: space.level * tail, predelay: space.predelay });
  for (let i = 0; i < out.left.length; i++) {
    out.left[i] += wet.left[i];
    out.right[i] += wet.right[i];
  }
  return out;
}

/** Trim the silent end, de-click both ends and set the level. */
function finalize(audio: Stereo): Stereo {
  for (let i = 0; i < audio.left.length; i++) {
    if (!Number.isFinite(audio.left[i])) audio.left[i] = 0;
    if (!Number.isFinite(audio.right[i])) audio.right[i] = 0;
  }
  const peak = peakOf(audio).value;
  if (peak < 1e-9) return stereo(at(0.01));
  const last = lastAbove(audio, peak * 1e-3);
  const out = slice(audio, 0, Math.min(audio.left.length, last + 1 + at(0.004)));
  if (Math.max(Math.abs(out.left[0]), Math.abs(out.right[0])) > peak * 1e-3) fadeIn(out, at(0.001));
  fadeOut(out, Math.min(at(0.006), Math.floor(out.left.length * 0.1)));
  const gain = Math.min(TARGET_RMS / Math.max(1e-9, loudness(out, SR, at(0.05))), CEILING / peakOf(out).value);
  scale(out, gain);
  return out;
}

// ---------------------------------------------------------------------------
// Spaces

const SMALL_ROOM: Space = { room: [0.2, 0.7], damp: 0.5, level: 0.55, predelay: 0.004, highpass: 250, size: 0.5 };
const HALL: Space = { room: [0.5, 0.88], damp: 0.35, level: 0.6, predelay: 0.012, highpass: 300 };
const AIR: Space = { room: [0.4, 0.85], damp: 0.45, level: 0.45, predelay: 0.008, highpass: 200 };

// ---------------------------------------------------------------------------
// Presets: clicks and keys

function click({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.004);
  const out = stereo(total);
  const bp = new Biquad(SR, 'bandpass', (2600 + 4400 * b) * pf, 1.1);
  const hp = new Biquad(SR, 'highpass', 900 * pf, 0.7);
  const tick = new Osc(SR);
  const body = new Osc(SR);
  const fTick = (1700 + 1500 * b) * pf * rng.jitter(0.02);
  const tauNoise = 0.0007 + len * 0.02;
  const tauTick = len * 0.2;
  const tauBody = 0.003 + len * 0.1;
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const noise = hp.process(bp.process(rng.bipolar())) * rise(t, 0.00012) * decay(t, tauNoise);
    const tone = tick.sine(fTick) * rise(t, 0.0003) * decay(t, tauTick);
    const thump = body.sine((170 + 150 * decay(t, 0.004)) * pf) * rise(t, 0.0006) * decay(t, tauBody);
    const v = noise * (2.2 + 1.2 * b) + tone * (0.3 + 0.3 * b) + thump * (0.1 + 0.6 * w);
    out.left[i] = v;
    out.right[i] = v;
  }
  return drive(out, 1.3);
}

function tap({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.01);
  const out = stereo(total);
  const thumpOsc = new Osc(SR);
  const lp = new Biquad(SR, 'lowpass', (1200 + 3500 * b) * pf, 0.7);
  const f1 = 2750 * pf * rng.jitter(0.03);
  const f2 = 4100 * pf * rng.jitter(0.03);
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const thump = thumpOsc.sine((230 + 200 * decay(t, 0.006)) * pf) * rise(t, 0.0015) * decay(t, len * 0.3) * (0.7 + 0.5 * w);
    const contact = lp.process(rng.bipolar()) * rise(t, 0.0002) * decay(t, 0.0025) * (0.5 + 0.5 * b) * 2.5;
    const glass =
      (Math.sin(TAU * f1 * t) + 0.6 * Math.sin(TAU * f2 * t)) * rise(t, 0.0005) * decay(t, len * 0.35) * (0.04 + 0.1 * b);
    const v = thump + contact + glass;
    out.left[i] = v;
    out.right[i] = v;
  }
  return drive(out, 1.2);
}

function tick({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const out = stereo(n(len + 0.01));
  const f1 = 1500 * pf * rng.jitter(0.02);
  const ring = modes(
    strike(rng, 0.0003),
    [
      { freq: f1, decay: len * 1.4, level: 1 },
      { freq: f1 * 2.61, decay: len * 0.7, level: 0.5 * (0.4 + b) },
      { freq: f1 * 4.13, decay: len * 0.35, level: 0.3 * b },
      { freq: f1 * 0.52, decay: len * 1.2, level: 0.35 * w },
    ],
    len + 0.01,
  );
  addMono(out, ring, 0);
  addMono(out, scaled(filtered(burst(rng, 0.0004, 0.0001), 'bandpass', 5000 * pf, 1), 0.5 * b), 0);
  return drive(out, 1.2);
}

function toggle({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const gap = clamp(len * 0.45, 0.018, 0.13);
  const out = stereo(n(len + 0.03));
  const voice = (ratio: number, level: number, start: number) => {
    const ring = modes(
      strike(rng, 0.0003),
      [
        { freq: 1900 * pf * ratio * rng.jitter(0.03), decay: 0.03, level: 1 },
        { freq: 3700 * pf * ratio * rng.jitter(0.03), decay: 0.015, level: 0.5 * (0.4 + b) },
        { freq: 5400 * pf * ratio * rng.jitter(0.03), decay: 0.008, level: 0.35 * b },
        { freq: 380 * pf * ratio * rng.jitter(0.03), decay: 0.02, level: 0.4 * w },
      ],
      0.05,
    );
    addMono(out, scaled(ring, level), at(start));
    const click = filtered(burst(rng, 0.0005, 0.0001), 'bandpass', 4500 * pf * ratio, 1.2);
    addMono(out, scaled(click, level * (0.4 + 0.6 * b)), at(start));
  };
  voice(0.88, 1, 0);
  voice(1.12, 0.75, gap);
  // A faint spring between the two clicks.
  const spring = new Float32Array(n(gap));
  const bp = new Biquad(SR, 'bandpass', 8000 * Math.min(pf, 2), 2);
  for (let i = 0; i < spring.length; i++) spring[i] = bp.process(rng.bipolar()) * 0.03 * Math.sin((Math.PI * i) / spring.length);
  addMono(out, spring, at(0.002));
  return drive(out, 1.2);
}

function keystroke({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const out = stereo(n(len + 0.03));
  // The switch clicks as it actuates…
  const click = filtered(burst(rng, 0.0006, 0.0001), 'bandpass', (4200 + 2600 * b) * pf * rng.jitter(0.05), 1.4);
  addMono(out, scaled(click, 0.9 + 1.3 * b), 0);
  // …then the keycap bottoms out and the plate rings.
  const t0 = at(0.004 + rng.range(0, 0.0035));
  const ring = modes(
    strike(rng, 0.00025),
    [
      { freq: 380 * pf * rng.jitter(0.08), decay: 0.04 + len * 0.15, level: 0.3 + 0.4 * w },
      { freq: 1750 * pf * rng.jitter(0.08), decay: 0.03, level: 0.75 },
      { freq: 3100 * pf * rng.jitter(0.08), decay: 0.014, level: 0.5 * (0.3 + b) },
      { freq: 140 * pf * rng.jitter(0.06), decay: 0.03, level: 0.25 * w },
    ],
    len,
  );
  addMono(out, ring, t0);
  // The plastic contact itself.
  addMono(out, scaled(filtered(burst(rng, 0.0008, 0.0002), 'highpass', 1200 * pf, 0.7), 0.35), t0);
  // A faint release click when the key comes back up.
  const tr = at(len * 0.62 * rng.jitter(0.1));
  addMono(out, scaled(filtered(burst(rng, 0.0005, 0.0001), 'bandpass', 3500 * pf * rng.jitter(0.1), 1.2), 0.18), tr);
  addMono(out, modes(strike(rng, 0.0003), [{ freq: 1840 * pf * rng.jitter(0.05), decay: 0.015, level: 0.15 }], 0.03), tr);
  return drive(out, 1.4);
}

function enter({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const out = stereo(n(len + 0.05));
  const click = filtered(burst(rng, 0.0007, 0.0001), 'bandpass', (3200 + 2000 * b) * pf * rng.jitter(0.05), 1.3);
  addMono(out, scaled(click, 0.8 + 1.1 * b), 0);
  // A bigger keycap bottoming out: deeper, but still a clack rather than a drum.
  const t0 = 0.006 + rng.range(0, 0.004);
  const ring = modes(
    strike(rng, 0.0006),
    [
      { freq: 240 * pf * rng.jitter(0.06), decay: 0.04 + len * 0.1, level: 0.4 + 0.3 * w },
      { freq: 820 * pf * rng.jitter(0.06), decay: 0.035, level: 0.6 },
      { freq: 1600 * pf * rng.jitter(0.06), decay: 0.022, level: 0.45 },
      { freq: 2700 * pf * rng.jitter(0.06), decay: 0.012, level: 0.35 * (0.3 + b) },
      { freq: 110 * pf * rng.jitter(0.05), decay: 0.035, level: 0.2 * w },
    ],
    len + 0.04,
  );
  addMono(out, ring, at(t0));
  addMono(out, scaled(filtered(burst(rng, 0.0012, 0.0002), 'highpass', 900 * pf, 0.7), 0.4), at(t0));
  // The stabilizer wire rattles.
  let rattle = t0 + 0.004;
  const count = 3 + rng.int(0, 2);
  for (let k = 0; k < count; k++) {
    rattle += rng.range(0.003, 0.007);
    const r = filtered(burst(rng, 0.0004, 0.0001), 'bandpass', 2800 * pf * rng.jitter(0.15), 3);
    addMono(out, scaled(r, 0.5 * 0.6 ** k), at(rattle));
  }
  // Release.
  const tr = at(len * 0.68 * rng.jitter(0.08));
  addMono(out, scaled(filtered(burst(rng, 0.0006, 0.0001), 'bandpass', 3000 * pf, 1.2), 0.25), tr);
  const release = [
    { freq: 260 * pf * rng.jitter(0.05), decay: 0.03, level: 0.2 },
    { freq: 900 * pf * rng.jitter(0.05), decay: 0.02, level: 0.2 },
  ];
  addMono(out, modes(strike(rng, 0.0005), release, 0.05), tr);
  return drive(out, 1.5);
}

function shutter({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const out = stereo(n(len + 0.05));
  const second = len * 0.55;
  const clack = (start: number, ratio: number, level: number) => {
    const ring = modes(
      strike(rng, 0.0008, 0.5),
      [
        { freq: 1100 * pf * ratio * rng.jitter(0.05), decay: 0.02, level: 0.5 },
        { freq: 2900 * pf * ratio * rng.jitter(0.05), decay: 0.012, level: 0.4 },
        { freq: 4400 * pf * ratio * rng.jitter(0.05), decay: 0.007, level: 0.25 * (0.4 + b) },
        { freq: 210 * pf * rng.jitter(0.05), decay: 0.03, level: 0.4 * w },
      ],
      0.06,
    );
    addMono(out, scaled(filtered(burst(rng, 0.0025, 0.0002), 'bandpass', 2500 * pf * ratio, 0.9), 1.2 * level), at(start));
    addMono(out, scaled(ring, level), at(start));
  };
  clack(0, 1, 1);
  // The blades moving between the two clacks.
  const whirr = new Float32Array(n(Math.max(0.001, second - 0.008)));
  const bp = new Biquad(SR, 'bandpass', 5200 * Math.min(pf, 2), 2);
  for (let i = 0; i < whirr.length; i++) whirr[i] = bp.process(rng.bipolar()) * 0.04 * Math.sin((Math.PI * i) / whirr.length);
  addMono(out, whirr, at(0.008));
  clack(second, 1.08, 0.8);
  return drive(out, 1.3);
}

// ---------------------------------------------------------------------------
// Presets: tones

function pop({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.01);
  const out = stereo(total);
  const f0 = 520 * pf * rng.jitter(0.03);
  const tau = len * 0.28;
  let phase = 0;
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    // A bubble's pitch glides up as it closes.
    const f = f0 * (1 + 0.9 * (1 - decay(t, 0.012)));
    const env = rise(t, 0.001) * decay(t, tau);
    const tone = Math.sin(TAU * phase) + 0.18 * b * Math.sin(2 * TAU * phase);
    const sub = Math.sin(TAU * phase * 0.5) * 0.35 * w * decay(t, tau * 0.7);
    phase += f / SR;
    const v = (tone + sub) * env;
    out.left[i] = v;
    out.right[i] = v;
  }
  addMono(out, scaled(filtered(burst(rng, 0.0004, 0.0001), 'highpass', 2000 * pf, 0.7), 0.12 + 0.2 * b), 0);
  return drive(out, 1.2);
}

function blip({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.002);
  const out = stereo(total);
  const f = 1046.5 * pf * rng.jitter(0.005);
  const sine = new Osc(SR);
  const square = new Osc(SR);
  const sub = new Osc(SR);
  const lp = new Biquad(SR, 'lowpass', Math.min(18000, (2500 + 9000 * b) * Math.max(1, pf)), 0.7);
  const release = Math.min(0.012, len * 0.3);
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const fi = f * (1 + 0.03 * decay(t, 0.004));
    const env = rise(t, 0.0015) * fall(t, len - release, len) * (0.8 + 0.2 * decay(t, len));
    const tone = (1 - b) * sine.sine(fi) + b * 0.55 * square.square(fi);
    const v = (lp.process(tone) + sub.sine(fi / 2) * 0.3 * w) * env;
    out.left[i] = v;
    out.right[i] = v;
  }
  return out;
}

function ping({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const f1 = 1250 * pf * rng.jitter(0.01);
  const body = n(len + 0.02);
  const dry = stereo(body);
  const tau = len / 6.908;
  const partials = [
    { ratio: 1, level: 1, tau },
    { ratio: 2, level: 0.08 * b, tau: tau * 0.5 },
    { ratio: 2.76, level: 0.28 * (0.3 + b), tau: tau * 0.3 },
    { ratio: 5.4, level: 0.1 * b, tau: tau * 0.15 },
  ];
  for (let i = 0; i < body; i++) {
    const t = i / SR;
    let v = 0;
    for (const q of partials) v += Math.sin(TAU * f1 * q.ratio * t) * q.level * decay(t, q.tau);
    v += Math.sin(TAU * 160 * pf * t) * 0.25 * w * decay(t, 0.05);
    v *= rise(t, 0.002);
    dry.left[i] = v;
    dry.right[i] = v;
  }
  addMono(dry, scaled(filtered(burst(rng, 0.0005, 0.0001), 'bandpass', 4000 * pf, 1), 0.08), 0);
  // Sonar echoes bounce left and right.
  const out = padded(dry, 1.9 * SR);
  pingPong(out, SR, { delayLeft: 0.21, delayRight: 0.21, feedback: 0.42, lowpass: 3000, level: 0.25 + 0.35 * p.tail });
  return out;
}

function ding({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.02);
  const out = stereo(total);
  const fc = 880 * pf * rng.jitter(0.005);
  // FM with an inharmonic ratio: a struck bell. Keep the sidebands below Nyquist at high pitches.
  const ratio = 3.5;
  const index0 = (1.5 + 3.5 * b) * clamp(3000 / fc, 0.25, 1);
  const tauA = len / 6.908;
  const tauI = len * 0.12;
  const detune = 1.0025;
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const index = index0 * decay(t, tauI);
    const env = rise(t, 0.0015) * decay(t, tauA);
    const hum = Math.sin(TAU * fc * 0.5 * t) * 0.2 * w * decay(t, tauA * 1.2);
    const l = Math.sin(TAU * fc * t + index * Math.sin(TAU * fc * ratio * t));
    const r = Math.sin(TAU * fc * detune * t + index * Math.sin(TAU * fc * detune * ratio * t));
    out.left[i] = (0.8 * l + 0.2 * r + hum) * env;
    out.right[i] = (0.2 * l + 0.8 * r + hum) * env;
  }
  addMono(out, scaled(filtered(burst(rng, 0.0008, 0.0001), 'bandpass', 5000 * pf, 1), 0.1 * b), 0);
  return out;
}

function chime({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.02);
  const out = stereo(total);
  const steps = len >= 0.6 ? [0, 4, 7] : [0, 7];
  const spacing = clamp(len * 0.09, 0.055, 0.11);
  const base = 1046.5 * pf;
  let onset = 0;
  steps.forEach((step, k) => {
    if (k > 0) onset += spacing * rng.jitter(0.06);
    const f = base * 2 ** (step / 12);
    const start = at(onset);
    const tau = Math.max(0.1, len - onset) / 6.908;
    const index0 = (0.6 + 1.6 * b) * clamp(3000 / f, 0.25, 1);
    const [gl, gr] = panGains((k - (steps.length - 1) / 2) * 0.3);
    const level = k === 0 ? 1 : 0.9;
    for (let i = start; i < total; i++) {
      const t = (i - start) / SR;
      const index = index0 * decay(t, 0.08);
      let v = Math.sin(TAU * f * t + index * Math.sin(TAU * f * 2 * t)) * rise(t, 0.001) * decay(t, tau) * level;
      if (k === 0) v += Math.sin(TAU * f * 0.5 * t) * 0.2 * w * rise(t, 0.002) * decay(t, tau);
      out.left[i] += v * gl;
      out.right[i] += v * gr;
    }
  });
  return out;
}

function error({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.01);
  const out = stereo(total);
  const dur = len * 0.42;
  const gap = len * 0.1;
  const detune = 2 ** (7 / 1200);
  [311.13, 233.08].forEach((base, k) => {
    const f = base * pf;
    const start = at(k * (dur + gap));
    const a = new Osc(SR, rng.float());
    const c = new Osc(SR, rng.float());
    const sq = new Osc(SR);
    const sub = new Osc(SR);
    const lp = new Biquad(SR, 'lowpass', (900 + 2600 * b) * Math.min(pf, 2), 0.9);
    const count = n(dur);
    for (let j = 0; j < count && start + j < total; j++) {
      const t = j / SR;
      const fi = f * (1 - (0.03 * t) / dur);
      const saws = 0.5 * (a.saw(fi / detune) + c.saw(fi * detune));
      const tone = saws * (1 - 0.4 * b) + sq.square(fi) * 0.4 * b;
      const env = rise(t, 0.003) * fall(t, dur - 0.025, dur);
      const v = saturate(lp.process(tone) + sub.sine(fi / 2) * 0.35 * w, 1.6) * env * (k === 0 ? 1 : 0.95);
      out.left[start + j] += v;
      out.right[start + j] += v;
    }
  });
  return out;
}

function sparkle({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.3);
  const out = stereo(total);
  // Major pentatonic from C7 up: always consonant, however the grains land.
  const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  const count = Math.round(10 + 16 * len);
  for (let k = 0; k < count; k++) {
    const onset = len * 0.75 * rng.float() ** 1.6;
    const f = Math.min(16000, 2093 * pf * 2 ** (rng.pick(steps) / 12));
    const amp = (0.25 + 0.75 * rng.float()) * (1 - onset / len) ** 0.7;
    const tau = rng.range(0.03, 0.11);
    const [gl, gr] = panGains(rng.bipolar() * 0.8);
    const grain = new Float32Array(n(tau * 7));
    for (let i = 0; i < grain.length; i++) {
      const t = i / SR;
      grain[i] = (Math.sin(TAU * f * t) + 0.2 * b * Math.sin(TAU * f * 2.01 * t)) * rise(t, 0.0015) * decay(t, tau) * amp * 0.5;
    }
    addMono(out, grain, at(onset), gl, gr);
  }
  // A breath of air under the grains.
  const hpL = new Biquad(SR, 'highpass', 6000 * Math.min(pf, 2), 0.7);
  const hpR = new Biquad(SR, 'highpass', 6000 * Math.min(pf, 2), 0.7);
  const bed = 0.06 + 0.1 * b;
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const env = rise(t, len * 0.15) * decay(t - len * 0.15, len * 0.3);
    out.left[i] += hpL.process(rng.bipolar()) * env * bed;
    out.right[i] += hpR.process(rng.bipolar()) * env * bed;
  }
  if (w > 0) {
    const low = new Float32Array(n(0.25 * 7));
    for (let i = 0; i < low.length; i++) {
      const t = i / SR;
      low[i] = Math.sin(TAU * 1046.5 * pf * t) * rise(t, 0.002) * decay(t, 0.25) * 0.25 * w;
    }
    addMono(out, low, 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Presets: air and builds

interface AirShape {
  /** Where the envelope peaks (0 … 1 of the length). */
  peak: number;
  fmin: number;
  fmax: number;
  q: number;
  whistle: number;
  rumble: number;
  /** Correlation between the channels' noise (1 = mono). */
  correlation: number;
  /** Curve of the build-up. */
  rise: number;
}

/** Band-passed noise whose band opens as it gets louder: something rushing past. */
function air({ p, rng, pf }: Ctx, o: AirShape): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len);
  const out = stereo(total);
  const pinkL = new Pink();
  const pinkR = new Pink();
  const bpL = new Biquad(SR, 'bandpass', o.fmin, o.q);
  const bpR = new Biquad(SR, 'bandpass', o.fmin, o.q);
  const whL = new Biquad(SR, 'bandpass', o.fmin, 7);
  const whR = new Biquad(SR, 'bandpass', o.fmin, 7);
  const lowL = new Biquad(SR, 'lowpass', 180 * pf, 0.7);
  const lowR = new Biquad(SR, 'lowpass', 180 * pf, 0.7);
  const c = o.correlation;
  const s = Math.sqrt(1 - c * c);
  const white = 0.15 + 0.5 * b;
  const fmin = o.fmin * pf;
  const fmax = o.fmax * pf;
  for (let i = 0; i < total; i++) {
    const x = i / total;
    const env = x < o.peak ? smoothstep(x / o.peak) ** o.rise : (1 - smoothstep((x - o.peak) / (1 - o.peak))) ** 1.3;
    if ((i & 15) === 0) {
      const fc = fmin * (fmax / fmin) ** (env ** 0.9);
      bpL.set(fc, o.q);
      bpR.set(fc * 1.04, o.q);
      whL.set(fc * 1.35, 7);
      whR.set(fc * 1.3, 7);
    }
    const common = rng.bipolar();
    const nl = c * common + s * rng.bipolar();
    const nr = c * common + s * rng.bipolar();
    const srcL = pinkL.process(nl) * (1 - white) * 2.5 + nl * white;
    const srcR = pinkR.process(nr) * (1 - white) * 2.5 + nr * white;
    const rumble = o.rumble * w * env ** 0.7 * 2;
    const l = bpL.process(srcL) + whL.process(srcL) * o.whistle + lowL.process(nl) * rumble;
    const r = bpR.process(srcR) + whR.process(srcR) * o.whistle + lowR.process(nr) * rumble;
    const [gl, gr] = panGains(p.motion * (2 * x - 1));
    out.left[i] = l * env * gl;
    out.right[i] = r * env * gr;
  }
  return out;
}

const whoosh = (ctx: Ctx) =>
  air(ctx, {
    peak: 0.6,
    fmin: 220,
    fmax: 1200 + 3800 * ctx.p.brightness,
    q: 0.9 + 0.8 * ctx.p.brightness,
    whistle: 0.12 * ctx.p.brightness,
    rumble: 0.5,
    correlation: 0.6,
    rise: 1.6,
  });

const swish = (ctx: Ctx) =>
  air(ctx, {
    peak: 0.45,
    fmin: 600,
    fmax: 2400 + 5000 * ctx.p.brightness,
    q: 1.2 + 0.6 * ctx.p.brightness,
    whistle: 0.08,
    rumble: 0.25,
    correlation: 0.7,
    rise: 1.3,
  });

function riser({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len);
  const out = stereo(total);
  const hpL = new Biquad(SR, 'highpass', 150, 0.8);
  const hpR = new Biquad(SR, 'highpass', 150, 0.8);
  const hp2L = new Biquad(SR, 'highpass', 150, 0.8);
  const hp2R = new Biquad(SR, 'highpass', 150, 0.8);
  const lpL = new Biquad(SR, 'lowpass', 2000, 0.7);
  const lpR = new Biquad(SR, 'lowpass', 2000, 0.7);
  const toneL = new Biquad(SR, 'lowpass', 300, 1.2);
  const toneR = new Biquad(SR, 'lowpass', 300, 1.2);
  const saws = [-9, 0, 9].map((cents, k) => ({
    osc: new Osc(SR, rng.float()),
    ratio: 2 ** (cents / 1200),
    pan: panGains((k - 1) * 0.6),
  }));
  const sub = new Osc(SR);
  const f0 = 110 * pf;
  let trem = 0;
  for (let i = 0; i < total; i++) {
    const x = i / total;
    if ((i & 15) === 0) {
      const cutoff = 150 * pf * 22 ** x;
      hpL.set(cutoff, 0.8);
      hpR.set(cutoff, 0.8);
      hp2L.set(cutoff, 0.8);
      hp2R.set(cutoff, 0.8);
      const cut = 2000 + 12000 * x ** 1.2 * (0.4 + 0.6 * b);
      lpL.set(cut, 0.7);
      lpR.set(cut, 0.7);
      const toneCut = 300 + 5000 * x ** 1.5 * (0.5 + b);
      toneL.set(toneCut, 1.2);
      toneR.set(toneCut, 1.2);
    }
    const common = rng.bipolar();
    const noiseL = lpL.process(hp2L.process(hpL.process(0.5 * common + 0.866 * rng.bipolar())));
    const noiseR = lpR.process(hp2R.process(hpR.process(0.5 * common + 0.866 * rng.bipolar())));
    // Two octaves up, accelerating towards the end.
    const f = f0 * 2 ** (2 * x ** 1.3);
    let tl = 0;
    let tr = 0;
    for (const saw of saws) {
      const v = saw.osc.saw(f * saw.ratio);
      tl += v * saw.pan[0];
      tr += v * saw.pan[1];
    }
    tl = toneL.process(tl / 3);
    tr = toneR.process(tr / 3);
    trem += (5 + 13 * x) / SR;
    const flutter = 1 - 0.25 * x * (0.5 + 0.5 * Math.sin(TAU * trem));
    const noiseEnv = x ** 2.4;
    const toneEnv = x ** 1.8 * 0.45;
    const low = sub.sine((45 + 45 * x) * pf) * 0.25 * w * x ** 1.5;
    const [ml, mr] = panGains(p.motion * (2 * x - 1));
    out.left[i] = (noiseL * noiseEnv + tl * toneEnv + low) * flutter * ml;
    out.right[i] = (noiseR * noiseEnv + tr * toneEnv + low) * flutter * mr;
  }
  fadeOut(out, at(0.006));
  return out;
}

function reverse({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  // Render a forward crash (metallic, darkening as it decays), add its room, then flip it.
  const total = n(len);
  const crash = stereo(total);
  const metal = [3150, 4730, 6320, 8870, 11200].map((f) => ({
    l: new Biquad(SR, 'bandpass', f * Math.min(pf, 1.6) * rng.jitter(0.03), 9),
    r: new Biquad(SR, 'bandpass', f * Math.min(pf, 1.6) * rng.jitter(0.03), 9),
  }));
  const hpL = new Biquad(SR, 'highpass', 5000 * Math.min(pf, 2), 0.7);
  const hpR = new Biquad(SR, 'highpass', 5000 * Math.min(pf, 2), 0.7);
  const lpL = new Biquad(SR, 'lowpass', 16000, 0.7);
  const lpR = new Biquad(SR, 'lowpass', 16000, 0.7);
  const lowL = new Biquad(SR, 'lowpass', 250 * pf, 0.7);
  const lowR = new Biquad(SR, 'lowpass', 250 * pf, 0.7);
  const tau = len / 5;
  const airLevel = 0.5 + 0.5 * b;
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const x = i / total;
    if ((i & 15) === 0) {
      const cut = 4000 + 12000 * (1 - x) ** 1.5 * (0.5 + 0.5 * b);
      lpL.set(cut, 0.7);
      lpR.set(cut, 0.7);
    }
    const nl = rng.bipolar();
    const nr = rng.bipolar();
    let ml = 0;
    let mr = 0;
    for (const m of metal) {
      ml += m.l.process(nl);
      mr += m.r.process(nr);
    }
    const env = rise(t, 0.001) * decay(t, tau);
    const lowEnv = rise(t, 0.001) * decay(t, tau / 8) * 0.25 * w * 3;
    crash.left[i] = lpL.process(ml * 1.5 + hpL.process(nl) * airLevel) * env + lowL.process(nl) * lowEnv;
    crash.right[i] = lpR.process(mr * 1.5 + hpR.process(nr) * airLevel) * env + lowR.process(nr) * lowEnv;
  }
  let out = reversed(withSpace(crash, p.tail, { room: [0.5, 0.9], damp: 0.3, level: 0.7, predelay: 0, highpass: 400 }));
  // Drop the near-silent start (the far end of the reversed tail).
  const first = firstAbove(out, peakOf(out).value * 10 ** (-50 / 20));
  if (first > 0) out = slice(out, first, out.left.length);
  fadeIn(out, at(0.005));
  travel(out, p.motion);
  return out;
}

// ---------------------------------------------------------------------------
// Presets: weight

function impact({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len * 1.4);
  const out = stereo(total);
  const sub = new Osc(SR);
  const bodyL = new Biquad(SR, 'bandpass', 170 * pf, 0.9);
  const bodyR = new Biquad(SR, 'bandpass', 170 * pf, 0.9);
  const boomL = new Biquad(SR, 'lowpass', 450 * pf, 0.7);
  const boomR = new Biquad(SR, 'lowpass', 450 * pf, 0.7);
  const tauSub = len / 5;
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    // The sub drops in pitch as it hits.
    const f = (42 + 110 * decay(t, 0.045)) * pf;
    const s = sub.sine(f) * rise(t, 0.002) * decay(t, tauSub) * (0.5 + 0.8 * w);
    const body = rise(t, 0.001) * decay(t, 0.09) * 1.6;
    const boom = rise(t, 0.002) * decay(t, 0.22);
    const nl = rng.bipolar();
    const nr = rng.bipolar();
    out.left[i] = s + bodyL.process(nl) * body + boomL.process(nl) * boom;
    out.right[i] = s + bodyR.process(nr) * body + boomR.process(nr) * boom;
  }
  drive(out, 1.8);
  // The crack and snap stay on top of the saturation, so the hit keeps its edge.
  const crackHp = new Biquad(SR, 'highpass', 700 * pf, 0.7);
  const crackLp = new Biquad(SR, 'lowpass', (3000 + 9000 * b) * Math.min(pf, 1.5), 0.7);
  const snap = new Biquad(SR, 'bandpass', 1800 * pf, 1.2);
  const crackLevel = (0.5 + 0.5 * b) * 1.6;
  for (let i = 0; i < Math.min(total, n(0.15)); i++) {
    const t = i / SR;
    const x = rng.bipolar();
    const v =
      crackLp.process(crackHp.process(x)) * rise(t, 0.0002) * decay(t, 0.012) * crackLevel +
      snap.process(x) * rise(t, 0.0005) * decay(t, 0.03) * 0.8;
    out.left[i] += v;
    out.right[i] += v;
  }
  return out;
}

function thud({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len + 0.01);
  const out = stereo(total);
  const low = new Osc(SR);
  const lp = new Biquad(SR, 'lowpass', (500 + 1500 * b) * pf, 0.7);
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const body = low.sine((82 + 70 * decay(t, 0.018)) * pf) * rise(t, 0.0015) * decay(t, len / 4.5) * (0.6 + 0.6 * w);
    const muffle = lp.process(rng.bipolar()) * rise(t, 0.0005) * decay(t, 0.018) * (0.3 + 0.35 * b) * 2;
    out.left[i] = body + muffle;
    out.right[i] = body + muffle;
  }
  addMono(out, scaled(filtered(burst(rng, 0.001, 0.0001), 'bandpass', 1500 * pf, 1), 0.06 + 0.15 * b), 0);
  return drive(out, 1.4);
}

function subDrop({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len);
  const out = stereo(total);
  const osc = new Osc(SR);
  const k = 1.2 + 2.5 * b + w;
  const bias = 0.15;
  const offset = Math.tanh(k * bias);
  const from = 120 * pf * rng.jitter(0.04);
  const to = 30 * pf * rng.jitter(0.04);
  const curve = 0.6 * rng.jitter(0.1);
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const x = i / total;
    const f = from * (to / from) ** (x ** curve);
    const env = rise(t, 0.004) * Math.exp(-3.2 * x) * (1 - x ** 8);
    // Asymmetric saturation adds the harmonics that make a sub audible on small speakers.
    const v = Math.tanh(k * (osc.sine(f) * env + bias)) - offset;
    out.left[i] = v;
    out.right[i] = v;
  }
  return out;
}

function glitch({ p, rng, pf }: Ctx): Stereo {
  const { length: len, brightness: b, weight: w } = p;
  const total = n(len);
  const out = stereo(total);
  const notes = [440, 660, 880, 990, 1320, 1760, 2640];
  const kinds = ['crush', 'blip', 'crush', 'gap', 'stutter', 'blip', 'thump'] as const;
  let cursor = 0;
  let previous: Float32Array | null = null;
  while (cursor < total) {
    const size = n(rng.range(0.008, 0.045));
    let kind: (typeof kinds)[number] = rng.pick(kinds);
    if (kind === 'stutter' && !previous) kind = 'crush';
    if (kind === 'thump' && w < 0.15) kind = 'blip';
    const [gl, gr] = panGains(rng.bipolar() * 0.6);
    if (kind === 'stutter' && previous) {
      const repeats = rng.int(2, 4);
      for (let r = 0; r < repeats && cursor < total; r++) {
        addMono(out, previous, cursor, gl, gr);
        cursor += previous.length;
      }
      continue;
    }
    const seg = new Float32Array(size);
    if (kind === 'crush') {
      const hold = Math.max(1, Math.round(SR / (rng.range(1500, 7000) * Math.min(pf, 2))));
      const levels = 2 ** (rng.int(3, 6) - 1);
      let v = 0;
      for (let i = 0; i < size; i++) {
        if (i % hold === 0) v = Math.round(rng.bipolar() * levels) / levels;
        seg[i] = v * 0.6;
      }
      new Biquad(SR, 'highpass', 300 + 2000 * b, 0.7).run(seg);
    } else if (kind === 'blip' || kind === 'thump') {
      const osc = new Osc(SR);
      const f = kind === 'blip' ? rng.pick(notes) * pf : rng.range(70, 110) * pf;
      const level = kind === 'blip' ? 0.5 : 0.6 * w;
      for (let i = 0; i < size; i++) seg[i] = osc.square(f) * level;
      if (kind === 'blip') new Biquad(SR, 'lowpass', 2500 + 9000 * b, 0.7).run(seg);
    }
    // 1 ms edges, so the cuts between fragments don't click harder than intended.
    const edge = Math.min(at(0.001), Math.floor(size / 2));
    for (let i = 0; i < edge; i++) {
      const g = i / edge;
      seg[i] *= g;
      seg[size - 1 - i] *= g;
    }
    addMono(out, seg, cursor, gl, gr);
    previous = seg;
    cursor += size;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Table

const DEFS: Record<PresetName, PresetDef> = {
  click: {
    description: 'Crisp UI click: buttons, cursor clicks, selections.',
    length: { default: 0.03, min: 0.01, max: 0.15 },
    tail: 0.15,
    space: SMALL_ROOM,
    render: click,
  },
  tap: {
    description: 'Soft touch on glass: taps on phones and cards.',
    length: { default: 0.06, min: 0.02, max: 0.25 },
    tail: 0.1,
    space: SMALL_ROOM,
    render: tap,
  },
  tick: {
    description: 'Short woodblock tick: counters, clocks, list items appearing.',
    length: { default: 0.04, min: 0.015, max: 0.2 },
    tail: 0.1,
    space: SMALL_ROOM,
    render: tick,
  },
  toggle: {
    description: 'A switch flipping: two small clicks (toggles, checkboxes).',
    length: { default: 0.08, min: 0.04, max: 0.3 },
    tail: 0.12,
    space: SMALL_ROOM,
    render: toggle,
  },
  keystroke: {
    description: 'Mechanical keyboard key: one per typed character (vary seed and pitch slightly per key).',
    length: { default: 0.11, min: 0.05, max: 0.3 },
    tail: 0.08,
    space: SMALL_ROOM,
    render: keystroke,
  },
  enter: {
    description: 'Heavier key (Enter or space bar) with a stabilizer rattle.',
    length: { default: 0.16, min: 0.08, max: 0.4 },
    tail: 0.1,
    space: SMALL_ROOM,
    render: enter,
  },
  pop: {
    description: 'Round bubble pop: elements appearing, badges, bubbles.',
    length: { default: 0.07, min: 0.03, max: 0.25 },
    tail: 0.12,
    space: SMALL_ROOM,
    render: pop,
  },
  blip: {
    description: 'Short digital tone: data arriving, UI feedback, counters.',
    length: { default: 0.06, min: 0.02, max: 0.3 },
    tail: 0.1,
    space: SMALL_ROOM,
    render: blip,
  },
  ping: {
    description: 'Sonar ping with echoes: location lock, radar, detection.',
    length: { default: 0.9, min: 0.3, max: 3 },
    tail: 0.45,
    space: HALL,
    render: ping,
  },
  ding: {
    description: 'Bell hit: notifications, highlights.',
    length: { default: 1.2, min: 0.3, max: 3.5 },
    tail: 0.35,
    space: HALL,
    render: ding,
  },
  chime: {
    description: 'Rising 2–3 note chime: success, confirmation, completion.',
    length: { default: 0.9, min: 0.4, max: 2.5 },
    tail: 0.35,
    space: HALL,
    render: chime,
  },
  error: {
    description: 'Two descending buzzy tones: errors, rejections.',
    length: { default: 0.32, min: 0.15, max: 0.8 },
    tail: 0.12,
    space: SMALL_ROOM,
    render: error,
  },
  whoosh: {
    description: 'Air whoosh that peaks about 60% in: transitions and big moves (use align: peak).',
    length: { default: 0.7, min: 0.25, max: 2.5 },
    tail: 0.2,
    space: AIR,
    render: whoosh,
  },
  swish: {
    description: 'Short, fast swish: slides, swipes, cards moving.',
    length: { default: 0.25, min: 0.1, max: 0.6 },
    tail: 0.12,
    space: AIR,
    render: swish,
  },
  riser: {
    description: 'Tension build that peaks at the very end: into a reveal or a drop (use align: peak).',
    length: { default: 2, min: 0.8, max: 6 },
    tail: 0.25,
    space: AIR,
    render: riser,
    lowCut: 8,
  },
  reverse: {
    description: 'Reverse-cymbal swell that ends on its peak: leads into a cut (use align: peak).',
    length: { default: 1.2, min: 0.4, max: 4 },
    tail: 0.15,
    space: AIR,
    render: reverse,
    ownSpace: true,
  },
  impact: {
    description: 'Cinematic hit with a sub drop and a big tail: logo reveals, big moments.',
    length: { default: 1.6, min: 0.5, max: 4 },
    tail: 0.6,
    space: { room: [0.6, 0.93], damp: 0.45, level: 0.75, predelay: 0.012, highpass: 120 },
    render: impact,
    lowCut: 8,
  },
  thud: {
    description: 'Soft low drop: a pin landing, an object settling.',
    length: { default: 0.25, min: 0.1, max: 0.8 },
    tail: 0.12,
    space: SMALL_ROOM,
    render: thud,
    lowCut: 10,
  },
  'sub-drop': {
    description: 'Sub-bass drop: weight under reveals and cuts.',
    length: { default: 1.2, min: 0.4, max: 3 },
    tail: 0.05,
    space: { room: [0.3, 0.7], damp: 0.6, level: 0.3, predelay: 0, highpass: 80 },
    render: subDrop,
    lowCut: 8,
  },
  glitch: {
    description: 'Digital stutter: glitches, data corruption, tech transitions.',
    length: { default: 0.35, min: 0.12, max: 1.2 },
    tail: 0.05,
    space: { room: [0.2, 0.6], damp: 0.5, level: 0.4, predelay: 0.003, highpass: 300 },
    render: glitch,
  },
  sparkle: {
    description: 'Twinkling high grains: magic reveals, shine, premium moments.',
    length: { default: 0.9, min: 0.3, max: 2.5 },
    tail: 0.4,
    space: HALL,
    render: sparkle,
  },
  shutter: {
    description: 'Camera shutter: screenshots, captures, photos.',
    length: { default: 0.14, min: 0.08, max: 0.4 },
    tail: 0.1,
    space: SMALL_ROOM,
    render: shutter,
  },
};

export const PRESETS = Object.fromEntries(
  PRESET_NAMES.map((name) => [name, { name, description: DEFS[name].description, length: { ...DEFS[name].length } }]),
) as Record<PresetName, PresetInfo>;

export function isPreset(name: string): name is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(name);
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Clamp and fill defaults — this is what gets stored in a recipe and shown to the agent. */
export function normalizeParams(preset: PresetName, params: SynthParams = {}): Required<SynthParams> {
  const def = DEFS[preset];
  if (!def) throw new Error(`Unknown sound preset "${preset}". Presets: ${PRESET_NAMES.join(', ')}`);
  return {
    pitch: round(clamp(num(params.pitch, 0), -24, 24), 2),
    length: round(clamp(num(params.length, def.length.default), def.length.min, def.length.max), 3),
    brightness: round(clamp(num(params.brightness, 0.5), 0, 1), 3),
    weight: round(clamp(num(params.weight, 0.5), 0, 1), 3),
    tail: round(clamp(num(params.tail, def.tail), 0, 1), 3),
    motion: round(clamp(num(params.motion, 0), -1, 1), 3),
    seed: Math.round(clamp(num(params.seed, 1), -2147483648, 2147483647)),
  };
}

/** Render a preset: 48 kHz stereo, trimmed, de-clicked and levelled (peak ≤ −1 dBFS). */
export function synthesize(preset: PresetName, params?: SynthParams): StereoAudio {
  const p = normalizeParams(preset, params);
  const def = DEFS[preset];
  const rng = new Rng((hashString(preset) ^ Math.imul(p.seed | 0, 0x9e3779b1)) >>> 0);
  let audio = def.render({ p, rng, pf: 2 ** (p.pitch / 12) });
  // A body cut off before it has fully decayed would click.
  if (!def.ownSpace) fadeOut(audio, Math.min(at(0.01), Math.floor(audio.left.length / 4)));
  dcBlock(audio.left, SR, def.lowCut ?? 12);
  dcBlock(audio.right, SR, def.lowCut ?? 12);
  if (!def.ownSpace) audio = withSpace(audio, p.tail, def.space);
  const out = finalize(audio);
  return { sampleRate: SR, left: out.left, right: out.right };
}

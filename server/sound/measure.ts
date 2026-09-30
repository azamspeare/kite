import { FFT, hann } from '../music/fft';
import { db, type Stereo } from './audio';

/** What the agent gets instead of hearing a sound. */
export interface SoundMeasure {
  /** Seconds. */
  duration: number;
  /** Seconds from the start to the loudest moment (10 ms energy window): what `align: 'peak'` lines up. */
  peak: number;
  /** Sample peak, dBFS. */
  peakDb: number;
  /** Loudest 50 ms RMS, dBFS. */
  loudness: number;
  /** Seconds from the onset (−30 dB below the peak window) to the peak. */
  attack: number;
  /** Seconds from the peak until the sound stays 40 dB below it. */
  tail: number;
  /** Energy-weighted spectral centroid, Hz. */
  centroid: number;
  /** Frequency range holding the middle 60% of the energy, Hz. */
  band: [number, number];
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Mono energy per sample (L²+R²)/2 as a prefix sum, for O(1) window sums. */
function energyPrefix(audio: Stereo): Float64Array {
  const n = audio.left.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const l = audio.left[i];
    const r = audio.right[i];
    prefix[i + 1] = prefix[i] + (l * l + r * r) * 0.5;
  }
  return prefix;
}

/** RMS of centered windows of `win` samples, one value every `hop` samples. */
function rmsEnvelope(prefix: Float64Array, win: number, hop: number): Float64Array {
  const n = prefix.length - 1;
  const count = Math.max(1, Math.ceil(n / hop));
  const out = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const center = k * hop;
    const a = Math.max(0, center - (win >> 1));
    const b = Math.min(n, a + win);
    out[k] = b > a ? Math.sqrt((prefix[b] - prefix[a]) / win) : 0;
  }
  return out;
}

export function measureSound(audio: Stereo): SoundMeasure {
  const sr = audio.sampleRate;
  const n = audio.left.length;
  const duration = n / sr;
  let samplePeak = 0;
  for (let i = 0; i < n; i++) samplePeak = Math.max(samplePeak, Math.abs(audio.left[i]), Math.abs(audio.right[i]));
  if (n === 0 || samplePeak < 1e-6) {
    return { duration: round(duration), peak: 0, peakDb: -120, loudness: -120, attack: 0, tail: 0, centroid: 0, band: [0, 0] };
  }

  const prefix = energyPrefix(audio);
  const hop = Math.max(1, Math.round(sr / 1000));
  const env = rmsEnvelope(prefix, Math.round(sr * 0.01), hop);
  let peakIndex = 0;
  for (let k = 1; k < env.length; k++) if (env[k] > env[peakIndex]) peakIndex = k;
  const peakEnv = env[peakIndex];
  const onsetLevel = peakEnv * 10 ** (-30 / 20);
  let onset = peakIndex;
  while (onset > 0 && env[onset - 1] >= onsetLevel) onset--;
  const tailLevel = peakEnv * 10 ** (-40 / 20);
  let end = env.length - 1;
  while (end > peakIndex && env[end] < tailLevel) end--;

  const loud = rmsEnvelope(prefix, Math.round(sr * 0.05), hop);
  let loudest = 0;
  for (const v of loud) loudest = Math.max(loudest, v);

  const { centroid, band } = spectrum(audio);
  return {
    duration: round(duration),
    peak: round(Math.min(duration, (peakIndex * hop) / sr)),
    peakDb: round(db(samplePeak), 1),
    loudness: round(db(loudest), 1),
    attack: round(((peakIndex - onset) * hop) / sr),
    tail: round(((end - peakIndex) * hop) / sr),
    centroid: Math.round(centroid),
    band,
  };
}

/** Average power spectrum over the whole sound → centroid and the band holding the middle 60% of the energy. */
function spectrum(audio: Stereo): { centroid: number; band: [number, number] } {
  const size = 2048;
  const hop = 1024;
  const fft = new FFT(size);
  const win = hann(size);
  const bins = size / 2 + 1;
  const total = new Float64Array(bins);
  const x = new Float64Array(size);
  const y = new Float64Array(size);
  const px = new Float64Array(bins);
  const py = new Float64Array(bins);
  const n = audio.left.length;
  for (let start = -size / 2; start < n; start += hop) {
    for (let j = 0; j < size; j++) {
      const s = start + j;
      x[j] = s >= 0 && s < n ? audio.left[s] * win[j] : 0;
      y[j] = s >= 0 && s < n ? audio.right[s] * win[j] : 0;
    }
    fft.powerPair(x, y, px, py);
    for (let k = 0; k < bins; k++) total[k] += px[k] + py[k];
  }
  const binHz = audio.sampleRate / size;
  let sum = 0;
  let weighted = 0;
  // Ignore DC and sub-sonic rumble.
  for (let k = 1; k < bins; k++) {
    if (k * binHz < 20) continue;
    sum += total[k];
    weighted += total[k] * k * binHz;
  }
  if (sum <= 0) return { centroid: 0, band: [0, 0] };
  let acc = 0;
  let lo = 0;
  let hi = 0;
  for (let k = 1; k < bins; k++) {
    if (k * binHz < 20) continue;
    const before = acc;
    acc += total[k];
    if (before < sum * 0.2 && acc >= sum * 0.2) lo = k * binHz;
    if (before < sum * 0.8 && acc >= sum * 0.8) hi = k * binHz;
  }
  return { centroid: weighted / sum, band: [Math.round(lo), Math.round(hi)] };
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${Number((hz / 1000).toFixed(hz >= 10000 ? 0 : 1))} kHz` : `${Math.round(hz)} Hz`;
}

/** One word for where a sound sits, from its centroid. */
export function brightnessWord(centroid: number): string {
  if (centroid < 250) return 'sub/deep';
  if (centroid < 700) return 'low, warm';
  if (centroid < 1800) return 'mid';
  if (centroid < 4500) return 'bright';
  return 'very bright, airy';
}

/** "0.42 s long · hits at 0.01 s · tail 0.20 s · −16 dBFS loudest 50 ms · bright (1.2–5.8 kHz)" */
export function describeMeasure(m: SoundMeasure): string {
  return [
    `${m.duration.toFixed(2)} s long`,
    `peak at ${m.peak.toFixed(3)} s (attack ${m.attack.toFixed(3)} s, tail ${m.tail.toFixed(2)} s)`,
    `loudest 50 ms ${m.loudness.toFixed(1)} dBFS, sample peak ${m.peakDb.toFixed(1)} dBFS`,
    `${brightnessWord(m.centroid)} (centroid ${formatHz(m.centroid)}, most energy ${formatHz(m.band[0])}–${formatHz(m.band[1])})`,
  ].join(' · ');
}

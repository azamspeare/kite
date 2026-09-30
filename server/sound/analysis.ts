import { FFT, hann } from '../music/fft';
import { db, silence } from './audio';
import { renderCue, type CueSource, type MixResult, type Placement } from './mix';

export type Audibility = 'clear' | 'audible' | 'faint' | 'masked' | 'silent' | 'outside';

export interface CueCheck {
  place: Placement;
  /**
   * Sound-to-mix ratio in dB at the cue's most prominent moment: the cue's energy against everything
   * else playing then (music + other cues), weighted toward the frequencies the cue occupies.
   */
  smr: number;
  verdict: Audibility;
  /** The cue's own sample peak in the mix, dBFS (before the limiter). */
  peakDb: number;
  /** Limiter gain reduction around the cue's peak, dB (≤ 0). */
  limitDb: number;
}

const FRAME = 1024;
const HOP = 512;
/** Octave-ish bands (Hz) the comparison runs in. */
const EDGES = [40, 80, 160, 315, 630, 1250, 2500, 5000, 10000, 20000];
/** Longest stretch of a cue that is analyzed (from its start), seconds. */
const MAX_WINDOW = 3;

export function verdictFor(smr: number): Audibility {
  if (smr >= 8) return 'clear';
  if (smr >= 2) return 'audible';
  if (smr >= -4) return 'faint';
  return 'masked';
}

/**
 * How well each cue cuts through the mix. `mix` must come from mix(…, { keepBuses: true }), with
 * `sources` in the same order as its placements.
 */
export function checkCues(result: MixResult, sources: CueSource[]): CueCheck[] {
  const { music, sfx, gain } = result;
  if (!music || !sfx || !gain) throw new Error('checkCues needs a mix made with keepBuses');
  const sr = result.audio.sampleRate;
  const total = result.audio.left.length;
  const fft = new FFT(FRAME);
  const win = hann(FRAME);
  const bins = FRAME / 2 + 1;
  const bandOf = new Int8Array(bins).fill(-1);
  for (let k = 0; k < bins; k++) {
    const hz = (k * sr) / FRAME;
    for (let b = 0; b < EDGES.length - 1; b++) if (hz >= EDGES[b] && hz < EDGES[b + 1]) bandOf[k] = b;
  }
  const bands = EDGES.length - 1;
  const x = new Float64Array(FRAME);
  const y = new Float64Array(FRAME);
  const px = new Float64Array(bins);
  const py = new Float64Array(bins);

  return result.placements.map((place, i) => {
    const from = Math.max(0, Math.floor(place.start * sr));
    const to = Math.min(total, Math.ceil(Math.min(place.end, place.start + MAX_WINDOW) * sr));
    if (to - from < 16) return { place, smr: -Infinity, verdict: 'outside' as Audibility, peakDb: -Infinity, limitDb: 0 };
    // The cue alone over its window.
    const own = silence(sr, to - from);
    renderCue(own, from / sr, place, sources[i]);
    let peak = 0;
    for (let n = 0; n < own.left.length; n++) peak = Math.max(peak, Math.abs(own.left[n]), Math.abs(own.right[n]));
    if (peak < 1e-5) return { place, smr: -Infinity, verdict: 'silent' as Audibility, peakDb: db(peak), limitDb: 0 };

    // Frame by frame: cue vs. everything else (music + effects − this cue), per band.
    const frames: { cueE: number; smr: number }[] = [];
    const cueBand = new Float64Array(bands);
    const bedBand = new Float64Array(bands);
    for (let start = 0; start === 0 || start + FRAME / 4 < own.left.length; start += HOP) {
      for (let j = 0; j < FRAME; j++) {
        const n = start + j;
        if (n < own.left.length) {
          const m = from + n;
          const c = (own.left[n] + own.right[n]) * 0.5;
          const everything = (music.left[m] + sfx.left[m] + music.right[m] + sfx.right[m]) * 0.5;
          x[j] = c * win[j];
          y[j] = (everything - c) * win[j];
        } else {
          x[j] = 0;
          y[j] = 0;
        }
      }
      fft.powerPair(x, y, px, py);
      cueBand.fill(0);
      bedBand.fill(0);
      for (let k = 1; k < bins; k++) {
        const b = bandOf[k];
        if (b < 0) continue;
        cueBand[b] += px[k];
        bedBand[b] += py[k];
      }
      let cueE = 0;
      for (let b = 0; b < bands; b++) cueE += cueBand[b];
      if (cueE <= 0) continue;
      let num = 0;
      let den = 0;
      for (let b = 0; b < bands; b++) {
        const w = cueBand[b] / cueE;
        num += w * cueBand[b];
        den += w * bedBand[b];
      }
      frames.push({ cueE, smr: den > 0 ? 10 * Math.log10(num / den) : 60 });
    }
    // The most prominent moment among the cue's loud frames (within 10 dB of its loudest).
    const loudest = Math.max(...frames.map((f) => f.cueE));
    let smr = -Infinity;
    for (const f of frames) if (f.cueE >= loudest * 0.1) smr = Math.max(smr, f.smr);
    smr = Math.min(60, smr);

    const peakSample = Math.min(total - 1, Math.max(0, Math.round(place.peakAt * sr)));
    let minGain = 1;
    const span = Math.round(0.01 * sr);
    for (let n = Math.max(0, peakSample - span); n < Math.min(total, peakSample + span); n++)
      minGain = Math.min(minGain, gain[n]);
    return { place, smr, verdict: verdictFor(smr), peakDb: db(peak), limitDb: Math.min(0, db(minGain)) };
  });
}

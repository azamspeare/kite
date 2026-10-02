// Music analysis for Kite: tempo, beats, downbeats, phrases, sections,
// accents and a drawable waveform, computed from any audio file ffmpeg can read.

import type { MusicAnalysis } from '../../src/shared/types';
import { ANALYSIS_SAMPLE_RATE, decodeAudio } from './decode';
import { computeFeatures } from './features';
import { onsetEnvelope, refineToAttack, trackBeats } from './beats';
import { analyzeStructure, BEATS_PER_BAR, detectAccents, downbeatPhase, waveformPeaks } from './structure';

export interface AnalyzeOptions {
  ffmpegPath?: string;
}

export async function analyzeMusic(filePath: string, opts: AnalyzeOptions = {}): Promise<MusicAnalysis> {
  const signal = await decodeAudio(filePath, ANALYSIS_SAMPLE_RATE, opts.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg');
  return analyzeSignal(signal, ANALYSIS_SAMPLE_RATE);
}

/** Analyze mono PCM samples (any sample rate; 22.05 kHz is what the tuning assumes). */
export function analyzeSignal(signal: Float32Array, sampleRate: number): MusicAnalysis {
  const duration = round3(signal.length / sampleRate);
  const waveform = waveformPeaks(signal);

  let peak = 0;
  for (let i = 0; i < signal.length; i++) {
    const v = Math.abs(signal[i]);
    if (v > peak) peak = v;
  }
  if (duration < 1 || peak < 1e-4) {
    return {
      version: 1,
      duration,
      sampleRate,
      bpm: 120,
      beatsPerBar: BEATS_PER_BAR,
      beats: [],
      downbeats: [],
      phrases: [],
      sections: [{ start: 0, end: duration, label: 'silence', energy: 0 }],
      accents: [],
      waveform,
    };
  }

  const features = computeFeatures(signal, sampleRate);
  const env = onsetEnvelope(features);
  const track = trackBeats(features, env);
  const beats = track.beats;

  const phase = downbeatPhase(beats, features);
  const downbeats = beats.filter((_, i) => i >= phase && (i - phase) % BEATS_PER_BAR === 0);
  const bar = track.period * BEATS_PER_BAR;
  // Bars that start as the music ends carry no content; keep them out of the structure analysis.
  const structuralBars = downbeats.filter((t) => t < track.activeEnd - 0.5 * bar);
  const structure = analyzeStructure(features, structuralBars, bar, duration);
  const accents = detectAccents(features, env, (t) => refineToAttack(features, t));

  return {
    version: 1,
    duration,
    sampleRate,
    bpm: track.bpm,
    beatsPerBar: BEATS_PER_BAR,
    beats,
    downbeats,
    phrases: structure.phrases,
    sections: structure.sections,
    accents,
    waveform,
  };
}

function round3(t: number): number {
  return Math.round(t * 1000) / 1000;
}

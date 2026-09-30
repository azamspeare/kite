// Validation of the cues a scene's `sounds` export returns (shared by frames and tests).
import type { SoundCue } from '../runtime/sound';
import type { ResolvedCue } from './types';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Check one entry of a `sounds` list; returns the cue with defaults filled in, or what's wrong with it. */
export function readCue(raw: unknown): Omit<ResolvedCue, 'sceneId' | 'index' | 't'> | string {
  if (!raw || typeof raw !== 'object') return 'is not a cue object like { at: 1.2, sound: "pop" }';
  const { at, sound, volume, pitch, pan, align, duration } = raw as Partial<Record<keyof SoundCue, unknown>>;
  if (!num(at)) return 'needs `at`: scene-local seconds as a number';
  if (typeof sound !== 'string' || !sound.trim()) return 'needs `sound`: the name of a sound in the library';
  if (volume !== undefined && !(num(volume) && volume >= 0)) return '`volume` must be a number ≥ 0';
  if (pitch !== undefined && !num(pitch)) return '`pitch` must be a number of semitones';
  if (pan !== undefined && !num(pan)) return '`pan` must be a number from −1 to 1';
  if (align !== undefined && align !== 'start' && align !== 'peak') return "`align` must be 'start' or 'peak'";
  if (duration !== undefined && !(num(duration) && duration > 0)) return '`duration` must be a number of seconds > 0';
  return {
    at,
    sound: sound.trim(),
    volume: volume ?? 1,
    pitch: Math.min(24, Math.max(-24, pitch ?? 0)),
    pan: Math.min(1, Math.max(-1, pan ?? 0)),
    align: align ?? 'start',
    ...(duration !== undefined ? { duration } : {}),
  };
}

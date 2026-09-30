import type { SceneProps } from './types';

/** One sound effect, placed in scene-local time. */
export interface SoundCue {
  /** Scene-local seconds (0 = the scene's first frame). Negative values start before the cut. */
  at: number;
  /** Name of a sound in the project's library (a synth recipe, a generated sound or a file in sounds/). */
  sound: string;
  /** Linear gain, 1 = as the sound was made (default). */
  volume?: number;
  /** Pitch shift in semitones; like a sampler, it also changes the length. */
  pitch?: number;
  /** Stereo position, −1 (left) … 1 (right). Default 0. */
  pan?: number;
  /** 'start' (default): the sound starts at `at`. 'peak': its loudest moment lands on `at` (whooshes and risers into a hit). */
  align?: 'start' | 'peak';
  /** Stop after this many seconds (with a short fade) instead of playing the whole sound. */
  duration?: number;
}

/** Everything a scene knows about itself except the time. */
export type SoundProps = Omit<SceneProps, 't'>;

/**
 * A scene's `sounds` export: a list of cues, or a function of the scene's props that returns one.
 *
 *   export const sounds: SceneSounds = ({ music }) => [{ at: music.beat(2), sound: 'pop' }];
 */
export type SceneSounds = SoundCue[] | ((props: SoundProps) => SoundCue[]);

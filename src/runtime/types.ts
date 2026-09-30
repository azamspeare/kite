import type { Music } from './music';

export interface SceneInfo {
  id: string;
  name: string;
  /** 0-based position in the video. */
  index: number;
  count: number;
  /** Start time of this scene in the whole video (seconds). */
  start: number;
}

/** Props every scene component receives. Render purely from these — no state, effects or timers. */
export interface SceneProps {
  /** Seconds since this scene started: 0 … duration. */
  t: number;
  /** Length of this scene in seconds. */
  duration: number;
  /** Canvas size in CSS pixels (e.g. 1920 × 1080). */
  width: number;
  height: number;
  fps: number;
  music: Music;
  scene: SceneInfo;
}

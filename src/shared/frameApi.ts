// Contract between a scene frame (frame.html) and whoever hosts it: the editor
// (same-origin iframe) or the headless capture service (Playwright).
import type { SoundReport } from './types';

export interface FrameRenderResult {
  /** Errors raised while importing or rendering the scene(s) shown in this frame. */
  errors: string[];
  /** The scene actually shown (whole-video mode picks one by time). */
  sceneId: string | null;
  /** Scene-local time that was rendered. */
  localTime: number;
}

export interface FrameApi {
  /** Resolves once the project and scene modules are loaded and the first frame rendered. */
  ready: Promise<void>;
  /** Synchronous render at time t (scene-local in scene mode, video time in whole mode). */
  render(t: number): FrameRenderResult;
  /** Render at t, then wait for fonts, images and two animation frames — use before screenshots. */
  seek(t: number): Promise<FrameRenderResult>;
  /** Re-fetch the project and re-import changed scene modules (force: re-import everything). */
  reload(options?: { force?: boolean }): Promise<void>;
  /** Switch the scene shown in scene mode (null = whole video). */
  setScene(sceneId: string | null): Promise<void>;
  /** Length of what this frame shows, in seconds. */
  duration(): number;
  /** Errors from the most recent load/render. */
  errors(): string[];
  /** Sound cues of the loaded scenes in video time (every scene in whole-video mode), with problems found in them. */
  sounds(): SoundReport;
}

export type FrameMessage =
  | { source: 'sb-frame'; type: 'ready' }
  | { source: 'sb-frame'; type: 'reloaded' }
  | { source: 'sb-frame'; type: 'errors'; errors: string[] }
  /** Whole-video frames in the editor post their cues after every (re)load that changes them. */
  | { source: 'sb-frame'; type: 'sounds'; report: SoundReport };

declare global {
  interface Window {
    __sb?: FrameApi;
  }
}

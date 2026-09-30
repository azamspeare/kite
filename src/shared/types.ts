// Data shapes shared by the server, the editor UI and the scene runtime.

export interface SceneMeta {
  /** File-safe id; the scene lives at `scenes/<id>.tsx`. */
  id: string;
  name: string;
  /** Seconds. */
  duration: number;
}

export interface ProjectMusicRef {
  /** File name inside the project's `music/` folder. */
  file: string;
  /** Seconds into the track that line up with video time 0. */
  start: number;
  /** Linear gain applied on playback and in renders (0..1). */
  volume: number;
}

export interface ProjectFile {
  name: string;
  width: number;
  height: number;
  fps: number;
  scenes: SceneMeta[];
  music?: ProjectMusicRef | null;
}

/** Output of the music analyzer. All times are seconds of track time. */
export interface MusicAnalysis {
  version: 1;
  duration: number;
  sampleRate: number;
  bpm: number;
  beatsPerBar: number;
  beats: number[];
  /** Bar starts; a subset of `beats`. */
  downbeats: number[];
  /** Phrase starts (usually every 4 or 8 bars, aligned to the structure); a subset of `downbeats`. */
  phrases: number[];
  /** Structural segments with a coarse label and mean loudness 0..1. */
  sections: { start: number; end: number; label: string; energy: number }[];
  /** Strong onsets ("hits"), strength 0..1, strongest first is not guaranteed; sorted by time. */
  accents: { t: number; strength: number }[];
  /** Evenly spaced peak amplitudes 0..1 across the whole track, for drawing. */
  waveform: number[];
}

/** What the editor/runtime receive for a project (project.json plus derived data). */
export interface ProjectState extends ProjectFile {
  id: string;
  dir: string;
  scenes: SceneState[];
  musicAnalysis: MusicAnalysis | null;
  /** URL the browser can load the audio from, if any. */
  musicUrl: string | null;
  artDirection: string;
  /** Bumped whenever any code file in the project changes; frames re-import scenes when it moves. */
  codeGeneration: number;
}

export interface SceneState extends SceneMeta {
  index: number;
  /** Global start time in seconds. */
  start: number;
  /** Absolute path of the scene file. */
  file: string;
  /** Module URL for dynamic import (without cache-busting query). */
  url: string;
  /** Changes whenever the file changes (mtime-based). */
  version: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  sceneCount: number;
  duration: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Chat

export type ChatScope = { kind: 'scene'; sceneId: string } | { kind: 'project' };

export type ChatStep =
  | { kind: 'note'; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      status: 'running' | 'done' | 'error';
      detail?: string;
      images?: string[];
    };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  /** Assistant only. */
  steps?: ChatStep[];
  durationMs?: number;
  costUsd?: number;
  error?: string;
  status?: 'running' | 'done' | 'error' | 'stopped';
  /** Set when the turn changed files and can be undone. */
  undoId?: string;
  undone?: boolean;
  /** Playhead time the user was looking at when sending (user messages). */
  playhead?: number;
}

export interface ChatThread {
  scope: ChatScope;
  sessionId: string | null;
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Seams & renders

export interface SeamResult {
  from: string;
  to: string;
  /** Percentage of pixels that differ (0..100). */
  diffPercent: number;
  checkedAt: number;
  error?: string;
}

export interface RenderJob {
  id: string;
  projectId: string;
  status: 'queued' | 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';
  framesDone: number;
  framesTotal: number;
  fps: number;
  width: number;
  height: number;
  startedAt: number;
  finishedAt?: number;
  output?: string;
  outputUrl?: string;
  error?: string;
}

export interface RenderFile {
  name: string;
  url: string;
  size: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Server -> editor events (SSE)

export type ServerEvent =
  | { type: 'project-changed'; projectId: string }
  | { type: 'projects-changed' }
  | { type: 'chat-updated'; projectId: string; scopeKey: string; message: ChatMessage }
  | { type: 'chat-reset'; projectId: string; scopeKey: string }
  | { type: 'chat-busy'; projectId: string; scopeKey: string; busy: boolean }
  | { type: 'seams'; projectId: string; seams: SeamResult[] }
  | { type: 'render'; job: RenderJob }
  | { type: 'music-status'; projectId: string; status: 'analyzing' | 'ready' | 'error'; error?: string };

export function scopeKey(scope: ChatScope): string {
  return scope.kind === 'project' ? '_project' : scope.sceneId;
}

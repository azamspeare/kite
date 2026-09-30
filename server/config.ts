import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECTS_DIR = path.resolve(process.env.STORYBOARD_PROJECTS ?? path.join(ROOT, 'projects'));
export const HOST = process.env.HOST ?? '127.0.0.1';
export const PORT = Number(process.env.PORT ?? 5199);
export const BASE_URL = `http://${HOST}:${PORT}`;
export const MCP_URL = `${BASE_URL}/mcp`;

/** Music engine (ACE-Step's REST API). Local by default; point it at another machine later. */
export const MUSIC_URL = (process.env.STORYBOARD_MUSIC_URL ?? 'http://127.0.0.1:8001').replace(/\/+$/, '');
/** Local ACE-Step install that Storyboard can start and stop. */
export const ACESTEP_DIR = path.resolve(process.env.ACESTEP_DIR ?? path.join(os.homedir(), 'Tools', 'ace-step'));
export const UV_BIN = process.env.UV_PATH ?? 'uv';
/** Where the music engine CLI keeps its API key, PID file and log. */
export const MUSIC_STATE_DIR = path.join(os.homedir(), '.config', 'storyboard');
/** Shared secret between Storyboard and the engine; created on first use. */
export const MUSIC_KEY_FILE = path.join(MUSIC_STATE_DIR, 'music-api-key');

export const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
export const CLAUDE_BIN = process.env.CLAUDE_PATH ?? 'claude';

/** Model and effort the in-app agent uses unless the UI picks something else. */
export const DEFAULT_MODEL = process.env.STORYBOARD_MODEL ?? 'claude-opus-5-5';
export const DEFAULT_EFFORT = (process.env.STORYBOARD_EFFORT ?? 'medium') as Effort;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

/** Frames sent to the agent: 960×540 JPEG keeps a batch of frames well under MCP output limits. */
export const AGENT_FRAME_SCALE = 0.5;
export const AGENT_FRAME_QUALITY = 82;
export const MAX_FRAMES_PER_CALL = 8;

/** Internal per-project folder (chats, undo snapshots, captured frames). */
export const INTERNAL_DIR = '.storyboard';

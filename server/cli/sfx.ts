// The sound-effects engine: Stable Audio Open 1.0 behind engines/sfx/server.py. Setup installs its Python environment
// and downloads the model, which is gated on Hugging Face (accept Stability AI's license, then use a Read token).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SFX_DIR, SFX_MODELS_DIR, SFX_PYTHON } from '../config';
import { sfxEngineInstalled, sfxModelDownloaded } from '../sound/engine';
import { hfRepoSize } from './huggingface';
import { engineEnv } from './services';
import { runStep, stepFailed, uvReporter } from './tasks';
import { movePath, shown } from './term';
import { formatSize, rail, Task } from './ui';
import { ensureUv, UV_BIN, uvEnv, venvIsOurs } from './uv';

const MODEL_ID = 'stabilityai/stable-audio-open-1.0';
export const MODEL_PAGE = `https://huggingface.co/${MODEL_ID}`;
export const TOKEN_PAGE = 'https://huggingface.co/settings/tokens/new?tokenType=read';
export const JOIN_PAGE = 'https://huggingface.co/join';
const CACHED_MODEL = 'models--stabilityai--stable-audio-open-1.0';
/** The files server.py downloads (its ALLOW_PATTERNS): the diffusers weights, not the repo's other checkpoints. */
const DOWNLOAD_PATTERNS = [
  'model_index.json',
  'LICENSE.md',
  'scheduler/*',
  'text_encoder/*',
  'tokenizer/*',
  'transformer/*',
  'vae/*',
  'projection_model/*',
];

/** Why the engine can't run on this machine, or null when it can. */
export function sfxUnsupported(): string | null {
  if (process.platform === 'darwin' && process.arch !== 'arm64')
    return 'The sound-effects engine needs a Mac with Apple silicon.';
  if (process.platform !== 'darwin' && process.platform !== 'linux') return 'The sound-effects engine runs on macOS and Linux.';
  return null;
}

/** Hugging Face's own folder (~/.cache/huggingface unless HF_HOME says otherwise). */
function hfHome(): string {
  return process.env.HF_HOME ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'huggingface');
}

/** The model in Hugging Face's shared cache, where Storyboard (the project Kite is built from) downloaded it before its launcher existed. */
export function legacySfxModel(): string | null {
  const dir = path.join(process.env.HF_HUB_CACHE ?? path.join(hfHome(), 'hub'), CACHED_MODEL);
  return fs.existsSync(path.join(dir, 'snapshots')) ? dir : null;
}

export function sfxNeeds(): { environment: boolean; model: boolean } {
  return { environment: !sfxEngineInstalled() || !venvIsOurs(path.join(SFX_DIR, '.venv')), model: !sfxModelDownloaded() };
}

/** A token the user already has: HF_TOKEN, or the one `hf auth login` saved. */
export function existingHfToken(): string | null {
  const fromEnv = (process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN)?.trim();
  if (fromEnv) return fromEnv;
  try {
    return fs.readFileSync(process.env.HF_TOKEN_PATH ?? path.join(hfHome(), 'token'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export type HfAccess =
  { ok: true; user: string } | { ok: false; problem: 'token' | 'license' | 'network'; user?: string; detail?: string };

/** Whether a token works, and whether its account may download the model (the license is accepted). */
export async function checkHfAccess(token: string): Promise<HfAccess> {
  const headers = { Authorization: `Bearer ${token}` };
  const request = (url: string, init: RequestInit = {}) =>
    fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000), ...init });
  let user: string;
  try {
    const res = await request('https://huggingface.co/api/whoami-v2');
    if (res.status === 401) return { ok: false, problem: 'token' };
    if (!res.ok) return { ok: false, problem: 'network', detail: `Hugging Face answered with HTTP ${res.status}` };
    user = String(((await res.json()) as { name?: unknown }).name ?? 'your account');
  } catch (e) {
    return { ok: false, problem: 'network', detail: (e as Error).message };
  }
  try {
    // A file of the gated repo: 200 or a redirect to the download means access; 401/403 means no license (yet).
    const res = await request(`https://huggingface.co/${MODEL_ID}/resolve/main/model_index.json`, { method: 'HEAD' });
    if (res.status === 200 || (res.status >= 300 && res.status < 400)) return { ok: true, user };
    if (res.status === 401 || res.status === 403) return { ok: false, problem: 'license', user };
    return { ok: false, problem: 'network', user, detail: `Hugging Face answered with HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, problem: 'network', user, detail: (e as Error).message };
  }
}

/** Install or repair the sound-effects engine; only the missing parts are done. */
export async function installSfx(opts: { token: string | null; moveModelFrom: string | null }): Promise<boolean> {
  const needs = sfxNeeds();
  // Always synced: it takes a second when nothing's missing, and finishes an install that was stopped halfway.
  if (!(await ensureUv())) return false;
  const venv = path.join(SFX_DIR, '.venv');
  if (fs.existsSync(venv) && !venvIsOurs(venv)) fs.rmSync(venv, { recursive: true, force: true });
  const task = new Task('Python packages');
  const uv = uvReporter(task);
  const step = await runStep(task, UV_BIN, ['sync', '--locked', '--no-build'], {
    cwd: SFX_DIR,
    env: uvEnv(),
    onLine: uv.onLine,
  });
  if (step.code !== 0) {
    stepFailed(task, 'install failed', step.tail);
    return false;
  }
  task.done(uv.summary());

  const cached = path.join(SFX_MODELS_DIR, CACHED_MODEL);
  if (needs.model && opts.moveModelFrom && fs.existsSync(opts.moveModelFrom)) {
    fs.rmSync(cached, { recursive: true, force: true }); // an unfinished download
    movePath(opts.moveModelFrom, cached);
    rail.done('Stable Audio Open 1.0', `moved from ${shown(opts.moveModelFrom)}, no download needed`);
  } else if (!sfxModelDownloaded()) {
    const task = new Task('Stable Audio Open 1.0');
    const total = await hfRepoSize(MODEL_ID, DOWNLOAD_PATTERNS);
    const step = await runStep(task, SFX_PYTHON, ['server.py', '--download'], {
      cwd: SFX_DIR,
      env: { ...engineEnv(SFX_DIR), ...(opts.token ? { HF_TOKEN: opts.token } : {}) },
      watch: { paths: [cached], total },
    });
    if (step.code !== 0 || !sfxModelDownloaded()) {
      stepFailed(task, 'download failed · run ./kite setup again to resume', step.tail);
      return false;
    }
    task.done(total ? formatSize(total) : '');
  } else {
    rail.done('Stable Audio Open 1.0', 'downloaded');
  }
  return true;
}

/** Everything setup added to engines/sfx (the tracked engine code stays). */
export const SFX_INSTALLED_PATHS = [path.join(SFX_DIR, '.venv'), SFX_MODELS_DIR, path.join(SFX_DIR, '.cache')];

export function removeSfx(): void {
  for (const p of SFX_INSTALLED_PATHS) fs.rmSync(p, { recursive: true, force: true });
}

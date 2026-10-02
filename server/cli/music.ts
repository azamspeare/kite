// The music engine: ACE-Step 1.5 (github.com/ace-step/ACE-Step-1.5) at a pinned commit, installed in engines/music
// with its Python environment and models.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MUSIC_DIR, MUSIC_PYTHON } from '../config';
import { engineInstalled } from '../music/engine';
import { hfRepoSize } from './huggingface';
import { engineEnv } from './services';
import { runStep, stepFailed, uvReporter } from './tasks';
import { hasCommand, movePath, output, shown } from './term';
import { formatSize, rail, Task } from './ui';
import { ensureUv, UV_BIN, uvEnv, venvIsOurs } from './uv';

const REPO = 'https://github.com/ace-step/ACE-Step-1.5.git';
/** The commit Kite is tested with; its uv.lock pins every Python package. */
const COMMIT = 'ca1e85fe9430179831e6bc6be790c332190a3866';
/** Where the README of Storyboard (the project Kite is built from) told people to install it, before its launcher existed. */
export const LEGACY_MUSIC_DIR = path.resolve(process.env.ACESTEP_DIR ?? path.join(os.homedir(), 'Tools', 'ace-step'));

/** Why the engine can't run on this machine, or null when it can. */
export function musicUnsupported(): string | null {
  if (process.platform === 'darwin' && process.arch !== 'arm64') return 'The music engine needs a Mac with Apple silicon.';
  if (process.platform !== 'darwin' && process.platform !== 'linux') return 'The music engine runs on macOS and Linux.';
  return null;
}

const git = (args: string[]) => output('git', ['-C', MUSIC_DIR, ...args], { timeout: 5 * 60 * 1000 });

/** A music engine installed the old way (outside the app folder), with the models it downloaded. */
export function legacyMusic(): { dir: string; checkpoints: string | null } | null {
  if (!fs.existsSync(path.join(LEGACY_MUSIC_DIR, 'pyproject.toml'))) return null;
  const checkpoints = path.join(LEGACY_MUSIC_DIR, 'checkpoints');
  const hasModels = fs.existsSync(checkpoints) && fs.readdirSync(checkpoints).some((e) => !e.startsWith('.'));
  return { dir: LEGACY_MUSIC_DIR, checkpoints: hasModels ? checkpoints : null };
}

/** What's already in place, so setup only does what's missing. */
export async function musicNeeds(): Promise<{ checkout: boolean; environment: boolean; models: boolean }> {
  const head = fs.existsSync(path.join(MUSIC_DIR, '.git')) ? await git(['rev-parse', 'HEAD']) : null;
  return {
    checkout: head !== COMMIT,
    environment: !fs.existsSync(MUSIC_PYTHON) || !venvIsOurs(path.join(MUSIC_DIR, '.venv')),
    models: !engineInstalled(),
  };
}

/** Get ACE-Step's code at the pinned commit (git checks it by its hash). */
async function checkout(): Promise<boolean> {
  const task = new Task('ACE-Step 1.5');
  if (!(await hasCommand('git'))) {
    task.fail('git is needed to download it');
    rail.hint(
      process.platform === 'darwin' ? 'Install it with: xcode-select --install' : 'Install it, e.g. sudo apt install git',
    );
    return false;
  }
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  if (!fs.existsSync(path.join(MUSIC_DIR, '.git'))) {
    if ((await git(['init', '-q'])) === null || (await git(['remote', 'add', 'origin', REPO])) === null) {
      task.fail(`couldn't create a git repository in ${shown(MUSIC_DIR)}`);
      return false;
    }
  }
  task.update(`downloading commit ${COMMIT.slice(0, 7)}`);
  let step = await runStep(task, 'git', ['-C', MUSIC_DIR, 'fetch', '--depth', '1', 'origin', COMMIT]);
  if (step.code === 0) {
    step = await runStep(task, 'git', ['-C', MUSIC_DIR, '-c', 'advice.detachedHead=false', 'checkout', '--force', COMMIT]);
  }
  if (step.code !== 0 || (await git(['rev-parse', 'HEAD'])) !== COMMIT) {
    stepFailed(task, 'download failed', step.tail);
    return false;
  }
  task.done(`commit ${COMMIT.slice(0, 7)}`);
  return true;
}

/** Move the old install's models into engines/music/checkpoints, keeping any that are already there. */
function moveModels(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from)) {
    if (!fs.existsSync(path.join(to, entry))) movePath(path.join(from, entry), path.join(to, entry));
  }
  if (fs.readdirSync(from).length === 0) fs.rmdirSync(from);
}

/** The planning model ACE-Step picks for this machine's memory (it would otherwise fetch it on its first start). */
async function recommendedLm(): Promise<string | null> {
  const script = [
    'from acestep.gpu_config import get_gpu_config, get_recommended_lm_model',
    'config = get_gpu_config()',
    'print("LM=" + ((get_recommended_lm_model(config) or "") if config.init_lm_default else ""))',
  ].join('\n');
  const out = await output(MUSIC_PYTHON, ['-c', script], { cwd: MUSIC_DIR, timeout: 120000 });
  return out?.match(/^LM=(.*)$/m)?.[1].trim() || null;
}

/** The parts of ACE-Step's main model (checkpoints/*), and where downloads in progress go. */
const MAIN_PARTS = ['acestep-v15-turbo', 'vae', 'Qwen3-Embedding-0.6B', 'acestep-5Hz-lm-1.7B', '.cache'];

/** Install or repair the music engine; only the missing parts are done. */
export async function installMusic(opts: { moveModelsFrom: string | null }): Promise<boolean> {
  const needs = await musicNeeds();
  if (needs.checkout) {
    if (!(await checkout())) return false;
  } else {
    rail.done('ACE-Step 1.5', `commit ${COMMIT.slice(0, 7)}`);
  }
  const checkpoints = path.join(MUSIC_DIR, 'checkpoints');
  if (opts.moveModelsFrom && fs.existsSync(opts.moveModelsFrom)) {
    moveModels(opts.moveModelsFrom, checkpoints);
    rail.done('Models', `moved from ${shown(opts.moveModelsFrom)}, no download needed`);
  }

  // Always synced: it takes a second when nothing's missing, and finishes an install that was stopped halfway.
  if (!(await ensureUv())) return false;
  const venv = path.join(MUSIC_DIR, '.venv');
  if (fs.existsSync(venv) && !venvIsOurs(venv)) fs.rmSync(venv, { recursive: true, force: true });
  const task = new Task('Python packages');
  const uv = uvReporter(task);
  const step = await runStep(task, UV_BIN, ['sync', '--locked', '--no-build'], {
    cwd: MUSIC_DIR,
    env: uvEnv(),
    onLine: uv.onLine,
  });
  if (step.code !== 0) {
    stepFailed(task, 'install failed', step.tail);
    return false;
  }
  task.done(uv.summary());

  const env = engineEnv(MUSIC_DIR);
  const download = path.join(MUSIC_DIR, '.venv', 'bin', 'acestep-download');
  if (engineInstalled()) {
    if (!opts.moveModelsFrom) rail.done('Models', 'downloaded');
  } else {
    const task = new Task('Models');
    const total = await hfRepoSize('ACE-Step/Ace-Step1.5');
    const step = await runStep(task, download, [], {
      cwd: MUSIC_DIR,
      env,
      watch: { paths: MAIN_PARTS.map((p) => path.join(checkpoints, p)), total },
    });
    if (step.code !== 0 || !engineInstalled()) {
      stepFailed(task, 'download failed · run ./kite setup again to resume', step.tail);
      return false;
    }
    task.done(total ? formatSize(total) : '');
  }

  // ACE-Step fetches a larger planning model on its first start when there's memory for it; get it now instead.
  if (needs.models || opts.moveModelsFrom) {
    const task = new Task('Planning model');
    task.update('checking what fits this machine');
    const lm = await recommendedLm();
    if (!lm || fs.existsSync(path.join(checkpoints, lm))) {
      task.done(lm ?? 'the included one');
    } else {
      const total = await hfRepoSize(`ACE-Step/${lm}`);
      const step = await runStep(task, download, ['--model', lm, '--skip-main'], {
        cwd: MUSIC_DIR,
        env,
        watch: { paths: [path.join(checkpoints, lm)], total },
      });
      if (step.code === 0) task.done(`${lm}${total ? ` · ${formatSize(total)}` : ''}`);
      else task.warn(`${lm} didn't download; the engine fetches it on its first start`);
    }
  }
  return true;
}

export function removeMusic(): void {
  fs.rmSync(MUSIC_DIR, { recursive: true, force: true });
}

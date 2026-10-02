// Things ./kite does on this machine: paths as the user types them, disk and memory, moving folders,
// opening links, and running other programs. (How the output looks is in ui.ts.)
import { execFile, spawn, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from '../config';

const execFileAsync = promisify(execFile);

/** A path as the user would type it: relative inside the app folder, ~/… in the home folder. */
export function shown(p: string): string {
  const rel = path.relative(ROOT, p);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

/** Disk space a file or folder takes (0 when it doesn't exist). */
export async function diskUsage(p: string): Promise<number> {
  if (!fs.existsSync(p)) return 0;
  try {
    const { stdout } = await execFileAsync('du', ['-sk', p], { maxBuffer: 1024 * 1024 });
    return Number(stdout.split(/\s/)[0]) * 1024;
  } catch (e) {
    // du exits non-zero when it can't read something (a file that just vanished), but still prints the total.
    const out = (e as { stdout?: string }).stdout ?? '';
    return Number(out.split(/\s/)[0]) * 1024 || 0;
  }
}

/** Free space on the disk that holds `p` (or its nearest existing parent). */
export function freeSpace(p: string): number | null {
  let dir = p;
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  try {
    const stats = fs.statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

export const memoryGb = () => Math.round(os.totalmem() / 1024 ** 3);

/** Move a file or folder: a rename on the same disk; on another disk, a copy (symlinks kept as they are) and a delete. */
export function movePath(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/** Open a web page in the default browser; false when there's no browser to open (e.g. over SSH). */
export function openUrl(url: string): boolean {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'linux' && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
        ? 'xdg-open'
        : null;
  if (!command) return false;
  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Run a program in the foreground (its output shown, it may ask questions); resolves to its exit code. */
export function run(command: string, args: string[], options: SpawnOptions = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', () => resolve(127));
    child.on('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** A program's trimmed output, or null when it fails or isn't installed. */
export async function output(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024, ...options });
    return stdout.trim();
  } catch {
    return null;
  }
}

export const hasCommand = async (command: string) => (await output('sh', ['-c', 'command -v "$1"', 'sh', command])) !== null;

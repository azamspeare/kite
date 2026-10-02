// Programs setup runs (npm, git, uv, the model downloaders) shown as single steps on the rail: their output goes to
// .kite/logs/setup.log, and the terminal shows one line with a spinner, what's happening, or a progress bar.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { LOG_DIR } from '../config';
import { diskUsage, shown } from './term';
import { rail, type Task } from './ui';

export const SETUP_LOG = path.join(LOG_DIR, 'setup.log');

export function startSetupLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  // On a fresh clone the launcher has already logged `npm ci` there.
  if (process.env.KITE_NPM_INSTALLED === undefined) {
    fs.writeFileSync(SETUP_LOG, `./kite setup, ${new Date().toString()}\n`);
  }
}

export interface StepOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Each line of output (without colors), e.g. to show what the program is doing with task.update(). */
  onLine?: (line: string) => void;
  /** Download progress: the bytes on disk under these paths, out of `total` (null: unknown). */
  watch?: { paths: string[]; total: number | null };
}

/** The program running as a step now, in its own process group, so Ctrl+C can end it (and what it started). */
let current: number | null = null;

export function stopCurrentStep() {
  if (!current) return;
  try {
    process.kill(-current, 'SIGTERM');
  } catch {
    // already gone
  }
  current = null;
}

// However setup ends (even a crash), a download it started doesn't carry on in the background.
process.on('exit', stopCurrentStep);

/** Run a program as one step; resolves to its exit code and its last lines of output. */
export function runStep(
  task: Task,
  command: string,
  args: string[],
  opts: StepOptions = {},
): Promise<{ code: number; tail: string[] }> {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.createWriteStream(SETUP_LOG, { flags: 'a' });
  log.write(`\n$ ${[command, ...args].join(' ')}${opts.cwd ? `   (in ${shown(opts.cwd)})` : ''}\n`);
  const tail: string[] = [];
  let partial = '';
  const take = (chunk: Buffer) => {
    log.write(chunk);
    const lines = (partial + chunk.toString('utf8')).split(/\r\n|\r|\n/);
    partial = lines.pop() ?? '';
    for (const raw of lines) {
      const line = stripVTControlCharacters(raw).trim();
      if (!line) continue;
      tail.push(line);
      if (tail.length > 40) tail.shift();
      opts.onLine?.(line);
    }
  };
  let watcher: NodeJS.Timeout | null = null;
  if (opts.watch) {
    const { paths, total } = opts.watch;
    const poll = async () =>
      task.progress(
        (await Promise.all(paths.map(diskUsage))).reduce((a, b) => a + b, 0),
        total,
      );
    void poll();
    watcher = setInterval(() => void poll(), 1000);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      current = null;
      if (watcher) clearInterval(watcher);
      const rest = stripVTControlCharacters(partial).trim();
      if (rest) tail.push(rest);
      log.end(`\n[exit ${code}]\n`);
      resolve({ code, tail });
    };
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    current = child.pid ?? null;
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => {
      tail.push(`Could not run ${command}: ${e.message}`);
      finish(127);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

/** A step that failed: its last lines of output, and where the whole log is. */
export function stepFailed(task: Task, message: string, tail: string[]) {
  task.fail(message);
  rail.output(tail.slice(-8));
  rail.hint(`The whole log: ${shown(SETUP_LOG)}`);
}

/** Follows uv's output: what it's downloading or building, and how many packages it installed. */
export function uvReporter(task: Task) {
  let summary = '';
  return {
    onLine(line: string) {
      let m: RegExpExecArray | null;
      if ((m = /^Downloading (\S+).*\(([\d.]+)\s*([KMG]i?B)\)$/.exec(line))) {
        const name = m[1].startsWith('cpython-') ? `Python ${m[1].split('-')[1]}` : m[1];
        task.update(`downloading ${name} (${m[2]} ${m[3]})`);
      } else if ((m = /^Building (\S+)/.exec(line))) task.update(`building ${m[1]}`);
      else if (/^Creating virtual environment/.test(line)) task.update('creating the environment');
      else if ((m = /^Resolved (\d+) packages?/.exec(line))) task.update(`${m[1]} packages`);
      else if ((m = /^Installed (\d+) packages?/.exec(line))) summary = `${m[1]} installed`;
      else if ((m = /^Audited (\d+) packages?/.exec(line)) && !summary) summary = 'up to date';
    },
    summary: () => summary,
  };
}

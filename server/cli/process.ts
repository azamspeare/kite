// Background processes started by ./kite: PID files, "is it still ours?", memory, logs,
// waiting until a service is ready, and stopping it again.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PidInfo {
  pid: number;
  startedAt: number;
  url: string;
  host?: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function readPid(file: string): PidInfo | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PidInfo;
  } catch {
    return null;
  }
}

export function writePid(file: string, info: PidInfo) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(info));
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Only treat the PID as ours if its command line still looks like the service (PIDs get reused). */
export async function commandMatches(pid: number, pattern: RegExp): Promise<boolean> {
  if (!alive(pid)) return false;
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)]);
    return pattern.test(stdout);
  } catch {
    return false;
  }
}

/** Resident memory of a process and all its descendants, in MB. */
export async function treeMemoryMb(root: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,rss=']);
    const children = new Map<number, number[]>();
    const rss = new Map<number, number>();
    for (const line of stdout.trim().split('\n')) {
      const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
      rss.set(pid, kb);
      children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    }
    let total = 0;
    const stack = [root];
    while (stack.length) {
      const p = stack.pop()!;
      total += rss.get(p) ?? 0;
      stack.push(...(children.get(p) ?? []));
    }
    return Math.round(total / 1024);
  } catch {
    return null;
  }
}

export function tail(file: string, lines: number): string {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .slice(-lines - 1)
      .join('\n');
  } catch {
    return '';
  }
}

/** Where a service is while starting: its current phase, or a problem that means it will never be ready. */
export type Probe = { phase: string; ready: boolean; fatal?: string };

export type WaitResult =
  { outcome: 'ready' | 'exited' | 'timeout'; seconds: number } | { outcome: 'failed'; seconds: number; fatal: string };

/** Poll until a service is ready (or exits, or can never be ready), reporting each phase. */
export async function waitFor(opts: {
  pid: number | null;
  timeoutMs: number;
  probe: () => Promise<Probe>;
  onPhase: (phase: string, seconds: number) => void;
}): Promise<WaitResult> {
  const started = Date.now();
  const seconds = () => (Date.now() - started) / 1000;
  while (Date.now() - started < opts.timeoutMs) {
    if (opts.pid && !alive(opts.pid)) return { outcome: 'exited', seconds: seconds() };
    const probe = await opts.probe();
    if (probe.ready) return { outcome: 'ready', seconds: seconds() };
    if (probe.fatal) return { outcome: 'failed', seconds: seconds(), fatal: probe.fatal };
    opts.onPhase(probe.phase, seconds());
    await sleep(1000);
  }
  return { outcome: 'timeout', seconds: seconds() };
}

/** End a process group started with `detached: true` (SIGTERM, then SIGKILL after 15 s). */
export async function stopGroup(pid: number) {
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // Not a group leader (or already gone): signal just the process.
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
  };
  signalGroup('SIGTERM');
  for (let i = 0; i < 30 && alive(pid); i++) await sleep(500);
  if (alive(pid)) {
    signalGroup('SIGKILL');
    await sleep(500);
  }
}

/** Print the end of a log, or follow it (Ctrl+C to stop). */
export function showLogs(file: string, follow: boolean) {
  if (!follow) {
    console.log(tail(file, 60));
    return;
  }
  spawn('tail', ['-n', '60', '-f', file], { stdio: 'inherit' });
}

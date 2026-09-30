// Manage the local ACE-Step music engine:
//   npm run music start [--no-wait]   start in the background and wait until the models are loaded
//   npm run music stop                stop the engine this CLI started
//   npm run music restart
//   npm run music status
//   npm run music logs [-f]
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ACESTEP_DIR, MUSIC_STATE_DIR, MUSIC_URL, UV_BIN } from '../config';
import { engineHealth, engineInstalled, isLocalUrl, musicApiKey } from './engine';

const execFileAsync = promisify(execFile);
const PID_FILE = path.join(MUSIC_STATE_DIR, 'music-engine.pid');
const LOG_FILE = path.join(MUSIC_STATE_DIR, 'music-engine.log');

interface PidInfo {
  pid: number;
  startedAt: number;
  url: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readPid(): PidInfo | null {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, 'utf8')) as PidInfo;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Only treat the PID as ours if it's still the engine (PIDs get reused). */
async function isEngineProcess(pid: number): Promise<boolean> {
  if (!alive(pid)) return false;
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)]);
    return /acestep-api|acestep\.api_server/.test(stdout) || /\buv\b.*run/.test(stdout);
  } catch {
    return false;
  }
}

async function treeMemoryMb(root: number): Promise<number | null> {
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

function tail(file: string, lines: number): string {
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

async function waitUntilReady(pid: number | null, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  let lastPhase = '';
  while (Date.now() - started < timeoutMs) {
    if (pid && !alive(pid)) {
      console.error('\nThe engine exited while starting. Last log lines:\n');
      console.error(tail(LOG_FILE, 15));
      return false;
    }
    const h = await engineHealth();
    const phase = !h ? 'starting' : h.initialized ? 'ready' : 'loading models';
    if (phase !== lastPhase) {
      process.stdout.write(`${lastPhase ? '\n' : ''}  ${phase}…`);
      lastPhase = phase;
    } else {
      process.stdout.write('.');
    }
    if (h?.initialized) {
      console.log(` (${Math.round((Date.now() - started) / 1000)}s)`);
      return true;
    }
    await sleep(1500);
  }
  console.error(`\nNot ready after ${Math.round(timeoutMs / 1000)}s — check \`npm run music logs\`.`);
  return false;
}

async function start(wait: boolean) {
  if (!isLocalUrl(MUSIC_URL)) {
    console.log(`The engine is configured at ${MUSIC_URL} (another machine); start it there.`);
    return status();
  }
  const health = await engineHealth();
  if (health) {
    console.log(`Already running at ${MUSIC_URL}${health.initialized ? '' : ' (still loading models)'}.`);
    return;
  }
  if (!engineInstalled()) {
    console.error(`ACE-Step isn't installed in ${ACESTEP_DIR}. See README → "Music engine".`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(MUSIC_STATE_DIR, { recursive: true, mode: 0o700 });
  const log = fs.openSync(LOG_FILE, 'w');
  const port = new URL(MUSIC_URL).port || '8001';
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  const child = spawn(UV_BIN, ['run', '--no-sync', 'acestep-api', '--host', '127.0.0.1', '--port', port], {
    cwd: ACESTEP_DIR,
    // Own process group, so `stop` can end uv and the Python server together.
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      ACESTEP_API_KEY: musicApiKey(),
      ...(appleSilicon ? { ACESTEP_LM_BACKEND: 'mlx' } : {}),
      ACESTEP_INIT_LLM: 'auto',
      // Load models at startup, so "ready" really means ready.
      ACESTEP_NO_INIT: 'false',
      TOKENIZERS_PARALLELISM: 'false',
      PYTHONUNBUFFERED: '1',
    },
  });
  child.unref();
  fs.closeSync(log);
  if (!child.pid) {
    console.error(`Could not start ${UV_BIN}. Is uv installed and on your PATH?`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, startedAt: Date.now(), url: MUSIC_URL } satisfies PidInfo));
  console.log(`Music engine starting (pid ${child.pid}) at ${MUSIC_URL}`);
  console.log(`Log: ${LOG_FILE}`);
  if (wait && !(await waitUntilReady(child.pid, 10 * 60 * 1000))) process.exitCode = 1;
  else if (wait) console.log('Ready. Storyboard offers the music tools to Claude from its next message.');
}

async function stop() {
  const info = readPid();
  if (!info || !(await isEngineProcess(info.pid))) {
    if (info) fs.rmSync(PID_FILE, { force: true });
    if (await engineHealth()) {
      console.log(`An engine is answering at ${MUSIC_URL}, but it wasn't started by this CLI, so it was left running.`);
      process.exitCode = 1;
    } else {
      console.log('The music engine is not running.');
    }
    return;
  }
  process.stdout.write(`Stopping the music engine (pid ${info.pid})…`);
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-info.pid, signal);
    } catch {
      // already gone
    }
  };
  signalGroup('SIGTERM');
  for (let i = 0; i < 30 && alive(info.pid); i++) await sleep(500);
  if (alive(info.pid)) {
    signalGroup('SIGKILL');
    await sleep(500);
  }
  fs.rmSync(PID_FILE, { force: true });
  console.log(' stopped.');
}

async function status() {
  const h = await engineHealth();
  const info = readPid();
  const ours = info && (await isEngineProcess(info.pid)) ? info : null;
  const state = !h ? 'stopped' : h.initialized ? 'running' : 'loading models';
  console.log(`State    ${state}`);
  console.log(`URL      ${MUSIC_URL}${isLocalUrl(MUSIC_URL) ? '' : ' (remote)'}`);
  if (h) console.log(`Models   ${h.model ?? '—'}${h.lmModel ? ` + ${h.lmModel}` : ''}`);
  if (ours) {
    const mem = await treeMemoryMb(ours.pid);
    const minutes = Math.round((Date.now() - ours.startedAt) / 60000);
    console.log(`Process  pid ${ours.pid}, up ${minutes} min${mem !== null ? `, ${(mem / 1024).toFixed(1)} GB memory` : ''}`);
  } else if (h && isLocalUrl(MUSIC_URL)) {
    console.log('Process  not started by this CLI');
  }
  if (isLocalUrl(MUSIC_URL)) console.log(`Install  ${ACESTEP_DIR}${engineInstalled() ? '' : ' (missing)'}`);
  console.log(`Log      ${LOG_FILE}`);
}

function logs(follow: boolean) {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('No log yet — start the engine with `npm run music start`.');
    return;
  }
  if (!follow) {
    console.log(tail(LOG_FILE, 60));
    return;
  }
  spawn('tail', ['-n', '60', '-f', LOG_FILE], { stdio: 'inherit' });
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  switch (command) {
    case 'start':
      return start(!flags.includes('--no-wait'));
    case 'stop':
      return stop();
    case 'restart':
      await stop();
      return start(!flags.includes('--no-wait'));
    case 'status':
      return status();
    case 'logs':
      return logs(flags.includes('-f') || flags.includes('--follow'));
    default:
      console.log('Usage: npm run music <start|stop|restart|status|logs> [--no-wait] [-f]');
      process.exitCode = command ? 1 : 0;
  }
}

void main();

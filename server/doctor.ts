// Checks that everything Storyboard needs is in place:  npm run doctor
// Exits with 1 while something required is missing, so agents can use it as a setup gate.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { BASE_URL, CLAUDE_BIN, FFMPEG, HOST, MUSIC_URL, PORT, PROJECTS_DIR, ROOT } from './config';
import { engineHealth, engineInstalled, isLocalUrl } from './music/engine';

const execFileAsync = promisify(execFile);

interface Check {
  /** fail: Storyboard can't work until it's fixed · warn: works, with a caveat · info: optional extras. */
  level: 'ok' | 'fail' | 'warn' | 'info';
  label: string;
  fix?: string;
}

let alreadyRunning = false;

function checkNode(): Check {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12)
    ? { level: 'ok', label: `Node.js ${process.versions.node}` }
    : {
        level: 'fail',
        label: `Node.js ${process.versions.node} is too old`,
        fix: 'Install Node.js 22.12 or newer (`nvm install` reads .nvmrc)',
      };
}

async function checkFfmpeg(): Promise<Check> {
  let version: string;
  try {
    const { stdout } = await execFileAsync(FFMPEG, ['-version']);
    version = stdout.match(/ffmpeg version (\S+)/)?.[1] ?? '';
  } catch {
    return {
      level: 'fail',
      label: `ffmpeg not found (${FFMPEG})`,
      fix: 'macOS: `brew install ffmpeg` · Debian/Ubuntu: `sudo apt install ffmpeg` · or set FFMPEG_PATH',
    };
  }
  // Renders are H.264 with AAC audio.
  const { stdout: encoders } = await execFileAsync(FFMPEG, ['-hide_banner', '-encoders'], { maxBuffer: 8 * 1024 * 1024 });
  const missing = ['libx264', 'aac'].filter((name) => !new RegExp(`\\s${name}\\s`).test(encoders));
  return missing.length
    ? {
        level: 'fail',
        label: `ffmpeg ${version} has no ${missing.join(' or ')} encoder`,
        fix: 'Install an ffmpeg build that includes libx264 (e.g. `brew install ffmpeg`)',
      }
    : { level: 'ok', label: `ffmpeg ${version}` };
}

async function checkChromium(): Promise<Check> {
  try {
    const browser = await chromium.launch();
    const version = browser.version();
    await browser.close();
    return { level: 'ok', label: `Headless Chromium ${version}` };
  } catch (e) {
    const message = (e as Error).message;
    if (/Executable doesn't exist/i.test(message)) {
      return { level: 'fail', label: 'Headless Chromium is not installed', fix: 'npm run setup' };
    }
    return {
      level: 'fail',
      label: `Headless Chromium does not start: ${message.split('\n')[0]}`,
      fix:
        process.platform === 'linux'
          ? 'Install its system libraries: `npm run setup -- --with-deps` (asks for sudo)'
          : 'npm run setup',
    };
  }
}

async function checkClaude(): Promise<Check> {
  let version: string;
  try {
    const { stdout } = await execFileAsync(CLAUDE_BIN, ['--version'], { timeout: 15000 });
    version = stdout.match(/\d+\.\d+\.\d+\S*/)?.[0] ?? stdout.trim();
  } catch {
    return {
      level: 'fail',
      label: `Claude Code not found (${CLAUDE_BIN})`,
      fix: 'Install it from https://code.claude.com, then run `claude` and /login (or set CLAUDE_PATH)',
    };
  }
  // The same environment the in-app agent gets (agents/claudeCode.ts): your login, not ANTHROPIC_API_KEY.
  const env = { ...process.env };
  if (!process.env.STORYBOARD_USE_API_KEY) delete env.ANTHROPIC_API_KEY;
  let output = '';
  try {
    output = (await execFileAsync(CLAUDE_BIN, ['auth', 'status', '--json'], { timeout: 15000, env })).stdout;
  } catch (e) {
    // Exits with 1 when logged out, still printing the status.
    output = (e as { stdout?: string }).stdout ?? '';
  }
  let status: { loggedIn?: boolean; authMethod?: string } | null = null;
  try {
    status = JSON.parse(output);
  } catch {
    status = null;
  }
  if (!status) {
    return {
      level: 'warn',
      label: `Claude Code ${version} (could not check the login)`,
      fix: 'If the chat says "Not logged in", run `claude` in a terminal and use /login',
    };
  }
  return status.loggedIn
    ? { level: 'ok', label: `Claude Code ${version}, logged in${status.authMethod ? ` (${status.authMethod})` : ''}` }
    : { level: 'fail', label: `Claude Code ${version} is not logged in`, fix: 'Run `claude` in a terminal and use /login' };
}

async function checkPort(): Promise<Check> {
  const free = await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(PORT, HOST, () => server.close(() => resolve(true)));
  });
  if (free) return { level: 'ok', label: `Port ${PORT} is free` };
  alreadyRunning = await fetch(`${BASE_URL}/api/info`, { signal: AbortSignal.timeout(2000) })
    .then(async (res) => res.ok && 'projectsDir' in ((await res.json()) as object))
    .catch(() => false);
  return alreadyRunning
    ? { level: 'info', label: `Storyboard is already running at ${BASE_URL}` }
    : { level: 'warn', label: `Port ${PORT} is used by another program`, fix: 'Start on another port: `PORT=5299 npm run dev`' };
}

function checkProjects(): Check {
  const rel = path.relative(ROOT, PROJECTS_DIR);
  const shown = rel.startsWith('..') || path.isAbsolute(rel) ? PROJECTS_DIR : `./${rel}`;
  try {
    const count = fs.readdirSync(PROJECTS_DIR).filter((d) => fs.existsSync(path.join(PROJECTS_DIR, d, 'project.json'))).length;
    return { level: 'info', label: `Projects in ${shown} (${count})` };
  } catch {
    return { level: 'info', label: `Projects in ${shown} (created on first start)` };
  }
}

async function checkMusic(): Promise<Check> {
  const health = await engineHealth();
  if (health) {
    return {
      level: 'info',
      label: `Music engine (optional): ${health.initialized ? 'running' : 'loading models'} at ${MUSIC_URL}`,
    };
  }
  return isLocalUrl(MUSIC_URL) && !engineInstalled()
    ? { level: 'info', label: 'Music engine (optional): not installed, see README → "Music engine"' }
    : { level: 'info', label: 'Music engine (optional): stopped, start it with `npm run music start`' };
}

const MARKS = { ok: '✓', fail: '✗', warn: '!', info: '•' };
const COLORS = { ok: 32, fail: 31, warn: 33, info: 90 };
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

async function main() {
  console.log('\nStoryboard doctor\n');
  const checks = await Promise.all([
    checkNode(),
    checkFfmpeg(),
    checkChromium(),
    checkClaude(),
    checkPort(),
    checkProjects(),
    checkMusic(),
  ]);
  for (const check of checks) {
    console.log(`  ${paint(COLORS[check.level], MARKS[check.level])} ${check.label}`);
    if (check.fix) console.log(`    ${paint(90, '→')} ${check.fix}`);
  }
  const failed = checks.filter((c) => c.level === 'fail').length;
  if (failed) {
    console.log(`\n${failed} problem${failed === 1 ? '' : 's'} to fix, then run \`npm run doctor\` again.\n`);
    process.exitCode = 1;
  } else {
    console.log(
      alreadyRunning
        ? `\nReady. Storyboard is running at ${BASE_URL}\n`
        : `\nReady. Start it with \`npm run dev\`, then open ${BASE_URL}\n`,
    );
  }
}

void main();

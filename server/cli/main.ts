// ./storyboard <command>: set up and run Storyboard. The `storyboard` script in the repo root makes sure Node.js and
// the npm dependencies are there, then runs this file.
import { doctor } from '../doctor';
import { parseServices, parseSetup } from './args';
import { defaultServices, logs, restart, SERVICES, start, status, stop } from './services';
import { setup } from './setup';
import { holdInput, releaseInput, setCancelHandler } from './input';
import { BAR, bold, cyan, dim, gray, rail, stopLive, yellow } from './ui';

const COMMANDS: [command: string, what: string][] = [
  ['setup', 'Install Storyboard, or change what it uses'],
  ['start', 'Start it, and the engines you turned on'],
  ['stop', 'Stop what ./storyboard start started'],
  ['restart', 'Stop, then start again'],
  ['status', 'What’s on, installed and running'],
  ['logs [-f]', 'Show the log (-f keeps following it)'],
  ['doctor', 'Check everything Storyboard needs'],
];

function help() {
  rail.open('Storyboard', 'Prompt-driven motion design. Usage: ./storyboard <command>');
  rail.gap();
  for (const [command, what] of COMMANDS) console.log(`${BAR}  ${cyan(command.padEnd(12))}${what}`);
  rail.gap();
  console.log(`${BAR}  ${dim('start, stop, restart and logs also take a service: app, music or sfx')}`);
  console.log(
    `${BAR}  ${dim('logs setup shows the last setup · setup --yes [--provider=claude-code|codex] [--music=on|off] [--sfx=on|off] asks nothing')}`,
  );
  console.log(`${BAR}  ${dim('setup --host=0.0.0.0 --port=5299 saves the bind address and port (--ip is an alias for --host)')}`);
  console.log(`${gray('└')}  ${bold('Start here:')} ${cyan('./storyboard setup')}\n`);
}

function usage(message: string): number {
  console.error(`\n${message}`);
  help();
  return 1;
}

async function main(): Promise<number> {
  const [command = 'help', ...args] = process.argv.slice(2);
  const names = args.filter((a) => !a.startsWith('-'));
  if (command === 'logs' && names[0] === 'setup') {
    await logs('setup', args.includes('-f') || args.includes('--follow'));
    return 0;
  }
  const named = parseServices(args);
  if (['start', 'stop', 'restart', 'logs'].includes(command) && !named) {
    return usage(`Unknown service: ${names.join(' ')} (use app, music or sfx)`);
  }
  const ids = named?.length ? named : null;
  switch (command) {
    case 'setup': {
      const opts = parseSetup(args);
      return opts
        ? (await setup(opts))
          ? 0
          : 1
        : usage(`Invalid setup option: ${args.join(' ')} (host: IP address or localhost; port: 1–65535)`);
    }
    case 'start':
    case 'restart': {
      const targets = ids ?? defaultServices();
      if (!targets) {
        rail.open('Storyboard');
        rail.close(`Not set up yet · run ${cyan('./storyboard setup')} first`, 'warn');
        return 1;
      }
      // Ctrl+C only stops the waiting; the services keep starting in the background.
      setCancelHandler(() => {
        try {
          stopLive();
          releaseInput();
          console.log(
            `${BAR}\n${yellow('■')}  Stopped waiting ${dim('· they keep starting in the background: ./storyboard status')}\n`,
          );
        } catch {
          // the terminal window was closed
        }
        process.exit(130);
      });
      holdInput();
      try {
        return (command === 'restart' ? await restart(ids ?? SERVICES, targets) : await start(targets)) ? 0 : 1;
      } finally {
        releaseInput();
      }
    }
    case 'stop':
      await stop(ids ?? SERVICES, { quiet: !ids });
      return 0;
    case 'status':
      await status();
      return 0;
    case 'logs':
      await logs(ids?.[0] ?? 'app', args.includes('-f') || args.includes('--follow'));
      return 0;
    case 'doctor':
      return doctor();
    case 'help':
    case '--help':
    case '-h':
      help();
      return 0;
    default:
      return usage(`Unknown command: ${command}`);
  }
}

main().then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);

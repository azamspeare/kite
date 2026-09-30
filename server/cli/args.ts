// Command-line arguments of ./storyboard.
import type { ServiceId } from './services';
import type { SetupOptions } from './setup';

const SERVICES: ServiceId[] = ['app', 'music', 'sfx'];

/** The services named on the command line (options skipped); null when one isn't a service. */
export function parseServices(args: string[]): ServiceId[] | null {
  const names = args.filter((a) => !a.startsWith('-'));
  if (names.includes('all')) return [...SERVICES];
  const ids = names.map((n) => (n === 'storyboard' ? 'app' : n));
  return ids.every((id): id is ServiceId => (SERVICES as string[]).includes(id)) ? [...new Set(ids)] : null;
}

/** `setup --yes --music=on --sfx=off`; null for anything else. */
export function parseSetup(args: string[]): SetupOptions | null {
  const opts: SetupOptions = { yes: false };
  for (const arg of args) {
    const flag = /^--(music|sfx)=(on|off|yes|no|true|false)$/.exec(arg);
    if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (flag) opts[flag[1] as 'music' | 'sfx'] = ['on', 'yes', 'true'].includes(flag[2]);
    else return null;
  }
  return opts;
}

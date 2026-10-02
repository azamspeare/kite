// Command-line arguments of ./kite.
import type { ServiceId } from './services';
import type { SetupOptions } from './setup';
import { validHost, validPort } from '../network';

const SERVICES: ServiceId[] = ['app', 'music', 'sfx'];

/** The services named on the command line (options skipped); null when one isn't a service. */
export function parseServices(args: string[]): ServiceId[] | null {
  const names = args.filter((a) => !a.startsWith('-'));
  if (names.includes('all')) return [...SERVICES];
  const ids = names.map((n) => (n === 'kite' ? 'app' : n));
  return ids.every((id): id is ServiceId => (SERVICES as string[]).includes(id)) ? [...new Set(ids)] : null;
}

/** `setup --yes --music=on --sfx=off`; null for anything else. */
export function parseSetup(args: string[]): SetupOptions | null {
  const opts: SetupOptions = { yes: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const network = /^--(host|ip|port)(?:=(.*))?$/.exec(arg);
    if (network) {
      const value = network[2] ?? args[++i];
      if (network[1] === 'port') {
        if (!value || !/^\d+$/.test(value) || !validPort(Number(value))) return null;
        opts.port = Number(value);
      } else {
        if (!validHost(value)) return null;
        opts.host = value;
      }
      continue;
    }
    const flag = /^--(music|sfx)=(on|off|yes|no|true|false)$/.exec(arg);
    if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--provider=claude-code' || arg === '--provider=codex')
      opts.provider = arg.slice('--provider='.length) as SetupOptions['provider'];
    else if (flag) opts[flag[1] as 'music' | 'sfx'] = ['on', 'yes', 'true'].includes(flag[2]);
    else return null;
  }
  return opts;
}

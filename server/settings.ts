import fs from 'node:fs';
import path from 'node:path';
import { SETTINGS_FILE } from './paths';
import { validHost, validPort, type NetworkSettings } from './network';
import type { AgentProviderId } from '../src/shared/agents';

/** Choices made in `./kite setup`. */
export interface Settings extends NetworkSettings {
  music: boolean;
  sfx: boolean;
  provider?: AgentProviderId;
}

/** null until setup has run. */
export function readSettings(file = SETTINGS_FILE): Settings | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Settings>;
    return {
      music: raw.music === true,
      sfx: raw.sfx === true,
      ...(validHost(raw.host) ? { host: raw.host } : {}),
      ...(validPort(raw.port) ? { port: raw.port } : {}),
      ...(raw.provider === 'claude-code' || raw.provider === 'codex' ? { provider: raw.provider } : {}),
    };
  } catch {
    return null;
  }
}

export function preferredProvider(): AgentProviderId | undefined {
  const env = process.env.KITE_PROVIDER;
  if (!env) return readSettings()?.provider;
  if (env === 'claude-code' || env === 'codex') return env;
  throw new Error('KITE_PROVIDER must be claude-code or codex');
}

export function writeSettings(settings: Settings, file = SETTINGS_FILE) {
  if (settings.host !== undefined && !validHost(settings.host)) throw new Error('Invalid bind address');
  if (settings.port !== undefined && !validPort(settings.port)) throw new Error('Invalid port');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

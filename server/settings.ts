import fs from 'node:fs';
import path from 'node:path';
import { SETTINGS_FILE } from './config';

/** The optional parts turned on in `./storyboard setup`. */
export interface Settings {
  music: boolean;
  sfx: boolean;
}

/** null until setup has run. */
export function readSettings(): Settings | null {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<Settings>;
    return { music: raw.music === true, sfx: raw.sfx === true };
  } catch {
    return null;
  }
}

export function writeSettings(settings: Settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCAL_DIR = path.join(ROOT, '.storyboard');
export const SETTINGS_FILE = path.join(LOCAL_DIR, 'settings.json');

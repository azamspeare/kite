import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SoundInfo } from '../../src/shared/types';
import type { ProjectStore } from '../projects';
import { HttpError, KeyedMutex, readJson, writeFileAtomic, writeJson } from '../util';
import { SOUND_SAMPLE_RATE, decodeFile, decodeWav, encodeWav, type Stereo } from './audio';
import { measureSound, type SoundMeasure } from './measure';
import { SYNTH_VERSION, isPreset, normalizeParams, synthesize, type PresetName, type SynthParams } from './synth';

/** Names Claude gives the sounds it makes (files you add keep their own names). */
export const SOUND_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const AUDIO_FILE = /\.(wav|wave|mp3|m4a|aac|flac|ogg|oga|opus|aif|aiff|aifc|caf|webm)$/i;
const INDEX_FILE = 'sounds.json';
const GENERATED_DIR = 'generated';

export interface SynthRecipe {
  preset: PresetName;
  params: Required<SynthParams>;
}

export interface GeneratedMeta {
  /** Relative to sounds/. */
  file: string;
  prompt: string;
  seed: number;
  model: string;
}

/** sounds/sounds.json: the sounds Claude made (tracked by undo, so a turn's sounds come and go with it). */
interface SoundIndex {
  sounds: Record<string, { synth?: SynthRecipe; generated?: GeneratedMeta; createdAt: number }>;
}

/** The largest audio file that becomes a sound effect; longer audio is a soundtrack. */
export const MAX_SOUND_BYTES = 50 * 1024 * 1024;

export interface LibrarySound {
  name: string;
  source: SoundInfo['source'];
  /** Changes whenever the audio would change (recipe, file contents). */
  hash: string;
  synth?: SynthRecipe;
  generated?: GeneratedMeta;
  /** The file behind a 'file' or 'generated' sound, relative to sounds/. */
  file?: string;
  measure: SoundMeasure;
}

interface Prepared {
  /** 48 kHz stereo float WAV the preview loads and the mixer reads. */
  wav: string;
  measure: SoundMeasure;
}

const sha = (text: string) => createHash('sha1').update(text).digest('hex');

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** "keystroke · pitch +1 · length 0.09 s · brightness 0.6 · weight 0.5 · tail 0.1 · seed 3" */
export function soundLabel(sound: Pick<LibrarySound, 'source' | 'synth' | 'generated' | 'file'>): string {
  if (sound.synth) {
    const p = sound.synth.params;
    const parts = [
      sound.synth.preset,
      `pitch ${p.pitch > 0 ? '+' : ''}${p.pitch}`,
      `length ${p.length} s`,
      `brightness ${p.brightness}`,
      `weight ${p.weight}`,
      `tail ${p.tail}`,
      p.motion ? `motion ${p.motion}` : '',
      `seed ${p.seed}`,
    ];
    return parts.filter(Boolean).join(' · ');
  }
  if (sound.generated) return `generated: “${sound.generated.prompt}” (seed ${sound.generated.seed})`;
  return `file: sounds/${sound.file}`;
}

/**
 * A project's sound effects: synth recipes and generated sounds listed in sounds/sounds.json, plus any
 * audio file in sounds/. Each is rendered/converted once to a cached 48 kHz WAV and measured.
 */
export class SoundLibrary {
  private mutex = new KeyedMutex();
  private prepared = new Map<string, Promise<Prepared>>();
  private decoded = new Map<string, Stereo>();

  constructor(private store: ProjectStore) {}

  dir(projectId: string) {
    return path.join(this.store.dir(projectId), 'sounds');
  }

  private cacheDir(projectId: string) {
    return this.store.internalDir(projectId, 'sound-cache');
  }

  private async readIndex(projectId: string): Promise<SoundIndex> {
    const index = await readJson<SoundIndex>(path.join(this.dir(projectId), INDEX_FILE), { sounds: {} }).catch(() => null);
    return index && typeof index.sounds === 'object' && index.sounds ? index : { sounds: {} };
  }

  /** Every sound with its measurements, sorted by name, plus notes about files that can't be used. */
  async list(projectId: string): Promise<{ sounds: LibrarySound[]; warnings: string[] }> {
    const dir = this.dir(projectId);
    const index = await this.readIndex(projectId);
    const warnings: string[] = [];
    const found: Omit<LibrarySound, 'measure'>[] = [];
    for (const [name, entry] of Object.entries(index.sounds)) {
      if (entry.synth && isPreset(entry.synth.preset)) {
        const recipe: SynthRecipe = {
          preset: entry.synth.preset,
          params: normalizeParams(entry.synth.preset, entry.synth.params),
        };
        found.push({ name, source: 'synth', hash: sha(`synth:${SYNTH_VERSION}:${stableJson(recipe)}`), synth: recipe });
      } else if (entry.synth) {
        warnings.push(`The sound "${name}" uses an unknown synth preset "${entry.synth.preset}".`);
      } else if (entry.generated) {
        const stat = await fs.stat(path.join(dir, entry.generated.file)).catch(() => null);
        if (!stat) {
          warnings.push(`The generated sound "${name}" is missing its file sounds/${entry.generated.file}.`);
          continue;
        }
        const hash = sha(`generated:${entry.generated.file}:${stat.size}:${stat.mtimeMs}`);
        found.push({ name, source: 'generated', hash, generated: entry.generated, file: entry.generated.file });
      }
    }
    const taken = new Set(found.map((s) => s.name));
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isFile() || e.name.startsWith('.') || !AUDIO_FILE.test(e.name)) continue;
      const name = e.name.replace(AUDIO_FILE, '').trim();
      if (taken.has(name)) {
        warnings.push(`sounds/${e.name} isn't used because another sound is already called "${name}"; rename the file.`);
        continue;
      }
      const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
      if (!stat) continue;
      taken.add(name);
      found.push({ name, source: 'file', hash: sha(`file:${e.name}:${stat.size}:${stat.mtimeMs}`), file: e.name });
    }
    const sounds: LibrarySound[] = [];
    for (const sound of found) {
      try {
        sounds.push({ ...sound, measure: (await this.prepare(projectId, sound)).measure });
      } catch (e) {
        warnings.push(
          `${sound.file ? `sounds/${sound.file}` : `The sound "${sound.name}"`} can't be read: ${(e as Error).message}`,
        );
      }
    }
    sounds.sort((a, b) => a.name.localeCompare(b.name));
    return { sounds, warnings };
  }

  async get(projectId: string, name: string): Promise<LibrarySound> {
    const { sounds } = await this.list(projectId);
    const sound = sounds.find((s) => s.name === name);
    if (!sound) {
      const names = sounds.map((s) => s.name);
      throw new HttpError(
        404,
        `No sound "${name}" in this project. ${names.length ? `Sounds: ${names.join(', ')}` : 'The library is empty.'}`,
      );
    }
    return sound;
  }

  /** Render or convert a sound to its cached WAV and measure it (once per content hash). */
  private prepare(projectId: string, sound: Omit<LibrarySound, 'measure'>): Promise<Prepared> {
    const key = `${projectId}:${sound.hash}`;
    let job = this.prepared.get(key);
    if (!job) {
      job = this.build(projectId, sound);
      job.catch(() => this.prepared.delete(key));
      this.prepared.set(key, job);
    }
    return job;
  }

  private async build(projectId: string, sound: Omit<LibrarySound, 'measure'>): Promise<Prepared> {
    const cache = this.cacheDir(projectId);
    const measureFile = path.join(cache, `${sound.hash}.json`);
    const wav =
      sound.source === 'generated' ? path.join(this.dir(projectId), sound.file!) : path.join(cache, `${sound.hash}.wav`);
    const cached = await readJson<SoundMeasure | null>(measureFile, null).catch(() => null);
    if (cached && (await fs.stat(wav).catch(() => null))) return { wav, measure: cached };
    let audio: Stereo;
    if (sound.synth) audio = synthesize(sound.synth.preset, sound.synth.params);
    else if (sound.source === 'generated') audio = decodeWav(await fs.readFile(wav)) ?? (await decodeFile(wav));
    else audio = await decodeFile(path.join(this.dir(projectId), sound.file!), { sampleRate: SOUND_SAMPLE_RATE });
    if (audio.left.length === 0) throw new Error('it has no audio');
    if (sound.source !== 'generated') await writeFileAtomic(wav, encodeWav(audio));
    const measure = measureSound(audio);
    await writeJson(measureFile, measure);
    this.remember(`${projectId}:${sound.hash}`, audio);
    return { wav, measure };
  }

  private remember(key: string, audio: Stereo) {
    this.decoded.set(key, audio);
    // Sound effects are small; keep the most recent few hundred decoded.
    if (this.decoded.size > 256) this.decoded.delete(this.decoded.keys().next().value!);
  }

  /** The sound's cached WAV (for the browser) and its measurements. */
  async audioFile(projectId: string, name: string): Promise<{ sound: LibrarySound; file: string }> {
    const sound = await this.get(projectId, name);
    return { sound, file: (await this.prepare(projectId, sound)).wav };
  }

  /** Decoded samples, for the mixer. */
  async load(projectId: string, sound: LibrarySound): Promise<Stereo> {
    const key = `${projectId}:${sound.hash}`;
    const hit = this.decoded.get(key);
    if (hit) return hit;
    const { wav } = await this.prepare(projectId, sound);
    const data = await fs.readFile(wav);
    const audio = decodeWav(data) ?? (await decodeFile(wav));
    this.remember(key, audio);
    return audio;
  }

  /** What the editor gets in ProjectState.sounds. */
  async infos(projectId: string): Promise<SoundInfo[]> {
    const { sounds } = await this.list(projectId);
    return sounds.map((s) => ({
      name: s.name,
      source: s.source,
      url: `/api/projects/${projectId}/sounds/${encodeURIComponent(s.name)}/audio?v=${s.hash.slice(0, 12)}`,
      duration: s.measure.duration,
      peak: s.measure.peak,
      label: soundLabel(s),
    }));
  }

  private async claim(projectId: string, name: string, replace: boolean, index: SoundIndex) {
    if (!SOUND_NAME.test(name)) {
      throw new HttpError(400, `Invalid sound name "${name}": use lowercase letters, digits and dashes (e.g. "pin-drop").`);
    }
    const files = await fs.readdir(this.dir(projectId)).catch(() => [] as string[]);
    const file = files.find((f) => AUDIO_FILE.test(f) && f.replace(AUDIO_FILE, '').trim() === name);
    if (file) throw new HttpError(409, `sounds/${file} already uses the name "${name}"; pick another name.`);
    if (index.sounds[name] && !replace) {
      throw new HttpError(409, `There is already a sound called "${name}"; pick another name or replace it.`);
    }
  }

  async createSynth(
    projectId: string,
    input: { name: string; preset: PresetName; params: SynthParams; replace?: boolean },
  ): Promise<LibrarySound> {
    await this.mutex.run(projectId, async () => {
      const index = await this.readIndex(projectId);
      await this.claim(projectId, input.name, Boolean(input.replace), index);
      index.sounds[input.name] = {
        synth: { preset: input.preset, params: normalizeParams(input.preset, input.params) },
        createdAt: Date.now(),
      };
      await writeJson(path.join(this.dir(projectId), INDEX_FILE), index);
    });
    this.store.changed(projectId);
    return this.get(projectId, input.name);
  }

  /** Keep a sound made by the sound-effects engine (already tidied, 48 kHz). */
  async addGenerated(
    projectId: string,
    input: { name: string; audio: Stereo; prompt: string; seed: number; model: string; replace?: boolean },
  ): Promise<LibrarySound> {
    await this.mutex.run(projectId, async () => {
      const index = await this.readIndex(projectId);
      await this.claim(projectId, input.name, Boolean(input.replace), index);
      // Earlier files stay on disk, so undoing a replacement brings the old sound back.
      const file = `${GENERATED_DIR}/${input.name}-${randomBytes(3).toString('hex')}.wav`;
      await writeFileAtomic(path.join(this.dir(projectId), file), encodeWav(input.audio));
      index.sounds[input.name] = {
        generated: { file, prompt: input.prompt, seed: input.seed, model: input.model },
        createdAt: Date.now(),
      };
      await writeJson(path.join(this.dir(projectId), INDEX_FILE), index);
    });
    this.store.changed(projectId);
    return this.get(projectId, input.name);
  }

  /** An audio file dropped into the editor: saved as sounds/<its name> (numbered if taken). */
  async importFile(projectId: string, originalName: string, data: Buffer): Promise<LibrarySound> {
    const base = path
      .basename(originalName)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
      .trim();
    const ext = path.extname(base).toLowerCase();
    if (!AUDIO_FILE.test(ext)) throw new HttpError(400, `“${originalName}” isn't an audio file Kite can read`);
    const stem =
      base
        .slice(0, base.length - ext.length)
        .trim()
        .slice(0, 80) || 'sound';
    const { sounds } = await this.list(projectId);
    const taken = new Set(sounds.map((s) => s.name));
    let name = stem;
    for (let i = 2; taken.has(name); i++) name = `${stem} ${i}`;
    const dir = this.dir(projectId);
    const target = path.join(dir, `${name}${ext}`);
    await writeFileAtomic(target, data);
    try {
      await decodeFile(target, { sampleRate: SOUND_SAMPLE_RATE, length: 0.05 });
    } catch (e) {
      await fs.rm(target, { force: true });
      throw new HttpError(400, `“${originalName}” can't be decoded: ${(e as Error).message}`);
    }
    this.store.changed(projectId);
    return this.get(projectId, name);
  }

  /** Forget a sound Claude made. Files you added are yours: remove those from sounds/ yourself. */
  async remove(projectId: string, name: string): Promise<void> {
    await this.mutex.run(projectId, async () => {
      const index = await this.readIndex(projectId);
      if (!index.sounds[name]) {
        const sound = await this.get(projectId, name);
        throw new HttpError(400, `"${name}" is the file sounds/${sound.file}; only sounds Claude made can be removed here.`);
      }
      delete index.sounds[name];
      await writeJson(path.join(this.dir(projectId), INDEX_FILE), index);
    });
    this.store.changed(projectId);
  }
}

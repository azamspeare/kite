import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  MusicAnalysis,
  ProjectFile,
  ProjectState,
  ProjectSummary,
  SceneMeta,
  SceneState,
  SoundInfo,
} from '../src/shared/types';
import { INTERNAL_DIR } from './config';
import { analysisPath } from './music/library';
import { ART_DIRECTION_TEMPLATE, SCENE_GUIDE, starterScene } from './templates';
import { HttpError, KeyedMutex, assertId, exists, readJson, round, slugify, uniqueId, writeFileAtomic, writeJson } from './util';

const CODE_FILE = /\.(tsx?|jsx?)$/;
const MIN_DURATION = 0.1;
const MAX_DURATION = 600;

export interface CreateSceneInput {
  name: string;
  duration?: number;
  /** Insert after this scene (default: at the end). */
  afterId?: string | null;
  code?: string;
}

/**
 * Projects live as plain folders under the projects root:
 *   <id>/project.json, scenes/<scene>.tsx, components/, assets/, art-direction.md, music/, music.json, sounds/, renders/
 */
export class ProjectStore {
  readonly events = new EventEmitter();
  private mutex = new KeyedMutex();
  private generations = new Map<string, number>();
  private stamps = new Map<string, Map<string, number>>();
  /** The measured sound library for ProjectState.sounds (the server wires in SoundLibrary). */
  soundInfo: (id: string) => Promise<SoundInfo[]> = async () => [];

  constructor(readonly root: string) {}

  async init() {
    await fs.mkdir(this.root, { recursive: true });
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const guidePath = path.join(this.root, name);
      const current = await fs.readFile(guidePath, 'utf8').catch(() => null);
      // Refresh the guide while it is still ours (any version of the managed marker); leave user-edited copies alone.
      if (current === null || (/<!-- storyboard:managed-guide v\d+ -->/.test(current) && current !== SCENE_GUIDE)) {
        await writeFileAtomic(guidePath, SCENE_GUIDE);
      }
    }
  }

  dir(id: string): string {
    return path.join(this.root, assertId(id, 'project id'));
  }

  sceneFile(id: string, sceneId: string): string {
    return path.join(this.dir(id), 'scenes', `${assertId(sceneId, 'scene id')}.tsx`);
  }

  internalDir(id: string, ...parts: string[]): string {
    return path.join(this.dir(id), INTERNAL_DIR, ...parts);
  }

  /** Project id for an absolute path inside the projects root, if any. */
  projectIdForPath(file: string): string | null {
    const rel = path.relative(this.root, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const first = rel.split(path.sep)[0];
    return /^[a-z0-9][a-z0-9-]{0,63}$/.test(first) ? first : null;
  }

  // -------------------------------------------------------------------------
  // Reading

  async list(): Promise<ProjectSummary[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const out: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.name)) continue;
      const file = path.join(this.root, entry.name, 'project.json');
      try {
        const [data, stat] = await Promise.all([this.readProjectFile(entry.name), fs.stat(file)]);
        out.push({
          id: entry.name,
          name: data.name,
          sceneCount: data.scenes.length,
          duration: round(data.scenes.reduce((s, x) => s + x.duration, 0)),
          updatedAt: stat.mtimeMs,
          width: data.width,
          height: data.height,
          firstScene: data.scenes[0] ? { id: data.scenes[0].id, duration: data.scenes[0].duration } : null,
        });
      } catch {
        // not a project folder
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async readProjectFile(id: string): Promise<ProjectFile> {
    const file = path.join(this.dir(id), 'project.json');
    if (!(await exists(file))) throw new HttpError(404, `Project "${id}" not found`);
    return normalizeProject(await readJson<Partial<ProjectFile>>(file));
  }

  async get(id: string): Promise<ProjectState> {
    const dir = this.dir(id);
    const data = await this.readProjectFile(id);
    let start = 0;
    const scenes: SceneState[] = await Promise.all(
      data.scenes.map(async (scene, index) => {
        const file = this.sceneFile(id, scene.id);
        const stat = await fs.stat(file).catch(() => null);
        const state: SceneState = {
          ...scene,
          index,
          start: 0,
          file,
          url: `/@fs${file}`,
          version: stat ? Math.round(stat.mtimeMs) : 0,
        };
        return state;
      }),
    );
    for (const scene of scenes) {
      scene.start = round(start, 4);
      start += scene.duration;
    }
    let musicAnalysis: MusicAnalysis | null = null;
    let musicUrl: string | null = null;
    if (data.music) {
      // Per-file analysis cache (music/<file>.analysis.json); music.json is the pre-takes location.
      musicAnalysis =
        (await readJson<MusicAnalysis | null>(analysisPath(path.join(dir, 'music'), data.music.file), null).catch(() => null)) ??
        (await readJson<MusicAnalysis | null>(path.join(dir, 'music.json'), null).catch(() => null));
      musicUrl = `/@fs${path.join(dir, 'music', data.music.file)}`;
    }
    const artDirection = await fs.readFile(path.join(dir, 'art-direction.md'), 'utf8').catch(() => '');
    const sounds = await this.soundInfo(id).catch((e: Error) => {
      console.warn(`[storyboard] sounds of ${id}: ${e.message}`);
      return [];
    });
    return {
      ...data,
      id,
      dir,
      scenes,
      musicAnalysis,
      musicUrl,
      sounds,
      artDirection,
      codeGeneration: this.generations.get(id) ?? 0,
    };
  }

  async readScene(id: string, sceneId: string): Promise<string> {
    return fs.readFile(this.sceneFile(id, sceneId), 'utf8');
  }

  // -------------------------------------------------------------------------
  // Writing

  private async update(id: string, fn: (p: ProjectFile) => void | Promise<void>): Promise<ProjectFile> {
    const result = await this.mutex.run(id, async () => {
      const data = await this.readProjectFile(id);
      await fn(data);
      await writeJson(path.join(this.dir(id), 'project.json'), normalizeProject(data));
      return data;
    });
    this.changed(id);
    return result;
  }

  changed(id: string) {
    this.events.emit('changed', id);
  }

  async create(input: { name: string; width?: number; height?: number; fps?: number }): Promise<string> {
    const taken = (await fs.readdir(this.root).catch(() => [])) as string[];
    const id = uniqueId(slugify(input.name), taken);
    const dir = this.dir(id);
    await fs.mkdir(path.join(dir, 'scenes'), { recursive: true });
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
    const first: SceneMeta = { id: 'intro', name: 'Intro', duration: 3 };
    await writeFileAtomic(this.sceneFile(id, first.id), starterScene(input.name));
    await writeFileAtomic(path.join(dir, 'art-direction.md'), ART_DIRECTION_TEMPLATE);
    const project: ProjectFile = {
      name: input.name.trim() || 'Untitled',
      width: input.width ?? 1920,
      height: input.height ?? 1080,
      fps: input.fps ?? 60,
      scenes: [first],
      music: null,
    };
    await writeJson(path.join(dir, 'project.json'), project);
    await writeFileAtomic(path.join(dir, '.gitignore'), `${INTERNAL_DIR}/\nrenders/\n`);
    this.events.emit('list-changed');
    return id;
  }

  async updateSettings(id: string, patch: Partial<Pick<ProjectFile, 'name' | 'width' | 'height' | 'fps'>>) {
    await this.update(id, (p) => {
      if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
      if (patch.width !== undefined) p.width = clampInt(patch.width, 64, 7680);
      if (patch.height !== undefined) p.height = clampInt(patch.height, 64, 7680);
      if (patch.fps !== undefined) p.fps = clampInt(patch.fps, 1, 120);
    });
    this.events.emit('list-changed');
  }

  async createScene(id: string, input: CreateSceneInput): Promise<SceneMeta> {
    let created!: SceneMeta;
    await this.update(id, async (p) => {
      const sceneId = uniqueId(
        slugify(input.name),
        p.scenes.map((s) => s.id),
      );
      created = { id: sceneId, name: input.name.trim() || 'Untitled', duration: clampDuration(input.duration ?? 3) };
      await writeFileAtomic(this.sceneFile(id, sceneId), input.code ?? starterScene(created.name));
      const at = input.afterId ? p.scenes.findIndex((s) => s.id === input.afterId) + 1 : p.scenes.length;
      p.scenes.splice(at > 0 ? at : p.scenes.length, 0, created);
    });
    await this.syncCode(id);
    return created;
  }

  async duplicateScene(id: string, sceneId: string): Promise<SceneMeta> {
    const project = await this.readProjectFile(id);
    const source = requireScene(project, sceneId);
    const code = await this.readScene(id, sceneId);
    return this.createScene(id, { name: `${source.name} copy`, duration: source.duration, afterId: sceneId, code });
  }

  async deleteScene(id: string, sceneId: string): Promise<void> {
    await this.update(id, async (p) => {
      requireScene(p, sceneId);
      if (p.scenes.length <= 1) throw new HttpError(400, 'A project needs at least one scene');
      p.scenes = p.scenes.filter((s) => s.id !== sceneId);
      const trash = this.internalDir(id, 'trash');
      await fs.mkdir(trash, { recursive: true });
      await fs.rename(this.sceneFile(id, sceneId), path.join(trash, `${Date.now()}-${sceneId}.tsx`)).catch(() => undefined);
    });
    await this.syncCode(id);
  }

  async moveScene(id: string, sceneId: string, toIndex: number): Promise<void> {
    await this.update(id, (p) => {
      const from = p.scenes.findIndex((s) => s.id === sceneId);
      if (from < 0) throw new HttpError(404, `Scene "${sceneId}" not found`);
      const [scene] = p.scenes.splice(from, 1);
      p.scenes.splice(Math.max(0, Math.min(p.scenes.length, Math.round(toIndex))), 0, scene);
    });
  }

  async reorder(id: string, order: string[]): Promise<void> {
    await this.update(id, (p) => {
      const byId = new Map(p.scenes.map((s) => [s.id, s]));
      const next = order.map((sid) => byId.get(sid)).filter((s): s is SceneMeta => Boolean(s));
      if (next.length !== p.scenes.length) throw new HttpError(400, 'Reorder must list every scene exactly once');
      p.scenes = next;
    });
  }

  async renameScene(id: string, sceneId: string, name: string): Promise<void> {
    await this.update(id, (p) => {
      requireScene(p, sceneId).name = name.trim() || sceneId;
    });
  }

  async setSceneDuration(id: string, sceneId: string, seconds: number): Promise<number> {
    let value = 0;
    await this.update(id, (p) => {
      value = clampDuration(seconds);
      requireScene(p, sceneId).duration = value;
    });
    return value;
  }

  async setDurations(id: string, durations: Record<string, number>): Promise<void> {
    await this.update(id, (p) => {
      for (const scene of p.scenes) {
        if (durations[scene.id] !== undefined) scene.duration = clampDuration(durations[scene.id]);
      }
    });
  }

  async setArtDirection(id: string, text: string): Promise<void> {
    await writeFileAtomic(path.join(this.dir(id), 'art-direction.md'), text);
    this.changed(id);
  }

  /** Make a file in music/ the soundtrack, keeping the previous start offset and volume. */
  async useMusicFile(id: string, file: string, start?: number): Promise<void> {
    if (!(await exists(path.join(this.dir(id), 'music', file)))) throw new HttpError(404, `music/${file} not found`);
    await this.update(id, (p) => {
      p.music = { file, start: Math.max(0, round(start ?? p.music?.start ?? 0, 3)), volume: p.music?.volume ?? 1 };
    });
  }

  async updateMusic(id: string, patch: { start?: number; volume?: number }): Promise<void> {
    await this.update(id, (p) => {
      if (!p.music) throw new HttpError(400, 'This project has no music');
      if (patch.start !== undefined) p.music.start = Math.max(0, round(patch.start, 3));
      if (patch.volume !== undefined) p.music.volume = Math.max(0, Math.min(1, patch.volume));
    });
  }

  /** Unset the soundtrack; the takes in music/ stay available. */
  async removeMusic(id: string): Promise<void> {
    await this.update(id, (p) => {
      p.music = null;
    });
  }

  // -------------------------------------------------------------------------
  // Code change tracking

  /**
   * Compare code file mtimes with what we saw last; when anything changed, bump the project's code
   * generation and emit `code-changed` (listeners invalidate Vite's module cache synchronously).
   */
  async syncCode(id: string): Promise<boolean> {
    const dir = this.dir(id);
    const files = await listCodeFiles(dir);
    const next = new Map<string, number>();
    await Promise.all(
      files.map(async (f) => {
        const stat = await fs.stat(f).catch(() => null);
        if (stat) next.set(f, stat.mtimeMs);
      }),
    );
    const prev = this.stamps.get(id);
    let changed = !prev || prev.size !== next.size;
    if (!changed && prev) {
      for (const [f, m] of next) {
        if (prev.get(f) !== m) {
          changed = true;
          break;
        }
      }
    }
    this.stamps.set(id, next);
    if (changed && prev) {
      this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
      this.events.emit('code-changed', id, dir);
      this.changed(id);
    }
    return changed && Boolean(prev);
  }
}

async function listCodeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const sub of ['scenes', 'components']) {
    const base = path.join(dir, sub);
    const entries = await fs.readdir(base, { recursive: true, withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isFile() && CODE_FILE.test(e.name)) out.push(path.join(e.parentPath, e.name));
    }
  }
  return out;
}

function requireScene(p: ProjectFile, sceneId: string): SceneMeta {
  const scene = p.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new HttpError(404, `Scene "${sceneId}" not found`);
  return scene;
}

function clampDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) throw new HttpError(400, 'Duration must be a number of seconds');
  return round(Math.min(MAX_DURATION, Math.max(MIN_DURATION, seconds)), 3);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, Number(value) || min)));
}

function normalizeProject(raw: Partial<ProjectFile>): ProjectFile {
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  return {
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Untitled',
    width: Number(raw.width) || 1920,
    height: Number(raw.height) || 1080,
    fps: Number(raw.fps) || 60,
    scenes: scenes
      .filter((s): s is SceneMeta => Boolean(s && typeof s.id === 'string'))
      .map((s) => ({ id: s.id, name: s.name || s.id, duration: Number(s.duration) > 0 ? Number(s.duration) : 3 })),
    music:
      raw.music && typeof raw.music.file === 'string'
        ? { file: raw.music.file, start: Number(raw.music.start) || 0, volume: raw.music.volume ?? 1 }
        : null,
  };
}

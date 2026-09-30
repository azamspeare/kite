import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectFile } from '../src/shared/types';
import type { ProjectStore } from './projects';
import { readJson, writeFileAtomic, writeJson } from './util';

const KEEP = 40;

interface UndoRecord {
  id: string;
  createdAt: number;
  /** Relative path → content before the turn (null = the file did not exist). Only changed files. */
  files: Record<string, string | null>;
}

async function trackedFiles(dir: string): Promise<string[]> {
  // sounds/sounds.json holds the synth recipes and generated sounds Claude made; their audio follows it.
  const out = ['project.json', 'art-direction.md', 'sounds/sounds.json'];
  for (const sub of ['scenes', 'components']) {
    const entries = await fs.readdir(path.join(dir, sub), { recursive: true, withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isFile()) out.push(path.relative(dir, path.join(e.parentPath, e.name)));
    }
  }
  return out;
}

async function readAll(dir: string, files: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  await Promise.all(files.map(async (f) => map.set(f, await fs.readFile(path.join(dir, f), 'utf8').catch(() => null))));
  return map;
}

/** Snapshots project files before an agent turn so the turn can be undone. */
export class UndoStore {
  constructor(private store: ProjectStore) {}

  private file(projectId: string, id: string) {
    return this.store.internalDir(projectId, 'undo', `${id}.json`);
  }

  /** Remember the current contents; call the returned function after the turn. */
  async begin(projectId: string): Promise<() => Promise<{ undoId: string; changed: string[] } | null>> {
    const dir = this.store.dir(projectId);
    const before = await readAll(dir, await trackedFiles(dir));
    return async () => {
      const afterFiles = await trackedFiles(dir);
      const after = await readAll(dir, [...new Set([...before.keys(), ...afterFiles])]);
      const files: Record<string, string | null> = {};
      for (const [rel, content] of after) {
        const old = before.get(rel) ?? null;
        if (old !== content) files[rel] = old;
      }
      const changed = Object.keys(files);
      if (changed.length === 0) return null;
      const record: UndoRecord = { id: randomUUID(), createdAt: Date.now(), files };
      await writeJson(this.file(projectId, record.id), record);
      await this.prune(projectId);
      return { undoId: record.id, changed };
    };
  }

  /**
   * Put files back as they were before the turn. With `sceneId` (a scene chat), only that scene's file
   * and its duration are restored, so unrelated edits elsewhere survive.
   */
  async restore(projectId: string, undoId: string, sceneId?: string): Promise<string[]> {
    if (!/^[\w-]+$/.test(undoId)) throw new Error('Invalid undo id');
    const record = await readJson<UndoRecord>(this.file(projectId, undoId));
    const dir = this.store.dir(projectId);
    const restored: string[] = [];
    for (const [rel, content] of Object.entries(record.files)) {
      if (sceneId && rel === 'project.json' && content) {
        const before = JSON.parse(content) as ProjectFile;
        const duration = before.scenes.find((s) => s.id === sceneId)?.duration;
        if (duration !== undefined) {
          await this.store.setSceneDuration(projectId, sceneId, duration);
          restored.push(rel);
        }
        continue;
      }
      if (sceneId && rel !== `scenes/${sceneId}.tsx`) continue;
      const target = path.join(dir, rel);
      if (content === null) {
        const trash = this.store.internalDir(projectId, 'trash');
        await fs.mkdir(trash, { recursive: true });
        await fs.rename(target, path.join(trash, `${Date.now()}-${path.basename(rel)}`)).catch(() => undefined);
      } else {
        await writeFileAtomic(target, content);
      }
      restored.push(rel);
    }
    await fs.rm(this.file(projectId, undoId), { force: true });
    return restored;
  }

  private async prune(projectId: string) {
    const dir = this.store.internalDir(projectId, 'undo');
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    if (names.length <= KEEP) return;
    const stats = await Promise.all(names.map(async (n) => ({ n, m: (await fs.stat(path.join(dir, n))).mtimeMs })));
    stats.sort((a, b) => a.m - b.m);
    await Promise.all(stats.slice(0, stats.length - KEEP).map((s) => fs.rm(path.join(dir, s.n), { force: true })));
  }
}

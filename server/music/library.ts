import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MusicAnalysis } from '../../src/shared/types';
import type { ProjectStore } from '../projects';
import { HttpError, KeyedMutex, readJson, writeFileAtomic, writeJson } from '../util';
import { analyzeMusic } from './analyze';

/** One soundtrack candidate stored in the project's music/ folder. */
export interface MusicTake {
  id: string;
  /** File name inside music/. */
  file: string;
  source: 'upload' | 'generated' | 'repaint';
  /** Short label. */
  name: string;
  /** The brief the music model was given (generated takes). */
  prompt?: string;
  params?: { duration: number; bpm?: number; key?: string; timeSignature?: string; quality?: 'draft' | 'best'; seed?: number };
  /** For repaints: the take this one was derived from and the regenerated span. */
  parentId?: string;
  repaint?: { start: number; end: number };
  createdAt: number;
  /** Measured by Kite's analyzer. */
  duration: number;
  bpm?: number;
  sections?: string;
}

export interface NewTake {
  data: Buffer;
  /** File extension including the dot. */
  ext: string;
  source: MusicTake['source'];
  name: string;
  prompt?: string;
  params?: MusicTake['params'];
  parentId?: string;
  repaint?: MusicTake['repaint'];
}

export function analysisPath(musicDir: string, file: string) {
  return path.join(musicDir, `${file}.analysis.json`);
}

function sectionSummary(a: MusicAnalysis): string {
  return a.sections.map((s) => s.label).join(' → ');
}

/**
 * Every soundtrack candidate of a project: files in music/, listed in music/takes.json,
 * each with a cached beat analysis (music/<file>.analysis.json).
 */
export class MusicLibrary {
  private mutex = new KeyedMutex();

  constructor(private store: ProjectStore) {}

  dir(projectId: string) {
    return path.join(this.store.dir(projectId), 'music');
  }

  async list(projectId: string): Promise<MusicTake[]> {
    const index = await readJson<{ takes: MusicTake[] }>(path.join(this.dir(projectId), 'takes.json'), { takes: [] });
    return index.takes;
  }

  async get(projectId: string, takeId: string): Promise<MusicTake> {
    const take = (await this.list(projectId)).find((t) => t.id === takeId);
    if (!take) throw new HttpError(404, `No music take "${takeId}" in ${projectId}`);
    return take;
  }

  file(projectId: string, take: MusicTake) {
    return path.join(this.dir(projectId), take.file);
  }

  /** Beat analysis of a file in music/, computed once and cached next to it. */
  async analysis(projectId: string, file: string, force = false): Promise<MusicAnalysis> {
    const dir = this.dir(projectId);
    const cache = analysisPath(dir, file);
    if (!force) {
      const cached = await readJson<MusicAnalysis | null>(cache, null).catch(() => null);
      if (cached) return cached;
    }
    const analysis = await analyzeMusic(path.join(dir, file));
    await writeJson(cache, analysis);
    return analysis;
  }

  async add(projectId: string, input: NewTake): Promise<MusicTake> {
    const dir = this.dir(projectId);
    await fs.mkdir(dir, { recursive: true });
    const id = `${input.source === 'upload' ? 'u' : 't'}${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
    const file = `${id}${input.ext}`;
    await writeFileAtomic(path.join(dir, file), input.data);
    const analysis = await this.analysis(projectId, file);
    const take: MusicTake = {
      id,
      file,
      source: input.source,
      name: input.name,
      prompt: input.prompt,
      params: input.params,
      parentId: input.parentId,
      repaint: input.repaint,
      createdAt: Date.now(),
      duration: analysis.duration,
      bpm: analysis.bpm,
      sections: sectionSummary(analysis),
    };
    await this.mutex.run(projectId, async () => {
      const takes = await this.list(projectId);
      takes.push(take);
      await writeJson(path.join(dir, 'takes.json'), { takes });
    });
    return take;
  }

  async remove(projectId: string, takeId: string, currentFile: string | undefined) {
    await this.mutex.run(projectId, async () => {
      const takes = await this.list(projectId);
      const take = takes.find((t) => t.id === takeId);
      if (!take) throw new HttpError(404, `No music take "${takeId}"`);
      if (take.file === currentFile) throw new HttpError(400, 'That take is the current soundtrack; switch to another first');
      const trash = this.store.internalDir(projectId, 'trash');
      await fs.mkdir(trash, { recursive: true });
      await fs.rename(this.file(projectId, take), path.join(trash, `${Date.now()}-${take.file}`)).catch(() => undefined);
      await fs.rm(analysisPath(this.dir(projectId), take.file), { force: true });
      await writeJson(path.join(this.dir(projectId), 'takes.json'), { takes: takes.filter((t) => t.id !== takeId) });
    });
  }
}

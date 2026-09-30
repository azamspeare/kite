import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MusicAnalysis } from '../../src/shared/types';
import { FFMPEG } from '../config';
import type { ProjectStore } from '../projects';
import { HttpError, round } from '../util';
import type { EngineFile, EngineRequest, MusicEngine } from './engine';
import type { MusicLibrary, MusicTake, NewTake } from './library';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const JOB_TIMEOUT_MS = 20 * 60 * 1000;

export interface ComposeInput {
  prompt: string;
  duration: number;
  bpm?: number;
  key?: string;
  timeSignature?: string;
  variations: number;
  quality: 'draft' | 'best';
  lyrics?: string;
  seed?: number;
}

export interface MusicJob {
  id: string;
  projectId: string;
  kind: 'compose' | 'repaint';
  status: 'running' | 'done' | 'error';
  stage?: string;
  takeIds: string[];
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

const fmt = (x: number) => round(x, 2).toFixed(2);

/** Generation jobs on the music engine, and everything the agent needs to judge the results. */
export class MusicService {
  private jobs = new Map<string, { job: MusicJob; done: Promise<void> }>();

  constructor(private deps: { store: ProjectStore; engine: MusicEngine; library: MusicLibrary }) {}

  get(jobId: string): MusicJob {
    const entry = this.jobs.get(jobId);
    if (!entry) throw new HttpError(404, `No music job "${jobId}"`);
    return entry.job;
  }

  /** Resolve when the job finishes or after `ms`, whichever comes first. */
  async wait(jobId: string, ms: number): Promise<MusicJob> {
    const entry = this.jobs.get(jobId);
    if (!entry) throw new HttpError(404, `No music job "${jobId}"`);
    await Promise.race([entry.done, sleep(ms)]);
    return entry.job;
  }

  compose(projectId: string, input: ComposeInput): MusicJob {
    const req: EngineRequest = {
      task: 'text2music',
      prompt: input.prompt,
      lyrics: input.lyrics,
      duration: input.duration,
      bpm: input.bpm,
      key: input.key,
      timeSignature: input.timeSignature,
      variations: input.variations,
      quality: input.quality,
      seed: input.seed,
    };
    const label = input.prompt.length > 70 ? `${input.prompt.slice(0, 67).trimEnd()}…` : input.prompt;
    return this.start(projectId, 'compose', req, (i, count) => ({
      source: 'generated',
      name: count > 1 ? `${label} (${String.fromCharCode(65 + i)})` : label,
      prompt: input.prompt,
      params: {
        duration: input.duration,
        bpm: input.bpm,
        key: input.key,
        timeSignature: input.timeSignature,
        quality: input.quality,
        seed: input.seed,
      },
    }));
  }

  async repaint(
    projectId: string,
    input: { takeId: string; start: number; end: number; prompt?: string; variations: number },
  ): Promise<MusicJob> {
    const { library } = this.deps;
    const take = await library.get(projectId, input.takeId);
    if (input.end <= input.start) throw new HttpError(400, 'Repaint end must be after its start');
    const req: EngineRequest = {
      task: 'repaint',
      prompt: input.prompt ?? take.prompt ?? '',
      variations: input.variations,
      quality: 'draft',
      source: { file: library.file(projectId, take), start: input.start, end: input.end },
    };
    return this.start(projectId, 'repaint', req, (i, count) => ({
      source: 'repaint',
      name: `${take.name.replace(/ \([A-Z]\)$/, '')} · repaint ${fmt(input.start)}–${fmt(input.end)}s${count > 1 ? ` (${String.fromCharCode(65 + i)})` : ''}`,
      prompt: req.prompt || undefined,
      params: take.params,
      parentId: take.id,
      repaint: { start: input.start, end: input.end },
    }));
  }

  private start(
    projectId: string,
    kind: MusicJob['kind'],
    req: EngineRequest,
    meta: (index: number, count: number, file: EngineFile) => Omit<NewTake, 'data' | 'ext'>,
  ): MusicJob {
    const { engine, library } = this.deps;
    const job: MusicJob = {
      id: randomUUID().slice(0, 8),
      projectId,
      kind,
      status: 'running',
      takeIds: [],
      createdAt: Date.now(),
    };
    const run = async () => {
      const taskId = await engine.submit(req);
      let files: EngineFile[] = [];
      for (;;) {
        await sleep(1500);
        const state = await engine.poll(taskId);
        if (state.status === 'done') {
          files = state.files;
          break;
        }
        if (state.status === 'failed') throw new Error(state.error ?? 'The music engine could not generate this');
        job.stage = state.stage;
        if (Date.now() - job.createdAt > JOB_TIMEOUT_MS) throw new Error('The music engine took longer than 20 minutes');
      }
      if (files.length === 0) throw new Error('The music engine returned no audio');
      for (const [i, file] of files.entries()) {
        const data = await engine.download(file.url);
        const take = await library.add(projectId, { data, ext: '.wav', ...meta(i, files.length, file) });
        job.takeIds.push(take.id);
      }
    };
    const done = run()
      .then(() => {
        job.status = 'done';
      })
      .catch((e: Error) => {
        job.status = 'error';
        job.error = e.message;
      })
      .finally(() => {
        job.finishedAt = Date.now();
        job.stage = undefined;
      });
    this.jobs.set(job.id, { job, done });
    // Keep a bounded history.
    if (this.jobs.size > 50) this.jobs.delete(this.jobs.keys().next().value!);
    return job;
  }

  /** Make a take the soundtrack (the analysis is cached first so beats are available immediately). */
  async use(projectId: string, takeId: string, start?: number): Promise<MusicTake> {
    const { library, store } = this.deps;
    const take = await library.get(projectId, takeId);
    await library.analysis(projectId, take.file);
    await store.useMusicFile(projectId, take.file, start);
    return take;
  }

  /** A dropped-in audio file: keep it as a take and make it the soundtrack. */
  async importUpload(projectId: string, originalName: string, data: Buffer): Promise<MusicTake> {
    const ext =
      path
        .extname(originalName)
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, '') || '.mp3';
    const take = await this.deps.library.add(projectId, { data, ext, source: 'upload', name: originalName });
    await this.deps.store.useMusicFile(projectId, take.file, 0);
    return take;
  }

  /** What the agent gets instead of listening: measured structure, loudness, fit to the cuts, and a spectrogram. */
  async describe(projectId: string, take: MusicTake): Promise<{ text: string; spectrogram: Buffer | null }> {
    const { library, store } = this.deps;
    const file = library.file(projectId, take);
    const [analysis, project, loudness, spectrogram] = await Promise.all([
      library.analysis(projectId, take.file),
      store.get(projectId),
      measureLoudness(file),
      renderSpectrogram(file),
    ]);
    const current = project.music?.file === take.file;
    const cuts = project.scenes.slice(1).map((s, i) => ({ t: s.start, label: `${project.scenes[i].id}→${s.id}` }));
    const offset = current ? (project.music?.start ?? 0) : 0;
    const lines = [
      `Take ${take.id} — "${take.name}"${current ? ' (current soundtrack)' : ''}`,
      `${fmt(analysis.duration)}s · ${analysis.bpm.toFixed(1)} BPM measured${requested(take)} · ${analysis.beatsPerBar}/4`,
      barLine(analysis),
      `Sections: ${analysis.sections.map((s) => `${s.label} ${fmt(s.start)}–${fmt(s.end)} (energy ${s.energy.toFixed(2)})`).join(' → ')}`,
      `Strongest hits: ${strongest(analysis)}`,
      loudness ? `Loudness: ${loudness}` : '',
      cuts.length
        ? `Current cuts vs this take's bar lines${current ? '' : ' (if it started at video t = 0)'}: ${cuts
            .map((c) => {
              const bar = nearest(
                analysis.downbeats.map((d) => d - offset),
                c.t,
              );
              return `${c.label} ${fmt(c.t)}s → bar ${fmt(bar)}s (${bar - c.t >= 0 ? '+' : ''}${fmt(bar - c.t)})`;
            })
            .join(' · ')}`
        : '',
    ].filter(Boolean);
    return { text: lines.join('\n'), spectrogram };
  }
}

function requested(take: MusicTake): string {
  const p = take.params;
  if (!p) return '';
  const parts = [p.bpm ? `${p.bpm} BPM` : '', p.key ?? ''].filter(Boolean);
  return parts.length ? ` (asked for ${parts.join(', ')})` : '';
}

function barLine(a: MusicAnalysis): string {
  if (a.downbeats.length < 2) return 'Bars: not detected';
  const bar = (a.downbeats[a.downbeats.length - 1] - a.downbeats[0]) / (a.downbeats.length - 1);
  return `Bars: every ${fmt(bar)}s, first downbeat at ${fmt(a.downbeats[0])}s; phrases start at ${a.phrases.map(fmt).join(', ') || '—'}`;
}

function strongest(a: MusicAnalysis): string {
  const top = [...a.accents]
    .sort((x, y) => y.strength - x.strength)
    .slice(0, 5)
    .sort((x, y) => x.t - y.t);
  return top.map((x) => `${fmt(x.t)}s (${x.strength.toFixed(2)})`).join(', ') || '—';
}

function nearest(points: number[], t: number): number {
  return points.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), points[0] ?? t);
}

export async function measureLoudness(file: string): Promise<string | null> {
  try {
    const { stderr } = await execFileAsync(
      FFMPEG,
      ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      {
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
    const integrated = summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1];
    const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
    return integrated ? `${integrated} LUFS integrated${peak ? `, true peak ${peak} dBFS` : ''}` : null;
  } catch {
    return null;
  }
}

export async function renderSpectrogram(file: string): Promise<Buffer | null> {
  const out = path.join(os.tmpdir(), `sb-spectrum-${randomUUID().slice(0, 8)}.jpg`);
  try {
    await execFileAsync(FFMPEG, [
      '-v',
      'error',
      '-y',
      '-i',
      file,
      '-lavfi',
      'showspectrumpic=s=900x260:mode=combined:scale=log:fscale=log:color=intensity:legend=1',
      '-frames:v',
      '1',
      '-q:v',
      '5',
      out,
    ]);
    return await fs.readFile(out);
  } catch {
    return null;
  } finally {
    await fs.rm(out, { force: true });
  }
}

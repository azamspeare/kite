import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RenderFile, RenderJob } from '../src/shared/types';
import { captureOne, withTimeout, type Capturer } from './capture';
import { FFMPEG } from './config';
import type { Hub } from './hub';
import type { ProjectStore } from './projects';
import type { SoundService } from './sound/service';
import { HttpError, slugify } from './util';

interface JobState {
  job: RenderJob;
  cancelled: boolean;
  cancel: () => void;
}

export interface RenderOptions {
  /** Output scale relative to the project canvas (1 = 1920×1080, 2 = 4K). */
  scale?: number;
  fps?: number;
}

/** Whole-video export: parallel headless pages → ordered frames → ffmpeg (H.264 + the mixed soundtrack and effects). */
export class Renderer {
  private jobs = new Map<string, JobState>();

  constructor(
    private store: ProjectStore,
    private capturer: Capturer,
    private hub: Hub,
    private sounds: SoundService,
  ) {}

  jobsFor(projectId: string): RenderJob[] {
    return [...this.jobs.values()]
      .map((j) => j.job)
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async files(projectId: string): Promise<RenderFile[]> {
    const dir = path.join(this.store.dir(projectId), 'renders');
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const files = await Promise.all(
      names
        .filter((n) => n.endsWith('.mp4'))
        .map(async (name) => {
          const file = path.join(dir, name);
          const stat = await fs.stat(file);
          return { name, url: `/@fs${file}`, size: stat.size, createdAt: stat.mtimeMs };
        }),
    );
    const active = new Set(
      this.jobsFor(projectId)
        .filter((j) => j.status !== 'done')
        .map((j) => j.output),
    );
    return files.filter((f) => !active.has(path.join(dir, f.name))).sort((a, b) => b.createdAt - a.createdAt);
  }

  async remove(projectId: string, name: string) {
    if (!/^[\w.-]+\.mp4$/.test(name)) throw new HttpError(400, 'Invalid file name');
    await fs.rm(path.join(this.store.dir(projectId), 'renders', name), { force: true });
  }

  cancel(jobId: string) {
    const state = this.jobs.get(jobId);
    if (!state) throw new HttpError(404, 'No such render');
    state.cancel();
  }

  async start(projectId: string, opts: RenderOptions = {}): Promise<RenderJob> {
    if (this.jobsFor(projectId).some((j) => j.status === 'rendering' || j.status === 'encoding' || j.status === 'queued')) {
      throw new HttpError(409, 'A render is already running for this project');
    }
    await this.store.syncCode(projectId);
    const project = await this.store.get(projectId);
    const scale = Math.min(4, Math.max(0.25, opts.scale ?? 1));
    const fps = Math.min(120, Math.max(1, Math.round(opts.fps ?? project.fps)));
    const total = project.scenes.reduce((s, x) => s + x.duration, 0);
    const outDir = path.join(this.store.dir(projectId), 'renders');
    await fs.mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const output = path.join(outDir, `${slugify(project.name)}-${stamp}.mp4`);
    const job: RenderJob = {
      id: randomUUID(),
      projectId,
      status: 'queued',
      framesDone: 0,
      framesTotal: Math.max(1, Math.round(total * fps)),
      fps,
      width: Math.round((project.width * scale) / 2) * 2,
      height: Math.round((project.height * scale) / 2) * 2,
      startedAt: Date.now(),
      output,
    };
    const state: JobState = { job, cancelled: false, cancel: () => undefined };
    this.jobs.set(job.id, state);
    void this.run(state, scale, total).catch((e: Error) => {
      if (!state.cancelled) this.update(state, { status: 'error', error: e.message, finishedAt: Date.now() });
    });
    this.hub.send({ type: 'render', job });
    return job;
  }

  private lastEmit = 0;

  private update(state: JobState, patch: Partial<RenderJob>, throttle = false) {
    Object.assign(state.job, patch);
    const now = Date.now();
    if (throttle && now - this.lastEmit < 200) return;
    this.lastEmit = now;
    this.hub.send({ type: 'render', job: { ...state.job } });
  }

  private async run(state: JobState, scale: number, total: number) {
    const { job } = state;
    const project = await this.store.get(job.projectId);
    const workers = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
    const pages = await Promise.all(
      Array.from({ length: workers }, () =>
        this.capturer.openFramePage({
          projectId: job.projectId,
          sceneId: null,
          scale,
          width: project.width,
          height: project.height,
        }),
      ),
    );
    const closePages = () => Promise.all(pages.map((p) => p.context.close().catch(() => undefined)));

    // Music and sound cues, mixed exactly as check_audio hears them.
    const audioFile = this.store.internalDir(job.projectId, 'tmp', `${job.id}.wav`);
    let hasAudio = false;
    try {
      const report = await withTimeout(
        pages[0].page.evaluate(() => window.__sb!.sounds()),
        60000,
        'Collecting the sound cues timed out',
      );
      const mixed = await this.sounds.renderMix(job.projectId, report, audioFile);
      hasAudio = mixed.written;
      if (mixed.warnings.length) this.update(state, { warnings: mixed.warnings });
    } catch (e) {
      await closePages();
      throw e;
    }
    const removeAudio = () => fs.rm(audioFile, { force: true }).catch(() => undefined);

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(job.fps),
      '-c:v',
      'mjpeg',
      '-i',
      '-',
    ];
    if (hasAudio) args.push('-i', audioFile);
    args.push('-map', '0:v');
    if (hasAudio) args.push('-map', '1:a');
    args.push(
      '-vf',
      // accurate_rnd + full_chroma_int keep neutral greys neutral through the JPEG→BT.709 conversion.
      `scale=${job.width}:${job.height}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p,` +
        'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '16',
      '-r',
      String(job.fps),
      '-movflags',
      '+faststart',
    );
    // The mix already carries the volume, the −1 dBFS limiter and the end fade.
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-t', total.toFixed(3), job.output!);

    const ffmpeg = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffmpegError = '';
    ffmpeg.stderr.on('data', (d: Buffer) => (ffmpegError += d.toString()));
    const ffmpegDone = new Promise<number>((resolve, reject) => {
      ffmpeg.on('error', (e) => reject(new Error(`Could not start ffmpeg (${FFMPEG}): ${e.message}`)));
      ffmpeg.on('close', (code) => resolve(code ?? 1));
    });
    ffmpeg.stdin.on('error', () => undefined);

    state.cancel = () => {
      state.cancelled = true;
      ffmpeg.kill('SIGKILL');
      void closePages();
      void removeAudio();
      void fs.rm(job.output!, { force: true });
      this.update(state, { status: 'cancelled', finishedAt: Date.now() });
    };

    this.update(state, { status: 'rendering' });
    const frameCount = job.framesTotal;
    const slots: { promise: Promise<Buffer>; resolve: (b: Buffer) => void; reject: (e: Error) => void }[] = [];
    for (let i = 0; i < frameCount; i++) {
      let resolve!: (b: Buffer) => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<Buffer>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise.catch(() => undefined);
      slots.push({ promise, resolve, reject });
    }
    let written = 0;
    const waiters: (() => void)[] = [];
    const maxAhead = workers * 4;
    let failure: Error | null = null;

    const worker = async (w: number) => {
      const page = pages[w].page;
      for (let i = w; i < frameCount; i += workers) {
        while (i >= written + maxAhead && !state.cancelled && !failure) await new Promise<void>((r) => waiters.push(r));
        if (state.cancelled || failure) return;
        try {
          const result = await captureOne(page, i / job.fps);
          if (result.errors.length) {
            throw new Error(`Scene error at ${(i / job.fps).toFixed(2)}s: ${result.errors[0]}`);
          }
          const image = await page.screenshot({ type: 'jpeg', quality: 95, animations: 'disabled', caret: 'hide' });
          slots[i].resolve(image);
        } catch (e) {
          failure = failure ?? (e as Error);
          slots[i].reject(e as Error);
          return;
        }
      }
    };

    const writer = async () => {
      for (let i = 0; i < frameCount; i++) {
        const image = await slots[i].promise;
        if (state.cancelled) return;
        if (!ffmpeg.stdin.write(image)) await once(ffmpeg.stdin, 'drain');
        written = i + 1;
        waiters.splice(0).forEach((r) => r());
        this.update(state, { framesDone: written }, true);
      }
      ffmpeg.stdin.end();
    };

    try {
      await Promise.all([writer(), ...pages.map((_, w) => worker(w))]);
    } catch (e) {
      failure = failure ?? (e as Error);
    }
    await closePages();
    if (state.cancelled) return;
    if (failure) {
      ffmpeg.kill('SIGKILL');
      await removeAudio();
      await fs.rm(job.output!, { force: true });
      throw failure;
    }
    this.update(state, { status: 'encoding', framesDone: frameCount });
    const code = await ffmpegDone;
    await removeAudio();
    if (code !== 0)
      throw new Error(`ffmpeg failed: ${ffmpegError.trim().split('\n').slice(-3).join(' ') || `exit code ${code}`}`);
    this.update(state, { status: 'done', finishedAt: Date.now(), outputUrl: `/@fs${job.output}` });
  }
}

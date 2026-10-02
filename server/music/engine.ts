import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MUSIC_DIR, MUSIC_KEY_FILE, MUSIC_PYTHON, MUSIC_URL } from '../config';
import { readSettings } from '../settings';

export interface EngineRequest {
  task: 'text2music' | 'repaint';
  prompt: string;
  /** Empty for instrumental. */
  lyrics?: string;
  duration?: number;
  bpm?: number;
  key?: string;
  timeSignature?: string;
  variations: number;
  quality: 'draft' | 'best';
  seed?: number;
  /** Repaint: the audio to edit and the span (seconds) to regenerate. */
  source?: { file: string; start: number; end: number };
}

export interface EngineFile {
  url: string;
  bpm?: number;
  key?: string;
  timeSignature?: string;
  duration?: number;
}

export interface EngineTaskState {
  status: 'running' | 'done' | 'failed';
  stage?: string;
  progress?: number;
  error?: string;
  files: EngineFile[];
}

export interface EngineHealth {
  initialized: boolean;
  model?: string;
  lmModel?: string;
}

/** off: turned off in `./kite setup`. */
export type EngineState = 'off' | 'not-installed' | 'stopped' | 'loading' | 'ready';

export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/** ACE-Step's main model (what `acestep-download` fetches): the engine can't start without it. */
const MAIN_MODEL = ['acestep-v15-turbo', 'vae', 'Qwen3-Embedding-0.6B', 'acestep-5Hz-lm-1.7B'];
/** A part counts once its weights are there (downloads only move them into place when they're complete). */
const WEIGHTS = [
  'model.safetensors',
  'model.safetensors.index.json',
  'diffusion_pytorch_model.safetensors',
  'diffusion_pytorch_model.safetensors.index.json',
];

/** Whether `./kite setup` has installed the engine in engines/music. */
export function engineInstalled(): boolean {
  return (
    fs.existsSync(MUSIC_PYTHON) &&
    MAIN_MODEL.every((part) => WEIGHTS.some((file) => fs.existsSync(path.join(MUSIC_DIR, 'checkpoints', part, file))))
  );
}

/** The engine's API key: KITE_MUSIC_API_KEY, or a random key kept in .kite/keys. */
export function musicApiKey(): string {
  if (process.env.KITE_MUSIC_API_KEY) return process.env.KITE_MUSIC_API_KEY;
  try {
    const key = fs.readFileSync(MUSIC_KEY_FILE, 'utf8').trim();
    if (key) return key;
  } catch {
    // create below
  }
  const key = randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(MUSIC_KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(MUSIC_KEY_FILE, `${key}\n`, { mode: 0o600 });
  return key;
}

export async function engineHealth(url = MUSIC_URL): Promise<EngineHealth | null> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
    const d = (body.data ?? body) as Record<string, unknown>;
    return {
      initialized: Boolean(d.models_initialized),
      model: (d.loaded_model as string | null) ?? undefined,
      lmModel: (d.loaded_lm_model as string | null) ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Watches the ACE-Step music engine (started with `./kite start`) and talks to its REST API.
 * Kite never starts or stops the engine itself; it only offers music tools while it is ready.
 */
export class MusicEngine {
  private state: EngineState = 'stopped';
  private health: EngineHealth | null = null;
  private timer: NodeJS.Timeout | null = null;

  async init() {
    await this.probe();
    const tick = () => {
      this.timer = setTimeout(() => void this.probe().finally(tick), 5000);
      this.timer.unref();
    };
    tick();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  private async probe() {
    this.health = await engineHealth();
    if (this.health) this.state = this.health.initialized ? 'ready' : 'loading';
    else if (!isLocalUrl(MUSIC_URL)) this.state = 'stopped';
    else if (readSettings()?.music === false) this.state = 'off';
    else this.state = engineInstalled() ? 'stopped' : 'not-installed';
  }

  isReady(): boolean {
    return this.state === 'ready';
  }

  /** One line for the agent's per-turn context. */
  describe(): string {
    switch (this.state) {
      case 'ready':
        return `Music engine: running (${this.health?.model ?? 'ACE-Step'}${this.health?.lmModel ? ` + ${this.health.lmModel}` : ''}). You can compose with generate_music.`;
      case 'loading':
        return 'Music engine: starting up (loading models) — music tools become available on the next message.';
      case 'off':
        return "Music generation: turned off by the user in setup — music tools are unavailable. Don't offer to compose music (the user can drop in their own track); only if they ask for generated music, tell them `./kite setup` in a terminal turns it on.";
      case 'not-installed':
        return 'Music engine: not set up — music tools are unavailable. If the user wants Claude to compose music, tell them to run `./kite setup` in a terminal and turn on music generation.';
      default:
        return 'Music engine: stopped — music tools are unavailable. If the user wants music, ask them to run `./kite start music` in a terminal, then send the request again.';
    }
  }

  // ---------------------------------------------------------------------------
  // REST client

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${musicApiKey()}` };
  }

  private async call<T>(pathname: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${MUSIC_URL}${pathname}`, {
      ...init,
      headers: { ...this.authHeaders(), ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let body: { data?: T; error?: string | null; detail?: unknown } = {};
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }
    if (!res.ok || body.error) {
      const detail =
        body.error ?? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? text.slice(0, 300)));
      throw new Error(`Music engine error (${res.status}): ${detail}`);
    }
    return body.data as T;
  }

  /** Queue a generation; returns the engine's task id. */
  async submit(req: EngineRequest): Promise<string> {
    if (!this.isReady()) throw new Error('The music engine is not running. Start it with `./kite start music`.');
    const fields: Record<string, string | number | boolean> = {
      task_type: req.task,
      prompt: req.prompt,
      lyrics: req.lyrics ?? '',
      batch_size: Math.min(4, Math.max(1, Math.round(req.variations))),
      audio_format: 'wav',
      inference_steps: 8,
      // Keep the brief as written rather than letting the planning model rewrite it.
      use_cot_caption: false,
      use_cot_language: false,
      use_random_seed: req.seed === undefined,
      seed: req.seed ?? -1,
    };
    if (req.lyrics) fields.vocal_language = 'en';
    if (req.bpm) fields.bpm = Math.round(req.bpm);
    if (req.key) fields.key_scale = req.key;
    if (req.timeSignature) fields.time_signature = req.timeSignature;

    let init: RequestInit;
    if (req.task === 'repaint') {
      if (!req.source) throw new Error('Repaint needs a source take');
      fields.repainting_start = req.source.start;
      fields.repainting_end = req.source.end;
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
      const data = await fs.promises.readFile(req.source.file);
      form.append('src_audio', new Blob([new Uint8Array(data)], { type: 'audio/wav' }), path.basename(req.source.file));
      init = { method: 'POST', body: form };
    } else {
      fields.audio_duration = Math.min(600, Math.max(10, req.duration ?? 30));
      // The planning model (5 Hz LM) lays out the song first: better structure, slower.
      fields.thinking = req.quality === 'best';
      init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) };
    }
    const data = await this.call<{ task_id: string }>('/release_task', init);
    if (!data?.task_id) throw new Error('The music engine did not return a task id');
    return data.task_id;
  }

  async poll(taskId: string): Promise<EngineTaskState> {
    const data = await this.call<{ status: number; result?: string; progress_text?: string }[]>('/query_result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id_list: [taskId] }),
    });
    const item = data?.[0];
    if (!item) return { status: 'running', files: [] };
    let results: Record<string, any>[] = [];
    try {
      results = JSON.parse(item.result || '[]');
    } catch {
      results = [];
    }
    if (item.status === 1) {
      return {
        status: 'done',
        files: results
          .filter((r) => r.file)
          .map((r) => ({
            url: String(r.file),
            bpm: r.metas?.bpm ?? undefined,
            key: r.metas?.keyscale || undefined,
            timeSignature: r.metas?.timesignature || undefined,
            duration: r.metas?.duration ?? undefined,
          })),
      };
    }
    const first = results[0] ?? {};
    if (item.status === 2)
      return { status: 'failed', error: first.error || item.progress_text || 'Generation failed', files: [] };
    return { status: 'running', stage: first.stage || item.progress_text || undefined, progress: first.progress, files: [] };
  }

  async download(file: string): Promise<Buffer> {
    const url = file.startsWith('/v1/')
      ? `${MUSIC_URL}${file}`
      : /^https?:/.test(file)
        ? file
        : `${MUSIC_URL}/v1/audio?path=${encodeURIComponent(file)}`;
    const res = await fetch(url, { headers: this.authHeaders(), signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Could not download the generated audio (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

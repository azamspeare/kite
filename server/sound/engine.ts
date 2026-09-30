import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SFX_KEY_FILE, SFX_MODELS_DIR, SFX_PYTHON, SFX_URL } from '../config';
import { isLocalUrl } from '../music/engine';
import { readSettings } from '../settings';

export interface SfxHealth {
  ready: boolean;
  loading: boolean;
  model?: string;
  device?: string;
  error: string | null;
}

export interface SfxRequest {
  prompt: string;
  /** Added to the engine's default negative prompt (music, speech, noise, …). */
  negativePrompt?: string;
  /** Seconds (0.2–20). */
  duration: number;
  /** Clips to generate (1–4). */
  variations: number;
  steps?: number;
  seed?: number;
}

export interface SfxResult {
  sampleRate: number;
  seed: number;
  /** Seconds the engine spent generating. */
  seconds: number;
  /** One WAV file per variation (float, stereo, `sampleRate`). */
  clips: Buffer[];
}

/** off: turned off in `./storyboard setup`. */
export type SfxEngineState = 'off' | 'not-installed' | 'stopped' | 'loading' | 'unusable' | 'ready';

const GENERATE_TIMEOUT_MS = 5 * 60 * 1000;

/** The Python environment `./storyboard setup` creates in engines/sfx. */
export function sfxEngineInstalled(): boolean {
  return fs.existsSync(SFX_PYTHON);
}

/** The files engines/sfx/server.py loads (the same list as its REQUIRED_FILES). */
const MODEL_FILES = [
  'model_index.json',
  'scheduler/scheduler_config.json',
  'text_encoder/model.safetensors',
  'tokenizer/tokenizer.json',
  'transformer/diffusion_pytorch_model.safetensors',
  'vae/diffusion_pytorch_model.safetensors',
  'projection_model/diffusion_pytorch_model.safetensors',
];

/** Whether `./storyboard setup` has downloaded Stable Audio Open into engines/sfx/models (a Hugging Face cache). */
export function sfxModelDownloaded(): boolean {
  const repo = path.join(SFX_MODELS_DIR, 'models--stabilityai--stable-audio-open-1.0');
  try {
    const commit = fs.readFileSync(path.join(repo, 'refs', 'main'), 'utf8').trim();
    return MODEL_FILES.every((file) => fs.existsSync(path.join(repo, 'snapshots', commit, file)));
  } catch {
    return false;
  }
}

/** The engine's API key: STORYBOARD_SFX_API_KEY, or a random key kept in .storyboard/keys. */
export function sfxApiKey(): string {
  if (process.env.STORYBOARD_SFX_API_KEY) return process.env.STORYBOARD_SFX_API_KEY;
  try {
    const key = fs.readFileSync(SFX_KEY_FILE, 'utf8').trim();
    if (key) return key;
  } catch {
    // create below
  }
  const key = randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(SFX_KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(SFX_KEY_FILE, `${key}\n`, { mode: 0o600 });
  return key;
}

export async function sfxEngineHealth(url = SFX_URL): Promise<SfxHealth | null> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    return {
      ready: body.ready === true,
      loading: body.loading === true,
      model: typeof body.model === 'string' ? body.model : undefined,
      device: typeof body.device === 'string' ? body.device : undefined,
      error: typeof body.error === 'string' ? body.error : null,
    };
  } catch {
    return null;
  }
}

/**
 * Watches the sound-effects engine (started with `./storyboard start`) and talks to its HTTP API.
 * Storyboard never starts or stops the engine itself; it only offers generate_sound while it is ready.
 */
export class SfxEngine {
  private state: SfxEngineState = 'stopped';
  private health: SfxHealth | null = null;
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
    this.health = await sfxEngineHealth();
    const h = this.health;
    if (h) this.state = h.ready ? 'ready' : h.loading ? 'loading' : h.error ? 'unusable' : 'loading';
    else if (!isLocalUrl(SFX_URL)) this.state = 'stopped';
    else if (readSettings()?.sfx === false) this.state = 'off';
    else this.state = sfxEngineInstalled() && sfxModelDownloaded() ? 'stopped' : 'not-installed';
  }

  isReady(): boolean {
    return this.state === 'ready';
  }

  /** One line for the agent's per-turn context. */
  describe(): string {
    const synth = "create_sound's synth presets still work";
    switch (this.state) {
      case 'ready':
        return 'Sound-effects engine: running (Stable Audio Open). You can make sounds from a text prompt with generate_sound.';
      case 'loading':
        return 'Sound-effects engine: starting up (loading the model) — generate_sound becomes available on the next message.';
      case 'unusable':
        return `Sound-effects engine: running but not usable (${this.health?.error ?? 'unknown error'}) — generate_sound is unavailable; ${synth}. Tell the user if they want AI-generated sounds.`;
      case 'off':
        return `Sound-effects generation: turned off by the user in setup — generate_sound is unavailable; ${synth}. Don't offer AI-generated sounds; only if the user asks for them, tell them \`./storyboard setup\` in a terminal turns them on.`;
      case 'not-installed':
        return `Sound-effects engine: not set up — generate_sound is unavailable; ${synth}. If realistic or very specific sounds are wanted, tell the user to run \`./storyboard setup\` in a terminal and turn on sound-effects generation.`;
      default:
        return `Sound-effects engine: stopped — generate_sound is unavailable; ${synth}. If the user wants AI-generated sounds, ask them to run \`./storyboard start sfx\` in a terminal, then send the request again.`;
    }
  }

  /** Generate sound effects from a text prompt; one WAV per variation. */
  async generate(req: SfxRequest): Promise<SfxResult> {
    if (!this.isReady()) throw new Error('The sound-effects engine is not running. Start it with `./storyboard start sfx`.');
    let res: Response;
    try {
      res = await fetch(`${SFX_URL}/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sfxApiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          duration: req.duration,
          variations: req.variations,
          steps: req.steps,
          seed: req.seed,
        }),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === 'TimeoutError') throw new Error('The sound-effects engine took longer than 5 minutes');
      throw new Error(`Could not reach the sound-effects engine at ${SFX_URL}: ${err.message}`);
    }
    const text = await res.text();
    let body: { error?: string; sample_rate?: number; seed?: number; seconds?: number; clips?: string[] } = {};
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }
    if (!res.ok) throw new Error(`Sound-effects engine error (${res.status}): ${body.error ?? text.slice(0, 300)}`);
    if (!Array.isArray(body.clips) || body.clips.length === 0) throw new Error('The sound-effects engine returned no audio');
    return {
      sampleRate: body.sample_rate ?? 44100,
      seed: body.seed ?? 0,
      seconds: body.seconds ?? 0,
      clips: body.clips.map((clip) => Buffer.from(clip, 'base64')),
    };
  }
}

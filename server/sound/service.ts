import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProjectState, ResolvedCue, SoundReport } from '../../src/shared/types';
import type { Capturer } from '../capture';
import { measureLoudness, renderSpectrogram } from '../music/service';
import type { ProjectStore } from '../projects';
import { HttpError, formatSeconds } from '../util';
import { SOUND_SAMPLE_RATE, decodeFile, encodeWav, silence, type Stereo } from './audio';
import { checkCues, type CueCheck } from './analysis';
import type { SfxEngine } from './engine';
import { SOUND_NAME, soundLabel, type LibrarySound, type SoundLibrary } from './library';
import { describeMeasure } from './measure';
import { mix, type CueSource, type MixResult } from './mix';
import type { PresetName, SynthParams } from './synth';

const s3 = (x: number) => x.toFixed(3);
const signed = (x: number, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

export interface Mixdown {
  project: ProjectState;
  report: SoundReport;
  /** Cues whose sound isn't in the library (left out of the mix). */
  missing: ResolvedCue[];
  /** null when there is neither a soundtrack nor any cue: the video has no audio. */
  result: MixResult | null;
  sources: CueSource[];
  /** Library sounds in use, by name. */
  used: Map<string, LibrarySound>;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function suggest(name: string, names: string[]): string {
  const best = names.map((n) => ({ n, d: editDistance(name.toLowerCase(), n.toLowerCase()) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d <= Math.max(2, Math.floor(name.length / 3)) ? ` (did you mean "${best.n}"?)` : '';
}

/** Trim silence, fade the edges and bring a generated clip to the library's level (−16 dBFS loudest 50 ms, peak ≤ −1 dBFS). */
export function tidy(audio: Stereo): Stereo {
  const sr = audio.sampleRate;
  const n = audio.left.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(audio.left[i]), Math.abs(audio.right[i]));
  if (peak < 1e-5) return audio;
  const floor = peak * 10 ** (-50 / 20);
  let first = 0;
  while (first < n && Math.abs(audio.left[first]) < floor && Math.abs(audio.right[first]) < floor) first++;
  let last = n - 1;
  while (last > first && Math.abs(audio.left[last]) < floor * 0.3 && Math.abs(audio.right[last]) < floor * 0.3) last--;
  const from = Math.max(0, first - Math.round(0.004 * sr));
  const to = Math.min(n, last + Math.round(0.03 * sr));
  const out = silence(sr, to - from);
  out.left.set(audio.left.subarray(from, to));
  out.right.set(audio.right.subarray(from, to));
  const fadeIn = Math.min(out.left.length, Math.round(0.002 * sr));
  const fadeOut = Math.min(out.left.length, Math.round(0.02 * sr));
  for (let i = 0; i < fadeIn; i++) {
    out.left[i] *= i / fadeIn;
    out.right[i] *= i / fadeIn;
  }
  for (let i = 0; i < fadeOut; i++) {
    const k = out.left.length - 1 - i;
    out.left[k] *= i / fadeOut;
    out.right[k] *= i / fadeOut;
  }
  // Loudest 50 ms RMS.
  const win = Math.round(0.05 * sr);
  let sum = 0;
  let loudest = 0;
  for (let i = 0; i < out.left.length; i++) {
    sum += (out.left[i] ** 2 + out.right[i] ** 2) / 2;
    if (i >= win) sum -= (out.left[i - win] ** 2 + out.right[i - win] ** 2) / 2;
    loudest = Math.max(loudest, Math.sqrt(Math.max(0, sum) / win));
  }
  let outPeak = 0;
  for (let i = 0; i < out.left.length; i++) outPeak = Math.max(outPeak, Math.abs(out.left[i]), Math.abs(out.right[i]));
  const gain = Math.min(10 ** (-16 / 20) / Math.max(loudest, 1e-9), 10 ** (-1 / 20) / outPeak);
  for (let i = 0; i < out.left.length; i++) {
    out.left[i] *= gain;
    out.right[i] *= gain;
  }
  return out;
}

/** Limiter activity within one window of the mix. */
function limiterIn(result: MixResult, from: number, to: number): MixResult['limiter'] {
  const gain = result.gain!;
  const sr = result.audio.sampleRate;
  let min = 1;
  let at = from;
  let limited = 0;
  for (let i = Math.max(0, Math.floor(from * sr)); i < Math.min(gain.length, Math.ceil(to * sr)); i++) {
    if (gain[i] < min) {
      min = gain[i];
      at = i / sr;
    }
    if (gain[i] < 0.891) limited++;
  }
  return { maxReductionDb: Math.min(0, 20 * Math.log10(min)), maxAt: at, limitedSeconds: limited / sr };
}

async function withTempWav<T>(audio: Stereo, fn: (file: string) => Promise<T>): Promise<T> {
  const file = path.join(os.tmpdir(), `sb-sound-${randomUUID().slice(0, 8)}.wav`);
  await fs.writeFile(file, encodeWav(audio));
  try {
    return await fn(file);
  } finally {
    await fs.rm(file, { force: true });
  }
}

function window(audio: Stereo, from: number, to: number): Stereo {
  const a = Math.max(0, Math.floor(from * audio.sampleRate));
  const b = Math.min(audio.left.length, Math.ceil(to * audio.sampleRate));
  return { sampleRate: audio.sampleRate, left: audio.left.slice(a, b), right: audio.right.slice(a, b) };
}

/** Sound effects for the agent tools and renders: cues from the scenes, the mix, measurements and new sounds. */
export class SoundService {
  constructor(private deps: { store: ProjectStore; library: SoundLibrary; capturer: Capturer; engine: SfxEngine }) {}

  /** Every scene's cues, evaluated by a whole-video frame. */
  cues(projectId: string): Promise<SoundReport> {
    return this.deps.capturer.sounds(projectId);
  }

  /** The soundtrack plus every cue, mixed exactly as a render mixes them. */
  async mixdown(projectId: string, opts: { report?: SoundReport; keepBuses?: boolean } = {}): Promise<Mixdown> {
    const { store, library } = this.deps;
    const project = await store.get(projectId);
    const report = opts.report ?? (await this.cues(projectId));
    const total = project.scenes.reduce((sum, s) => sum + s.duration, 0);
    const { sounds } = await library.list(projectId);
    const byName = new Map(sounds.map((s) => [s.name, s]));
    const missing: ResolvedCue[] = [];
    const cues: { cue: ResolvedCue; source: CueSource }[] = [];
    const used = new Map<string, LibrarySound>();
    for (const cue of report.cues) {
      const sound = byName.get(cue.sound);
      if (!sound) {
        missing.push(cue);
        continue;
      }
      used.set(sound.name, sound);
      cues.push({ cue, source: { audio: await library.load(projectId, sound), peak: sound.measure.peak } });
    }
    let music: { audio: Stereo; volume: number } | null = null;
    if (project.music) {
      const file = path.join(project.dir, 'music', project.music.file);
      const audio = await decodeFile(file, { sampleRate: SOUND_SAMPLE_RATE, start: project.music.start, length: total });
      music = { audio, volume: project.music.volume };
    }
    const result =
      music || cues.length
        ? mix({ sampleRate: SOUND_SAMPLE_RATE, duration: total, music, cues, keepBuses: opts.keepBuses })
        : null;
    return { project, report, missing, result, sources: cues.map((c) => c.source), used };
  }

  /** Problems a user would hear (or not hear): broken cues and missing sounds. */
  problems(mixdown: Mixdown, names: string[]): string[] {
    return [
      ...mixdown.report.errors,
      ...mixdown.missing.map(
        (c) =>
          `scenes/${c.sceneId}.tsx sounds[${c.index}] uses "${c.sound}", which isn't in the library${suggest(c.sound, names)}`,
      ),
    ];
  }

  /** check_audio: how every cue sits in the mix, loudness and limiting, and problems. */
  async check(projectId: string, sceneId?: string): Promise<{ text: string; spectrogram: Buffer | null }> {
    const { library } = this.deps;
    const mixdown = await this.mixdown(projectId, { keepBuses: true });
    const { project, result } = mixdown;
    const { sounds, warnings } = await library.list(projectId);
    const scene = sceneId ? project.scenes.find((s) => s.id === sceneId) : undefined;
    if (sceneId && !scene) throw new HttpError(404, `No scene "${sceneId}"`);
    const total = project.scenes.reduce((sum, s) => sum + s.duration, 0);
    const problems = this.problems(
      mixdown,
      sounds.map((s) => s.name),
    ).filter((p) => !scene || p.startsWith(`scenes/${scene.id}.tsx`));
    const lines: string[] = [];
    if (!result) {
      lines.push('This video has no audio: no soundtrack and no sound cues.');
      if (problems.length) lines.push('', 'Problems:', ...problems.map((p) => `- ${p}`));
      return { text: lines.join('\n'), spectrogram: null };
    }
    const checks = checkCues(result, mixdown.sources);
    const from = scene ? scene.start : 0;
    const to = scene ? scene.start + scene.duration : total;
    const shown = checks.filter((c) =>
      scene ? c.place.cue.sceneId === scene.id || (c.place.end > from && c.place.start < to) : true,
    );
    const sceneCount = new Set(mixdown.report.cues.map((c) => c.sceneId)).size;
    lines.push(
      `Audio of "${project.name}" (${formatSeconds(total)}): ${
        project.music ? `soundtrack ${project.music.file} at volume ${project.music.volume.toFixed(2)}` : 'no soundtrack'
      } + ${mixdown.report.cues.length} cue${mixdown.report.cues.length === 1 ? '' : 's'} from ${sceneCount} scene${sceneCount === 1 ? '' : 's'} using ${mixdown.used.size} sound${mixdown.used.size === 1 ? '' : 's'}.`,
    );
    const master = await withTempWav(window(result.audio, from, to), async (file) => ({
      loudness: await measureLoudness(file),
      spectrogram: await renderSpectrogram(file),
    }));
    const lim = scene ? limiterIn(result, from, to) : result.limiter;
    lines.push(
      `${scene ? `Scene ${scene.id} (${s3(from)}–${s3(to)} s)` : 'Master'}: ${master.loudness ?? 'loudness not measured'}; ${
        lim.maxReductionDb < -0.5
          ? `the −1 dBFS limiter pulled up to ${Math.abs(lim.maxReductionDb).toFixed(1)} dB (at ${s3(lim.maxAt)} s), ${lim.limitedSeconds.toFixed(2)} s over 1 dB in total.`
          : 'the limiter barely works (no clipping risk).'
      }`,
    );
    if (shown.length) {
      lines.push(
        '',
        'Cues (video time · scene@at · sound, settings and its main frequency range · how it cuts through everything else playing then):',
      );
      for (const c of shown) lines.push(`  ${this.cueLine(c, mixdown.used.get(c.place.cue.sound))}`);
      const weak = shown.filter((c) => c.verdict === 'masked' || c.verdict === 'faint').length;
      const squashed = shown.filter((c) => c.limitDb < -2).length;
      lines.push(
        '',
        'Reading this: clear ≥ +8 dB, audible ≥ +2 dB, faint ≥ −4 dB, masked below that (likely unheard).' +
          (weak
            ? ` ${weak} cue${weak === 1 ? ' is' : 's are'} faint or masked: raise volume, choose a sound in a range the music leaves free (see the spectrogram), or lower the music with set_music_volume.`
            : '') +
          (squashed
            ? ` ${squashed} cue${squashed === 1 ? ' is' : 's are'} squashed by the limiter: lower their volume or the music.`
            : ''),
      );
    } else {
      lines.push('', scene ? 'No cues sound in this scene.' : 'No sound cues yet.');
    }
    if (problems.length || warnings.length) lines.push('', 'Problems:', ...[...problems, ...warnings].map((p) => `- ${p}`));
    return { text: lines.join('\n'), spectrogram: master.spectrogram };
  }

  private cueLine(c: CueCheck, sound: LibrarySound | undefined): string {
    const cue = c.place.cue;
    const settings = [
      cue.volume !== 1 ? `vol ${cue.volume.toFixed(2)}` : '',
      cue.pitch ? `pitch ${signed(cue.pitch)}` : '',
      cue.pan ? `pan ${signed(cue.pan, 2)}` : '',
      cue.align === 'peak' ? `peak-aligned, starts ${s3(c.place.start)} s` : '',
      cue.duration !== undefined ? `cut at ${cue.duration.toFixed(2)} s` : '',
    ].filter(Boolean);
    const verdict =
      c.verdict === 'outside'
        ? 'outside the video'
        : c.verdict === 'silent'
          ? 'silent'
          : `${c.verdict} ${signed(c.smr)} dB${c.limitDb < -1 ? ` · limiter ${c.limitDb.toFixed(1)} dB` : ''}`;
    const range = sound
      ? ` [${sound.measure.band.map((hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz}`)).join('–')} Hz]`
      : '';
    return `${s3(cue.t)} s  ${cue.sceneId}@${s3(cue.at)}  ${cue.sound}${settings.length ? ` (${settings.join(', ')})` : ''}${range} → ${verdict}`;
  }

  /** How many cues use each sound (and where), from the scenes as they are now. */
  async usage(projectId: string): Promise<Map<string, ResolvedCue[]>> {
    const report = await this.cues(projectId);
    const map = new Map<string, ResolvedCue[]>();
    for (const cue of report.cues) map.set(cue.sound, [...(map.get(cue.sound) ?? []), cue]);
    return map;
  }

  describeSound(sound: LibrarySound, uses?: ResolvedCue[]): string {
    const lines = [`Sound "${sound.name}" (${sound.source}) — ${soundLabel(sound)}`, describeMeasure(sound.measure)];
    if (uses) {
      lines.push(
        uses.length
          ? `Used by ${uses.length} cue${uses.length === 1 ? '' : 's'}: ${uses
              .slice(0, 12)
              .map((c) => `${c.sceneId}@${s3(c.at)}`)
              .join(', ')}${uses.length > 12 ? ', …' : ''}`
          : 'Not used by any cue yet.',
      );
    }
    return lines.join('\n');
  }

  /** describe_sound: measurements, how it was made, where it's used, and a spectrogram. */
  async describe(projectId: string, name: string): Promise<{ text: string; spectrogram: Buffer | null }> {
    const { library } = this.deps;
    const { sound, file } = await library.audioFile(projectId, name);
    const uses = (await this.usage(projectId)).get(name) ?? [];
    return { text: this.describeSound(sound, uses), spectrogram: await renderSpectrogram(file) };
  }

  /** create_sound: one synth sound, or several variants named name-1 … name-N (different seeds). */
  async create(
    projectId: string,
    input: { name: string; preset: PresetName; params: SynthParams; variants: number; replace: boolean },
  ): Promise<LibrarySound[]> {
    const count = Math.max(1, Math.min(8, Math.round(input.variants)));
    const seed = input.params.seed ?? 1;
    const out: LibrarySound[] = [];
    for (let i = 0; i < count; i++) {
      const name = count === 1 ? input.name : `${input.name}-${i + 1}`;
      out.push(
        await this.deps.library.createSynth(projectId, {
          name,
          preset: input.preset,
          params: { ...input.params, seed: seed + i },
          replace: input.replace,
        }),
      );
    }
    return out;
  }

  /** generate_sound: the sound-effects engine makes takes, which are tidied and kept as name, or name-a, name-b, … */
  async generate(
    projectId: string,
    input: { name: string; prompt: string; duration: number; variations: number; seed?: number; replace: boolean },
  ): Promise<{ sounds: LibrarySound[]; seconds: number }> {
    if (!SOUND_NAME.test(input.name)) {
      throw new HttpError(400, `Invalid sound name "${input.name}": use lowercase letters, digits and dashes (e.g. "pin-drop").`);
    }
    const result = await this.deps.engine.generate({
      prompt: input.prompt,
      duration: input.duration,
      variations: input.variations,
      seed: input.seed,
    });
    const sounds: LibrarySound[] = [];
    for (const [i, clip] of result.clips.entries()) {
      const name = result.clips.length === 1 ? input.name : `${input.name}-${String.fromCharCode(97 + i)}`;
      const file = path.join(os.tmpdir(), `sb-sfx-${randomUUID().slice(0, 8)}.wav`);
      await fs.writeFile(file, clip);
      try {
        const audio = tidy(await decodeFile(file, { sampleRate: SOUND_SAMPLE_RATE }));
        sounds.push(
          await this.deps.library.addGenerated(projectId, {
            name,
            audio,
            prompt: input.prompt,
            seed: result.seed + i,
            model: 'stable-audio-open-1.0',
            replace: input.replace,
          }),
        );
      } finally {
        await fs.rm(file, { force: true });
      }
    }
    return { sounds, seconds: result.seconds };
  }

  /** Render the mix to a WAV for ffmpeg; null when the video has no audio. Also returns warnings for the render log. */
  async renderMix(projectId: string, report: SoundReport, file: string): Promise<{ written: boolean; warnings: string[] }> {
    const mixdown = await this.mixdown(projectId, { report });
    const { sounds } = await this.deps.library.list(projectId);
    const warnings = this.problems(
      mixdown,
      sounds.map((s) => s.name),
    );
    if (!mixdown.result) return { written: false, warnings };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, encodeWav(mixdown.result.audio));
    return { written: true, warnings };
  }
}

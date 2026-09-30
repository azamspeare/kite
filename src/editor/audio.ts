import type { ProjectState, ResolvedCue } from '../shared/types';

export interface PlayRequest {
  project: ProjectState;
  cues: ResolvedCue[];
  /** Video time to start from. */
  from: number;
  /** Video time where the previewed window ends (the scene's end, or the video's). */
  until: number;
}

/**
 * Preview audio: the soundtrack and every sound cue scheduled on one Web Audio clock, so effects land
 * on the same sample they do in the render (same placement, pitch-as-rate and pan law as server/sound/mix.ts).
 * The clock also drives the playhead while playing.
 */
class PreviewAudio {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  /** Decodes without a running context (browsers only start audio after a click). */
  private decoder: OfflineAudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private voices: AudioScheduledSourceNode[] = [];
  private musicGain: GainNode | null = null;
  private audition: AudioBufferSourceNode | null = null;
  private generation = 0;
  private muted = false;
  /** Set once playback started: ctx time of video time `from`, or a wall clock when audio can't run. */
  private clock: { from: number; ctxStart: number } | { from: number; wallStart: number } | null = null;
  private pendingFrom: number | null = null;

  private context(): { ctx: AudioContext; bus: GainNode } {
    if (!this.ctx || !this.bus) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      // Stands in for the render's −1 dBFS limiter.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.08;
      const bus = ctx.createGain();
      bus.gain.value = this.muted ? 0 : 1;
      bus.connect(limiter).connect(ctx.destination);
      this.ctx = ctx;
      this.bus = bus;
    }
    return { ctx: this.ctx, bus: this.bus };
  }

  /** Fetch and decode once per URL (URLs are versioned, so a changed sound is a new URL). */
  load(url: string): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(url);
    if (!buffer) {
      buffer = fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data) => (this.decoder ??= new OfflineAudioContext(2, 1, 48000)).decodeAudioData(data))
        .catch((e: Error) => {
          console.warn(`[storyboard] could not load ${url}: ${e.message}`);
          this.buffers.delete(url);
          return null;
        });
      this.buffers.set(url, buffer);
    }
    return buffer;
  }

  /** Warm the cache so pressing play starts at once, and forget audio the project no longer uses (old takes). */
  preload(project: ProjectState, cues: ResolvedCue[]) {
    const keep = new Set([project.musicUrl, ...project.sounds.map((s) => s.url)]);
    for (const url of this.buffers.keys()) if (!keep.has(url)) this.buffers.delete(url);
    if (project.musicUrl) void this.load(project.musicUrl);
    const urls = new Map(project.sounds.map((s) => [s.name, s.url]));
    for (const name of new Set(cues.map((c) => c.sound))) {
      const url = urls.get(name);
      if (url) void this.load(url);
    }
  }

  async start(req: PlayRequest): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.pendingFrom = req.from;
    const { ctx, bus } = this.context();
    await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 400))]);
    const { project } = req;
    const sounds = new Map(project.sounds.map((s) => [s.name, s]));
    const [music, ...cueBuffers] = await Promise.all([
      project.musicUrl ? this.load(project.musicUrl) : Promise.resolve(null),
      ...req.cues.map((c) => {
        const info = sounds.get(c.sound);
        return info ? this.load(info.url) : Promise.resolve(null);
      }),
    ]);
    if (generation !== this.generation) return;
    this.pendingFrom = null;
    if (ctx.state !== 'running') {
      // No audio allowed (yet): keep time with the wall clock so the preview still plays.
      this.clock = { from: req.from, wallStart: performance.now() };
      return;
    }
    const when = ctx.currentTime + 0.04;
    this.clock = { from: req.from, ctxStart: when };
    if (music && project.music) {
      const offset = project.music.start + req.from;
      if (offset < music.duration) {
        const src = ctx.createBufferSource();
        src.buffer = music;
        const gain = ctx.createGain();
        gain.gain.value = project.music.volume;
        src.connect(gain).connect(bus);
        src.start(when, offset);
        this.voices.push(src);
        this.musicGain = gain;
      }
    }
    req.cues.forEach((cue, i) => {
      const buffer = cueBuffers[i];
      const info = sounds.get(cue.sound);
      if (!buffer || !info) return;
      const rate = 2 ** (cue.pitch / 12);
      const start = cue.t - (cue.align === 'peak' ? info.peak / rate : 0);
      const end = start + Math.min(buffer.duration / rate, cue.duration ?? Infinity);
      if (end <= req.from || start >= req.until) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = cue.volume;
      const pan = ctx.createStereoPanner();
      pan.pan.value = cue.pan;
      src.connect(gain).connect(pan).connect(bus);
      src.start(when + Math.max(0, start - req.from), Math.max(0, req.from - start) * rate);
      if (cue.duration !== undefined && buffer.duration / rate > cue.duration) {
        const stopAt = when + (end - req.from);
        gain.gain.setValueAtTime(cue.volume, Math.max(when, stopAt - 0.01));
        gain.gain.linearRampToValueAtTime(0, stopAt);
        src.stop(stopAt);
      }
      this.voices.push(src);
    });
  }

  stop() {
    this.generation++;
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        // never started
      }
      voice.disconnect();
    }
    this.voices = [];
    this.musicGain = null;
    this.clock = null;
    this.pendingFrom = null;
  }

  /** Video time being heard right now; null when not playing. Holds still while playback is starting. */
  now(): number | null {
    if (this.pendingFrom !== null) return this.pendingFrom;
    const clock = this.clock;
    if (!clock) return null;
    if ('wallStart' in clock) return clock.from + (performance.now() - clock.wallStart) / 1000;
    const ctx = this.ctx!;
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return clock.from + Math.max(0, ctx.currentTime - clock.ctxStart - latency);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.bus) this.bus.gain.value = muted ? 0 : 1;
  }

  setMusicVolume(volume: number) {
    if (this.musicGain) this.musicGain.gain.value = volume;
  }

  /** Play one library sound on its own (the Sounds list). */
  async play(url: string): Promise<void> {
    const { ctx } = this.context();
    await ctx.resume().catch(() => undefined);
    const buffer = await this.load(url);
    if (!buffer) throw new Error('This sound could not be loaded');
    try {
      this.audition?.stop();
    } catch {
      // already ended
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // Straight to the output: auditioning ignores the preview's mute.
    src.connect(ctx.destination);
    src.start();
    this.audition = src;
  }
}

export const previewAudio = new PreviewAudio();

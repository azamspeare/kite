import type { ProjectState, SceneState } from '../src/shared/types';
import { round } from './util';

const fmt = (x: number) => round(x, 3).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

/** Track time → video time. */
function toVideo(p: ProjectState, trackTime: number) {
  return trackTime - (p.music?.start ?? 0);
}

export function musicSummary(p: ProjectState): string {
  const a = p.musicAnalysis;
  if (!p.music) return 'No soundtrack. The beat grid falls back to a steady 120 BPM from each scene start.';
  if (!a) return `Soundtrack "${p.music.file}" is still being analyzed.`;
  return `Soundtrack "${p.music.file}": ${fmt(a.bpm)} BPM, ${a.beatsPerBar}/4, beat = ${fmt(60 / a.bpm)}s, bar = ${fmt((60 / a.bpm) * a.beatsPerBar)}s. Video t = 0 is ${fmt(p.music.start)}s into the track.`;
}

/** Beats, bars, phrases and sections around one scene, in scene-local seconds. */
export function sceneMusicContext(p: ProjectState, scene: SceneState, detailed = true): string {
  const a = p.musicAnalysis;
  if (!p.music || !a) return musicSummary(p);
  const start = scene.start;
  const end = scene.start + scene.duration;
  const local = (trackTime: number) => toVideo(p, trackTime) - start;
  const within = (trackTime: number, pad = 0.05) => {
    const v = toVideo(p, trackTime);
    return v >= start - pad && v <= end + pad;
  };
  const lines = [musicSummary(p)];
  lines.push(`This scene covers video ${fmt(start)}s–${fmt(end)}s. All times below are scene-local seconds (0 = first frame).`);
  const downbeatIndex = new Map(a.downbeats.map((d, i) => [round(d, 4), i + 1]));
  const beats = a.beats.filter((b) => within(b));
  if (beats.length) {
    lines.push(
      `Beats: ${beats
        .map((b) => {
          const bar = downbeatIndex.get(round(b, 4));
          return bar ? `${fmt(local(b))} [bar ${bar}]` : fmt(local(b));
        })
        .join(', ')}`,
    );
  } else {
    lines.push('No detected beats fall inside this scene (silence or outside the track).');
  }
  const phrases = a.phrases.filter((x) => within(x));
  if (phrases.length) lines.push(`Phrase starts: ${phrases.map((x) => fmt(local(x))).join(', ')}`);
  const sections = a.sections.filter((s) => toVideo(p, s.end) > start && toVideo(p, s.start) < end);
  if (sections.length) {
    lines.push(
      `Sections: ${sections
        .map((s) => `${s.label} ${fmt(local(s.start))}→${fmt(local(s.end))} (energy ${s.energy.toFixed(2)})`)
        .join('; ')}`,
    );
  }
  if (detailed) {
    const accents = a.accents.filter((x) => within(x.t) && x.strength >= 0.4);
    if (accents.length) {
      lines.push(`Accents (hits): ${accents.map((x) => `${fmt(local(x.t))} (${x.strength.toFixed(2)})`).join(', ')}`);
    }
    const nextBars = a.downbeats
      .map((d) => toVideo(p, d) - start)
      .filter((d) => d > 0.3)
      .slice(0, 6);
    if (nextBars.length) {
      lines.push(`Durations that end this scene exactly on a bar line: ${nextBars.map(fmt).join('s, ')}s`);
    }
  }
  return lines.join('\n');
}

export type SnapGrid = 'beat' | 'bar' | 'phrase';

/** New durations so every cut lands on the nearest grid point (scenes keep ≥ 0.4 s). */
export function snapCuts(
  p: ProjectState,
  grid: SnapGrid,
): { durations: Record<string, number>; moved: number; maxShift: number } {
  const a = p.musicAnalysis;
  if (!a) throw new Error('The project has no analyzed soundtrack');
  const source = grid === 'beat' ? a.beats : grid === 'bar' ? a.downbeats : a.phrases.length > 1 ? a.phrases : a.downbeats;
  const points = source.map((x) => toVideo(p, x));
  const nearest = (t: number) => points.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), points[0] ?? t);
  const durations: Record<string, number> = {};
  let prev = 0;
  let moved = 0;
  let maxShift = 0;
  let cursor = 0;
  p.scenes.forEach((scene) => {
    cursor += scene.duration;
    let cut = nearest(cursor);
    if (cut - prev < 0.4) cut = prev + Math.max(0.4, scene.duration);
    const shift = Math.abs(cut - cursor);
    if (shift > 0.0005) moved++;
    maxShift = Math.max(maxShift, shift);
    durations[scene.id] = round(cut - prev, 3);
    prev = cut;
  });
  return { durations, moved, maxShift: round(maxShift, 3) };
}

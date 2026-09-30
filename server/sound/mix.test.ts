import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResolvedCue } from '../../src/shared/types';
import { checkCues } from './analysis';
import { decodeWav, encodeWav, silence, type Stereo } from './audio';
import { measureSound } from './measure';
import { CEILING, END_FADE, limit, mix, panGains, placeCue } from './mix';

const SR = 48000;

function cue(partial: Partial<ResolvedCue> & { t: number }): ResolvedCue {
  return { sceneId: 's', index: 0, at: partial.t, sound: 'x', volume: 1, pitch: 0, pan: 0, align: 'start', ...partial };
}

/** A click: one full-scale sample, then silence. */
function impulse(length = 0.1, at = 0): Stereo {
  const a = silence(SR, Math.round(length * SR));
  a.left[Math.round(at * SR)] = 0.5;
  a.right[Math.round(at * SR)] = 0.5;
  return a;
}

function tone(freq: number, seconds: number, amp: number): Stereo {
  const a = silence(SR, Math.round(seconds * SR));
  for (let i = 0; i < a.left.length; i++) a.left[i] = a.right[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return a;
}

function firstNonZero(a: Float32Array): number {
  return a.findIndex((v) => Math.abs(v) > 1e-6);
}

test('WAV round trip keeps float samples', () => {
  const a = tone(440, 0.05, 0.3);
  a.right[10] = -0.9;
  const back = decodeWav(encodeWav(a))!;
  assert.equal(back.sampleRate, SR);
  assert.equal(back.left.length, a.left.length);
  assert.deepEqual(back.left, a.left);
  assert.deepEqual(back.right, a.right);
});

test('a cue lands on its sample, and align peak moves the start back by the peak time', () => {
  const source = { audio: impulse(0.2, 0.05), peak: 0.05 };
  const at = mix({ sampleRate: SR, duration: 2, music: null, cues: [{ cue: cue({ t: 1 }), source }] });
  assert.equal(firstNonZero(at.audio.left), Math.round(1.05 * SR));
  const peak = mix({ sampleRate: SR, duration: 2, music: null, cues: [{ cue: cue({ t: 1, align: 'peak' }), source }] });
  assert.equal(firstNonZero(peak.audio.left), Math.round(1 * SR));
  assert.equal(peak.placements[0].start, 0.95);
});

test('pitch changes the rate: +12 semitones plays twice as fast', () => {
  const p = placeCue(cue({ t: 0, pitch: 12, align: 'peak' }), { audio: silence(SR, SR), peak: 0.5 });
  assert.equal(p.rate, 2);
  assert.ok(Math.abs(p.end - p.start - 0.5) < 1e-9);
  assert.ok(Math.abs(p.start + 0.25) < 1e-9);
});

test('duration cuts a sound short with a fade', () => {
  const r = mix({
    sampleRate: SR,
    duration: 2,
    music: null,
    cues: [{ cue: cue({ t: 0.5, duration: 0.2 }), source: { audio: tone(300, 1, 0.3), peak: 0 } }],
  });
  const after = r.audio.left.subarray(Math.round(0.71 * SR), Math.round(1.2 * SR));
  assert.ok(after.every((v) => v === 0));
  assert.ok(Math.abs(r.audio.left[Math.round(0.6 * SR)]) > 0 || Math.abs(r.audio.left[Math.round(0.6 * SR) + 40]) > 0);
});

test('pan follows the StereoPanner law for stereo input', () => {
  assert.deepEqual(panGains(0), { ll: 1, rl: Math.cos(Math.PI / 2), lr: 0, rr: 1 });
  const left = panGains(-1);
  assert.ok(Math.abs(left.rl - 1) < 1e-9 && Math.abs(left.rr) < 1e-9);
  const r = mix({
    sampleRate: SR,
    duration: 1,
    music: null,
    cues: [{ cue: cue({ t: 0.1, pan: 1 }), source: { audio: tone(500, 0.2, 0.2), peak: 0 } }],
  });
  const span = (a: Float32Array) => Math.max(...a.subarray(Math.round(0.15 * SR), Math.round(0.16 * SR)).map(Math.abs));
  assert.ok(span(r.audio.left) < 1e-6);
  assert.ok(Math.abs(span(r.audio.right) - 0.4) < 0.01);
});

test('the limiter holds −1 dBFS and reports what it did', () => {
  const loud = tone(200, 1, 1.5);
  const { stats } = limit(loud);
  let peak = 0;
  for (let i = 0; i < loud.left.length; i++) peak = Math.max(peak, Math.abs(loud.left[i]));
  assert.ok(peak <= CEILING + 1e-6);
  assert.ok(stats.maxReductionDb < -4);
  const quiet = tone(200, 0.5, 0.3);
  const before = quiet.left.slice();
  assert.equal(limit(quiet).stats.maxReductionDb, 0);
  assert.deepEqual(quiet.left, before);
});

test('music keeps its window and volume, and the end fades out', () => {
  const music = { audio: tone(100, 3, 0.5), volume: 0.5 };
  const r = mix({ sampleRate: SR, duration: 3, music, cues: [] });
  const i = Math.round(1.0025 * SR); // a sine crest (100 Hz → 10 ms period)
  assert.ok(Math.abs(Math.abs(r.audio.left[i]) - 0.25) < 0.01);
  const last = r.audio.left.subarray(r.audio.left.length - 20);
  assert.ok(last.every((v) => Math.abs(v) < 0.01));
  assert.ok(END_FADE > 0);
});

test('measurements find the peak, the tail and the brightness', () => {
  const a = silence(SR, SR);
  // 20 ms of 3 kHz starting at 0.3 s, decaying.
  for (let i = 0; i < 0.2 * SR; i++) {
    const v = 0.8 * Math.exp(-i / (0.02 * SR)) * Math.sin((2 * Math.PI * 3000 * i) / SR);
    a.left[Math.round(0.3 * SR) + i] = v;
    a.right[Math.round(0.3 * SR) + i] = v;
  }
  const m = measureSound(a);
  assert.ok(Math.abs(m.peak - 0.3) < 0.012, `peak ${m.peak}`);
  assert.ok(m.tail > 0.05 && m.tail < 0.25, `tail ${m.tail}`);
  assert.ok(m.centroid > 2500 && m.centroid < 3600, `centroid ${m.centroid}`);
  assert.ok(m.band[0] <= 3000 && m.band[1] >= 3000);
});

test('check: a click over silence is clear, the same click under loud noise at its frequencies is masked', () => {
  const click = tone(2000, 0.05, 0.2);
  const quiet = mix({
    sampleRate: SR,
    duration: 1,
    music: null,
    cues: [{ cue: cue({ t: 0.2 }), source: { audio: click, peak: 0 } }],
    keepBuses: true,
  });
  assert.equal(checkCues(quiet, [{ audio: click, peak: 0 }])[0].verdict, 'clear');

  const noise = silence(SR, SR);
  let seed = 1;
  for (let i = 0; i < noise.left.length; i++) {
    seed = (seed * 16807) % 2147483647;
    noise.left[i] = noise.right[i] = ((seed / 2147483647) * 2 - 1) * 0.9;
  }
  const loud = mix({
    sampleRate: SR,
    duration: 1,
    music: { audio: noise, volume: 1 },
    cues: [{ cue: cue({ t: 0.2, volume: 0.05 }), source: { audio: click, peak: 0 } }],
    keepBuses: true,
  });
  const [checked] = checkCues(loud, [{ audio: click, peak: 0 }]);
  assert.equal(checked.verdict, 'masked', `smr ${checked.smr}`);
});

test('cues outside the video are reported, not mixed', () => {
  const r = mix({
    sampleRate: SR,
    duration: 1,
    music: null,
    cues: [{ cue: cue({ t: 5 }), source: { audio: impulse(), peak: 0 } }],
    keepBuses: true,
  });
  assert.ok(r.audio.left.every((v) => v === 0));
  assert.equal(checkCues(r, [{ audio: impulse(), peak: 0 }])[0].verdict, 'outside');
});

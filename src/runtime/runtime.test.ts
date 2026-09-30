import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MusicAnalysis } from '../shared/types';
import { interpolate, keyframes, progress, spring, springDuration, springs } from './animate';
import { mixColor, interpolateColor } from './color';
import { bezier, ease } from './easing';
import { createMusic } from './music';
import { noise, random } from './random';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe('interpolate', () => {
  test('clamps outside the range by default', () => {
    assert.equal(interpolate(-1, [0, 1], [10, 20]), 10);
    assert.equal(interpolate(2, [0, 1], [10, 20]), 20);
  });

  test('extrapolates when clamp is false', () => {
    close(interpolate(2, [0, 1], [10, 20], { clamp: false }), 30);
  });

  test('multi-stop with per-segment easing', () => {
    const v = (t: number) => interpolate(t, [0, 1, 2], [0, 1, 0], { easing: [ease.linear, ease.inQuad] });
    close(v(0.5), 0.5);
    close(v(1.5), 1 - 0.25);
  });

  test('keyframes tuples match interpolate', () => {
    close(
      keyframes(0.5, [
        [0, 0],
        [1, 10, ease.outCubic],
      ]),
      10 * ease.outCubic(0.5),
    );
  });

  test('progress handles zero-length ranges', () => {
    assert.equal(progress(0.99, 1, 1), 0);
    assert.equal(progress(1, 1, 1), 1);
  });
});

describe('easing', () => {
  test('bezier matches endpoints and css ease midpoint', () => {
    const e = bezier(0.25, 0.1, 0.25, 1);
    assert.equal(e(0), 0);
    assert.equal(e(1), 1);
    close(e(0.5), 0.8024, 1e-3);
  });

  test('every named easing maps 0→0 and 1→1', () => {
    for (const [name, fn] of Object.entries(ease)) {
      if (typeof fn !== 'function' || fn.length !== 1 || ['bezier', 'backOut', 'steps'].includes(name)) continue;
      close((fn as (x: number) => number)(0), 0, 1e-6);
      close((fn as (x: number) => number)(1), 1, 1e-6);
    }
  });
});

describe('spring', () => {
  test('starts at from and settles at to', () => {
    assert.equal(spring(0, { from: 50, to: 0 }), 50);
    close(spring(5, { from: 50, to: 0, ...springs.snappy }), 0, 1e-3);
  });

  test('bouncy overshoots, smooth does not', () => {
    const peak = (cfg: object) => Math.max(...Array.from({ length: 200 }, (_, i) => spring(i / 100, { ...cfg })));
    assert.ok(peak(springs.bouncy) > 1.05);
    assert.ok(peak(springs.smooth) <= 1.001);
  });

  test('duration estimate is sane', () => {
    const d = springDuration(springs.snappy);
    assert.ok(d > 0.1 && d < 2, `duration ${d}`);
  });
});

describe('color', () => {
  test('mixes hex colors', () => {
    assert.equal(mixColor('#000000', '#ffffff', 0.5), 'rgba(128, 128, 128, 1)');
    assert.equal(interpolateColor(1, [0, 1], ['#ff0000', '#0000ff']), 'rgba(0, 0, 255, 1)');
  });
});

describe('random', () => {
  test('is deterministic per seed and in [0, 1)', () => {
    assert.equal(random('card'), random('card'));
    assert.notEqual(random(1), random(2));
    for (let i = 0; i < 1000; i++) {
      const v = random(i);
      assert.ok(v >= 0 && v < 1);
    }
  });

  test('noise is continuous', () => {
    close(noise(3 - 1e-9, 'x'), noise(3, 'x'), 1e-6);
  });
});

describe('music', () => {
  // 120 BPM track starting at 1.0 s, 4/4, phrases every 4 bars.
  const beats = Array.from({ length: 64 }, (_, i) => 1 + i * 0.5);
  const analysis: MusicAnalysis = {
    version: 1,
    duration: 40,
    sampleRate: 22050,
    bpm: 120,
    beatsPerBar: 4,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    phrases: beats.filter((_, i) => i % 16 === 0),
    sections: [{ start: 0, end: 40, label: 'A', energy: 0.5 }],
    accents: [],
    waveform: [],
  };

  test('beat grid is scene-local', () => {
    // Scene starts 3.25 s into the video; video starts 0 s into the track.
    const m = createMusic({ analysis, musicStart: 0, sceneStart: 3.25, sceneDuration: 4 });
    close(m.beat(0), 0.25); // track beat at 3.5 s
    close(m.bar(0), 1.75); // next downbeat at 5.0 s
    close(m.beat(0.5), 0.5);
    close(m.beat(-1), -0.25);
    close(m.snap(0.9), 0.75);
    close(m.snap(0.9, 'bar'), 1.75);
  });

  test('music start offset shifts the grid', () => {
    const m = createMusic({ analysis, musicStart: 1, sceneStart: 0, sceneDuration: 4 });
    close(m.beat(0), 0);
    close(m.bar(1), 2);
  });

  test('pulse is 1 on the beat and decays', () => {
    const m = createMusic({ analysis, musicStart: 1, sceneStart: 0, sceneDuration: 4 });
    close(m.pulse(0.5), 1);
    assert.ok(m.pulse(0.7) < 1 && m.pulse(0.7) > 0);
  });

  test('without a track the grid is 120 BPM from the scene start', () => {
    const m = createMusic({ analysis: null, musicStart: 0, sceneStart: 10, sceneDuration: 3 });
    assert.equal(m.hasTrack, false);
    close(m.beat(0), 0);
    close(m.beat(3), 1.5);
    close(m.bar(1), 2);
  });

  test('extrapolates past the end of the track', () => {
    const m = createMusic({ analysis, musicStart: 0, sceneStart: 100, sceneDuration: 3 });
    const b0 = m.beat(0);
    assert.ok(b0 >= -0.005 && b0 < 0.5 + 1e-9, `beat(0) = ${b0}`);
    close(m.beat(1) - m.beat(0), 0.5);
  });
});

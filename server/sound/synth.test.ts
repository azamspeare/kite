import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loudness } from './dsp';
import {
  PRESETS,
  PRESET_NAMES,
  SYNTH_SAMPLE_RATE,
  isPreset,
  normalizeParams,
  synthesize,
  type PresetName,
  type StereoAudio,
  type SynthParams,
} from './synth';

const SR = SYNTH_SAMPLE_RATE;

function peak(a: StereoAudio): { value: number; time: number } {
  let value = 0;
  let index = 0;
  for (let i = 0; i < a.left.length; i++) {
    const v = Math.max(Math.abs(a.left[i]), Math.abs(a.right[i]));
    if (v > value) {
      value = v;
      index = i;
    }
  }
  return { value, time: index / a.sampleRate };
}

function assertSound(name: PresetName, params: SynthParams, a: StereoAudio) {
  const label = `${name} ${JSON.stringify(params)}`;
  assert.equal(a.sampleRate, SR, label);
  assert.equal(a.left.length, a.right.length, label);
  assert.ok(a.left.length > 0, label);
  for (let i = 0; i < a.left.length; i++) {
    if (!Number.isFinite(a.left[i]) || !Number.isFinite(a.right[i])) assert.fail(`${label}: non-finite sample at ${i}`);
  }
  const p = peak(a);
  assert.ok(p.value <= 0.9, `${label}: peak ${p.value}`);
  assert.ok(p.value > 0.05, `${label}: nearly silent (peak ${p.value})`);
  const duration = a.left.length / SR;
  const { length } = normalizeParams(name, params);
  // The tail (room, echoes) may ring on after the body, but never for long.
  assert.ok(duration <= length + 6, `${label}: ${duration}s long`);
  // De-clicked ends.
  assert.ok(Math.max(Math.abs(a.left[0]), Math.abs(a.right[0])) < 0.01, `${label}: starts with a click`);
  const last = a.left.length - 1;
  assert.ok(Math.max(Math.abs(a.left[last]), Math.abs(a.right[last])) < 0.01, `${label}: ends with a click`);
}

const same = (a: Float32Array, b: Float32Array) =>
  a.length === b.length &&
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

describe('synth presets', () => {
  for (const name of PRESET_NAMES) {
    test(`${name} renders cleanly with defaults and extreme settings`, () => {
      const { min, max } = PRESETS[name].length;
      const cases: SynthParams[] = [
        {},
        { pitch: -24, length: max, brightness: 1, weight: 1, tail: 1, motion: -1, seed: 99 },
        { pitch: 24, length: min, brightness: 0, weight: 0, tail: 0, motion: 1, seed: -5 },
      ];
      for (const params of cases) assertSound(name, params, synthesize(name, params));
    });

    test(`${name} is deterministic, and the seed varies it`, () => {
      const a = synthesize(name, { seed: 7 });
      const b = synthesize(name, { seed: 7 });
      assert.ok(same(a.left, b.left) && same(a.right, b.right), 'same input, different samples');
      const c = synthesize(name, { seed: 8 });
      assert.ok(!same(a.left, c.left) || !same(a.right, c.right), 'a different seed rendered identical samples');
    });
  }

  test('levels: the loudest 50 ms sits at −16 dB (weighted) unless the peak hits −1 dBFS', () => {
    for (const name of PRESET_NAMES) {
      const a = synthesize(name);
      const p = peak(a).value;
      const db = 20 * Math.log10(loudness(a, SR, Math.round(0.05 * SR)));
      const atCeiling = Math.abs(p - 0.891) < 0.002;
      assert.ok(atCeiling || Math.abs(db + 16) < 0.2, `${name}: loudness ${db.toFixed(2)} dB, peak ${p.toFixed(3)}`);
      assert.ok(db <= -15.8, `${name}: louder than the target (${db.toFixed(2)} dB)`);
    }
  });

  test('hits land where align: peak expects them', () => {
    for (const name of ['click', 'keystroke', 'tap', 'tick', 'pop', 'impact'] as const) {
      assert.ok(peak(synthesize(name)).time < 0.02, `${name} should peak in its first 20 ms`);
    }
    const riser = synthesize('riser');
    const { length } = normalizeParams('riser');
    assert.ok(peak(riser).time >= length * 0.85 && peak(riser).time <= length + 0.02, `riser peaks at ${peak(riser).time}`);
    const reverse = synthesize('reverse');
    const duration = reverse.left.length / SR;
    assert.ok(peak(reverse).time >= duration * 0.85, `reverse peaks at ${peak(reverse).time} of ${duration}`);
    const whoosh = synthesize('whoosh');
    const at = peak(whoosh).time / normalizeParams('whoosh').length;
    assert.ok(at > 0.4 && at < 0.8, `whoosh peaks ${(at * 100).toFixed(0)}% in`);
  });

  test('motion moves the sound across the stereo field', () => {
    const rms = (a: Float32Array, from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += a[i] * a[i];
      return Math.sqrt(sum / Math.max(1, to - from));
    };
    for (const name of ['whoosh', 'swish', 'riser', 'reverse'] as const) {
      const a = synthesize(name, { motion: 1, tail: 0 });
      const third = Math.floor(a.left.length / 3);
      assert.ok(rms(a.left, 0, third) > rms(a.right, 0, third), `${name} should start on the left`);
      assert.ok(
        rms(a.right, 2 * third, a.left.length) > rms(a.left, 2 * third, a.left.length),
        `${name} should end on the right`,
      );
    }
  });
});

describe('normalizeParams', () => {
  test('fills preset defaults', () => {
    assert.deepEqual(normalizeParams('whoosh'), {
      pitch: 0,
      length: PRESETS.whoosh.length.default,
      brightness: 0.5,
      weight: 0.5,
      tail: 0.2,
      motion: 0,
      seed: 1,
    });
  });

  test('clamps and rounds out-of-range values', () => {
    const p = normalizeParams('click', {
      pitch: 99,
      length: 5,
      brightness: -1,
      weight: 2,
      tail: Number.NaN,
      motion: 3,
      seed: 2.6,
    });
    assert.deepEqual(p, {
      pitch: 24,
      length: PRESETS.click.length.max,
      brightness: 0,
      weight: 1,
      tail: 0.15,
      motion: 1,
      seed: 3,
    });
    assert.equal(normalizeParams('click', { length: 0 }).length, PRESETS.click.length.min);
    assert.equal(normalizeParams('click', { pitch: -30.456 }).pitch, -24);
    assert.equal(normalizeParams('click', { brightness: 0.12345 }).brightness, 0.123);
  });

  test('normalized params render the same as the originals', () => {
    const raw = { pitch: 1.234567, brightness: 0.33333, seed: 4 };
    const a = synthesize('pop', raw);
    const b = synthesize('pop', normalizeParams('pop', raw));
    assert.ok(same(a.left, b.left) && same(a.right, b.right));
  });
});

describe('preset table', () => {
  test('every preset is described with a sensible length range', () => {
    assert.equal(PRESET_NAMES.length, 22);
    for (const name of PRESET_NAMES) {
      const info = PRESETS[name];
      assert.equal(info.name, name);
      assert.ok(info.description.length > 10, name);
      assert.ok(info.length.min > 0 && info.length.min <= info.length.default && info.length.default <= info.length.max, name);
    }
  });

  test('isPreset', () => {
    assert.ok(isPreset('click'));
    assert.ok(isPreset('sub-drop'));
    assert.ok(!isPreset('Click'));
    assert.ok(!isPreset('toString'));
  });
});

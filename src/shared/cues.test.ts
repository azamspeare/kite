import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCue } from './cues';

test('a minimal cue gets the defaults', () => {
  assert.deepEqual(readCue({ at: 1.2, sound: ' pop ' }), { at: 1.2, sound: 'pop', volume: 1, pitch: 0, pan: 0, align: 'start' });
});

test('every field is kept, pitch and pan are clamped', () => {
  assert.deepEqual(readCue({ at: -0.2, sound: 'whoosh', volume: 0.5, pitch: 40, pan: -3, align: 'peak', duration: 0.3 }), {
    at: -0.2,
    sound: 'whoosh',
    volume: 0.5,
    pitch: 24,
    pan: -1,
    align: 'peak',
    duration: 0.3,
  });
});

test('broken cues say what is wrong', () => {
  assert.match(String(readCue(null)), /not a cue/);
  assert.match(String(readCue({ sound: 'pop' })), /`at`/);
  assert.match(String(readCue({ at: Number.NaN, sound: 'pop' })), /`at`/);
  assert.match(String(readCue({ at: 1 })), /`sound`/);
  assert.match(String(readCue({ at: 1, sound: 'pop', volume: -1 })), /`volume`/);
  assert.match(String(readCue({ at: 1, sound: 'pop', align: 'end' })), /`align`/);
  assert.match(String(readCue({ at: 1, sound: 'pop', duration: 0 })), /`duration`/);
});

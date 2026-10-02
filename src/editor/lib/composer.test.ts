import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Attachment } from '../../shared/types';
import { insertMention, mentionQuery, readDraft, slashQuery, writeDraft } from './composer';

test('"/" opens the tools only when it is the whole input and no tool is chosen', () => {
  assert.equal(slashQuery('/', null), '');
  assert.equal(slashQuery('/An', null), 'an');
  assert.equal(slashQuery('/an', 'design'), null);
  assert.equal(slashQuery('hi /an', null), null);
  assert.equal(slashQuery('/an ', null), null);
});

test('"@" opens the scenes for a trailing mention after a space or at the start', () => {
  assert.deepEqual(mentionQuery('look at @sc'), { word: 'sc', digits: '' });
  assert.deepEqual(mentionQuery('@scene2'), { word: 'scene', digits: '2' });
  assert.deepEqual(mentionQuery('then @'), { word: '', digits: '' });
  assert.deepEqual(mentionQuery('then @3'), { word: '', digits: '3' });
  assert.equal(mentionQuery('a@b'), null);
  assert.equal(mentionQuery('@scene 2'), null);
});

test('choosing a scene writes "@Scene N " in place of the query and puts the caret after it', () => {
  assert.deepEqual(insertMention('see @sc', 7, 3), { text: 'see @Scene 3 ', caret: 13 });
  assert.deepEqual(insertMention('see @sc and more', 7, 1), { text: 'see @Scene 1  and more', caret: 13 });
  assert.deepEqual(insertMention('@', 1, 2), { text: '@Scene 2 ', caret: 9 });
});

test('a draft survives a reload, and an old plain-text draft still loads', () => {
  const file: Attachment = { id: 'a1b2c3-logo.png', name: 'logo.png', kind: 'image', size: 3 };
  assert.deepEqual(readDraft(null), { text: '', tool: null, files: [] });
  assert.deepEqual(readDraft('plain text'), { text: 'plain text', tool: null, files: [] });
  const saved = writeDraft({ text: 'hi', tool: 'sound', files: [file] });
  assert.deepEqual(readDraft(saved), { text: 'hi', tool: 'sound', files: [file] });
  assert.equal(writeDraft({ text: '', tool: null, files: [] }), null);
  // Something stale or hand-edited never breaks the box.
  assert.deepEqual(readDraft('{"text":5,"tool":"nope","files":[{"id":1}]}'), { text: '', tool: null, files: [] });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentKind, extensionOf, isChatToolId, mentionedScenes, toolsFor } from './chatOptions';

test('attachments are images or audio, by extension', () => {
  assert.equal(extensionOf('Logo.Final.PNG'), 'png');
  assert.equal(extensionOf('noext'), '');
  assert.equal(attachmentKind('A.PNG'), 'image');
  assert.equal(attachmentKind('cover.svg'), 'image');
  assert.equal(attachmentKind('x.mp3'), 'audio');
  assert.equal(attachmentKind('take.AIFF'), 'audio');
  assert.equal(attachmentKind('x.pdf'), null);
  assert.equal(attachmentKind('noext'), null);
});

test('the music tool belongs to the project chat only', () => {
  assert.deepEqual(
    toolsFor('scene').map((t) => t.id),
    ['animate', 'design', 'sound'],
  );
  assert.deepEqual(
    toolsFor('project').map((t) => t.id),
    ['animate', 'design', 'sound', 'music'],
  );
  assert.equal(isChatToolId('music'), true);
  assert.equal(isChatToolId('x'), false);
  assert.equal(isChatToolId(undefined), false);
});

test('mentions name scenes by number, in order, once each, skipping numbers with no scene', () => {
  assert.deepEqual(mentionedScenes('see @Scene 2 and @Scene 9 and @Scene 2', ['a', 'b', 'c']), ['b']);
  assert.deepEqual(mentionedScenes('@Scene 3 then @Scene 1', ['a', 'b', 'c']), ['c', 'a']);
  assert.deepEqual(mentionedScenes('@scene 1 and @Scene 0', ['a']), []);
});

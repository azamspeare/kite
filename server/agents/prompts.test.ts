import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Attachment } from '../../src/shared/types';
import { ProjectStore } from '../projects';
import { messageContext, projectTurnPrompt, sceneTurnPrompt } from './prompts';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kite-prompts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  const id = await store.create({ name: 'Test' });
  await store.createScene(id, { name: 'Second' });
  return store.get(id);
}

const image: Attachment = { id: 'a1b2c3-logo.png', name: 'logo.png', kind: 'image', size: 10 };
const audio: Attachment = { id: 'd4e5f6-intro.mp3', name: 'intro.mp3', kind: 'audio', size: 10, duration: 151 };

test('the turn tells the agent which scenes the message mentions and which tool was chosen', async (t) => {
  const p = await fixture(t);
  const second = p.scenes[1];
  const lines = messageContext(p, 'project', { tool: 'animate', scenes: [second.id] });
  assert.ok(lines.includes(`Mentioned: Scene 2 = scenes/${second.id}.tsx ("Second").`), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('Focus on motion and timing')));
  assert.deepEqual(messageContext(p, 'project', {}), []);
});

test('attached files are named by path, with what to do with audio in each chat', async (t) => {
  const p = await fixture(t);
  const project = messageContext(p, 'project', { files: [image, audio] }).join('\n');
  assert.match(project, /assets\/a1b2c3-logo\.png \(image, "logo\.png"\)/);
  assert.match(project, /assets\/d4e5f6-intro\.mp3 \(audio, 2:31, "intro\.mp3"\)/);
  assert.match(project, /open images with Read/);
  assert.match(project, /add_sound_from_attachment/);
  assert.match(project, /set_soundtrack_from_attachment/);
  const scene = messageContext(p, 'scene', { files: [audio] }).join('\n');
  assert.match(scene, /add_sound_from_attachment/);
  assert.doesNotMatch(scene, /set_soundtrack_from_attachment/);
  assert.doesNotMatch(messageContext(p, 'project', { files: [image] }).join('\n'), /add_sound_from_attachment/);
});

test('the context sits inside kite_context, and a message of files alone says so', async (t) => {
  const p = await fixture(t);
  const scenePrompt = sceneTurnPrompt(p, p.scenes[0], '', 1, undefined, { files: [image] });
  assert.match(scenePrompt, /<kite_context>[\s\S]*assets\/a1b2c3-logo\.png[\s\S]*<\/kite_context>\n\nSee the attached files\.$/);
  const projectPrompt = projectTurnPrompt(p, 'Use it', 0, [], { files: [image] });
  assert.match(projectPrompt, /assets\/a1b2c3-logo\.png[\s\S]*<\/kite_context>\n\nUse it$/);
});

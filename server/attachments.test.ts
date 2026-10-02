import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { MAX_IMAGE_BYTES } from '../src/shared/chatOptions';
import { ATTACHMENT_ID, attachmentStem, findAttachments, saveAttachment } from './attachments';
import { HttpError } from './util';

/** A 16-bit mono PCM WAV of silence. */
function wav(seconds: number, sampleRate = 48000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function project(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kite-attach-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function rejects(promise: Promise<unknown>, status: number, message?: RegExp) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof HttpError, `expected an HttpError, got ${String(e)}`);
    assert.equal(e.status, status);
    if (message) assert.match(e.message, message);
    return true;
  });
}

test('an attached image is kept in assets/ under a safe, unique name', async (t) => {
  const dir = await project(t);
  const a = await saveAttachment(dir, 'My Logo (final).png', PNG);
  assert.match(a.id, ATTACHMENT_ID);
  assert.match(a.id, /^[a-z0-9]{6}-My_Logo_final\.png$/);
  assert.equal(a.kind, 'image');
  assert.equal(a.name, 'My Logo (final).png');
  assert.equal(a.size, PNG.length);
  assert.deepEqual(await fs.readFile(path.join(dir, 'assets', a.id)), PNG);
  const b = await saveAttachment(dir, 'My Logo (final).png', PNG);
  assert.notEqual(a.id, b.id);
  assert.equal(attachmentStem(a.id), 'My_Logo_final');
});

test('attached audio is decoded and measured', async (t) => {
  const dir = await project(t);
  const a = await saveAttachment(dir, 'whoosh.wav', wav(0.5));
  assert.equal(a.kind, 'audio');
  assert.ok(a.duration !== undefined && Math.abs(a.duration - 0.5) < 0.02, `duration ${a.duration}`);
});

test('attachments refuse other types, empty and oversized files, and audio that cannot be read', async (t) => {
  const dir = await project(t);
  await rejects(saveAttachment(dir, 'doc.pdf', PNG), 415, /images and audio/);
  await rejects(saveAttachment(dir, 'empty.png', Buffer.alloc(0)), 400);
  await rejects(saveAttachment(dir, 'huge.png', Buffer.alloc(MAX_IMAGE_BYTES + 1)), 413, /10 MB/);
  await rejects(saveAttachment(dir, 'broken.mp3', Buffer.from('not audio at all')), 400, /can't be read as audio/);
  const left = await fs.readdir(path.join(dir, 'assets')).catch(() => []);
  assert.deepEqual(left, [], 'nothing is left behind');
});

test('a message can only point at attachments that exist in this project', async (t) => {
  const dir = await project(t);
  const image = await saveAttachment(dir, 'logo.png', PNG);
  const sound = await saveAttachment(dir, 'hit.wav', wav(0.25));
  const found = await findAttachments(dir, [image.id, sound.id]);
  assert.deepEqual(
    found.map((f) => [f.id, f.name, f.kind]),
    [
      [image.id, 'logo.png', 'image'],
      [sound.id, 'hit.wav', 'audio'],
    ],
  );
  assert.ok(Math.abs((found[1].duration ?? 0) - 0.25) < 0.02);
  for (const bad of ['../etc.png', 'abc.png', '/tmp/a1b2c3-x.png', 'a1b2c3-x.png'])
    await rejects(findAttachments(dir, [bad]), 400, /attached file is missing/);
});

test('an SVG that could run script is refused; a plain one is kept', async (t) => {
  const dir = await project(t);
  const plain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#3cbbf9"/></svg>';
  assert.equal((await saveAttachment(dir, 'mark.svg', Buffer.from(plain))).kind, 'image');
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
  ])
    await rejects(saveAttachment(dir, 'bad.svg', Buffer.from(bad)), 415, /PNG/);
});

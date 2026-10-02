import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { saveAttachment } from './attachments';
import { createToolServer, type Scope, type ToolServices } from './mcp';
import { ProjectStore } from './projects';
import { SoundLibrary } from './sound/library';

function wav(seconds: number, sampleRate = 48000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  // A short click, so the sound isn't silent.
  for (let i = 0; i < 200; i++) b.writeInt16LE(i % 2 ? 12000 : -12000, 44 + i * 2);
  return b;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kite-attach-tools-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  await store.init();
  const id = await store.create({ name: 'Test' });
  const project = await store.get(id);
  const imported: { name: string; size: number }[] = [];
  const soundLibrary = new SoundLibrary(store);
  const services = {
    store,
    soundLibrary,
    engine: { isReady: () => false },
    sfx: { isReady: () => false },
    music: {
      importUpload: async (_: string, name: string, data: Buffer) => {
        imported.push({ name, size: data.length });
        return { id: 'u1' };
      },
    },
  } as unknown as ToolServices;
  const connect = async (scope: Scope) => {
    const server = createToolServer(services, scope);
    const client = new Client({ name: 'test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    t.after(async () => {
      await client.close();
      await server.close();
    });
    return client;
  };
  return { soundLibrary, project, imported, connect };
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');

test('a scene chat can make attached audio a sound, but not the soundtrack', async (t) => {
  const { soundLibrary, project, connect } = await fixture(t);
  const sound = await saveAttachment(project.dir, 'Big Whoosh.wav', wav(0.4));
  const image = await saveAttachment(project.dir, 'logo.png', PNG);
  const client = await connect({ kind: 'scene', projectId: project.id, sceneId: project.scenes[0].id, fileTools: false });
  const tools = (await client.listTools()).tools.map((x) => x.name);
  assert.ok(tools.includes('add_sound_from_attachment'));
  assert.ok(!tools.includes('set_soundtrack_from_attachment'));

  const added = await client.callTool({ name: 'add_sound_from_attachment', arguments: { file: `assets/${sound.id}` } });
  assert.ok(!added.isError, textOf(added));
  assert.match(textOf(added), /Added "Big_Whoosh"/);
  assert.ok((await soundLibrary.list(project.id)).sounds.some((s) => s.name === 'Big_Whoosh'));

  const named = await client.callTool({ name: 'add_sound_from_attachment', arguments: { file: sound.id, name: 'whoosh' } });
  assert.match(textOf(named), /Added "whoosh"/);

  const wrong = await client.callTool({ name: 'add_sound_from_attachment', arguments: { file: `assets/${image.id}` } });
  assert.equal(wrong.isError, true);
  assert.match(textOf(wrong), /image, not audio/);
  const missing = await client.callTool({ name: 'add_sound_from_attachment', arguments: { file: '../../etc/passwd' } });
  assert.equal(missing.isError, true);
});

test('the project chat can make attached audio the soundtrack', async (t) => {
  const { project, imported, connect } = await fixture(t);
  const track = await saveAttachment(project.dir, 'theme.wav', wav(0.4));
  const client = await connect({ kind: 'project', projectId: project.id, fileTools: false });
  const result = await client.callTool({ name: 'set_soundtrack_from_attachment', arguments: { file: `assets/${track.id}` } });
  assert.ok(!result.isError, textOf(result));
  assert.deepEqual(imported, [{ name: 'theme.wav', size: (await fs.stat(path.join(project.dir, 'assets', track.id))).size }]);
});

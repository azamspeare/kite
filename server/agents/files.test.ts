import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createToolServer, type ToolServices } from '../mcp';
import { ProjectStore } from '../projects';
import { ProjectFiles } from './files';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kite-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  await store.init();
  const id = await store.create({ name: 'Test' });
  await store.createScene(id, { name: 'Second' });
  const project = await store.get(id);
  return { root, store, project };
}

test('scoped file tools read reference scenes but only change the selected scene', async (t) => {
  const { project } = await fixture(t);
  const scene = project.scenes[0].id;
  const file = `scenes/${scene}.tsx`;
  const other = `scenes/${project.scenes[1].id}.tsx`;
  const files = new ProjectFiles(project, scene);
  assert.ok((await files.list()).includes(file));
  assert.match(await files.read(other), /export default/);
  await files.write(file, 'one two');
  await files.edit(file, 'two', '$& three');
  assert.equal(await files.read(file), 'one $& three');
  await assert.rejects(files.edit(file, 'missing', 'new'), /exactly once/);
  for (const target of [other, 'art-direction.md', 'project.json', 'components/Test.tsx'])
    await assert.rejects(files.write(target, 'no'), /may not edit/);
});

test('project writes cannot escape through traversal or symlinks or edit internal files', async (t) => {
  const { root, project } = await fixture(t);
  const files = new ProjectFiles(project);
  await files.write('components/nested/Test.tsx', 'export const x = 1;');
  await files.write('art-direction.md', 'New direction');
  for (const file of [
    '../outside',
    '/tmp/outside',
    'components/../project.json',
    'components/.codex/config.toml',
    '.kite/chats/x.json',
    'components\\bad',
  ]) {
    await assert.rejects(files.write(file, 'no'));
    await assert.rejects(files.read(file));
  }
  await assert.rejects(files.write('project.json', 'no'), /may not edit/);
  await assert.rejects(files.write('scenes/unmanaged.tsx', 'no'), /may not edit/);
  await fs.writeFile(path.join(root, 'outside'), 'untouched');
  await fs.symlink(root, path.join(project.dir, 'components', 'link'));
  await assert.rejects(files.read('components/link/outside'), /Symlinks/);
  await assert.rejects(files.write('components/link/new.tsx', 'no'), /Symlinks/);
  await fs.symlink(path.join(root, 'outside'), path.join(project.dir, 'components', 'file.tsx'));
  await assert.rejects(files.write('components/file.tsx', 'no'), /Symlinks/);
  assert.equal(await fs.readFile(path.join(root, 'outside'), 'utf8'), 'untouched');
  assert.ok(!(await files.list()).some((f) => f.includes('link') || f.includes('file.tsx')));
});

test('MCP exposes scoped file tools only on request and rejects cross-project access', async (t) => {
  const { store, project } = await fixture(t);
  const services = { store, engine: { isReady: () => false }, sfx: { isReady: () => false } } as ToolServices;
  const server = createToolServer(services, {
    kind: 'scene',
    projectId: project.id,
    sceneId: project.scenes[0].id,
    fileTools: true,
  });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const tools = (await client.listTools()).tools.map((x) => x.name);
  assert.ok(tools.includes('edit_project_file'));
  assert.ok(!tools.includes('create_scene'));
  assert.ok(!tools.includes('set_music_volume'));
  assert.equal((await client.callTool({ name: 'get_project', arguments: { project: 'another' } })).isError, true);
  const result = await client.callTool({
    name: 'write_project_file',
    arguments: { file: `scenes/${project.scenes[1].id}.tsx`, content: 'no' },
  });
  assert.equal(result.isError, true);
  const own = await client.callTool({
    name: 'write_project_file',
    arguments: { file: `scenes/${project.scenes[0].id}.tsx`, content: 'yes' },
  });
  assert.ok(!own.isError);
  const terminal = createToolServer(services, { kind: 'open' });
  const terminalClient = new Client({ name: 'terminal', version: '1' });
  const [c, d] = InMemoryTransport.createLinkedPair();
  await terminal.connect(c);
  await terminalClient.connect(d);
  t.after(async () => {
    await terminalClient.close();
    await terminal.close();
  });
  assert.ok(!(await terminalClient.listTools()).tools.some((x) => x.name === 'write_project_file'));
});

test('both terminal agents receive the managed scene guide without overwriting custom instructions', async (t) => {
  const { root, store } = await fixture(t);
  assert.equal(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8'));
  await fs.writeFile(path.join(root, 'AGENTS.md'), 'My own instructions');
  await store.init();
  assert.equal(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), 'My own instructions');
});

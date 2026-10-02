import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ProjectStore } from './projects';

test('the project list carries what a project card shows: size and first scene', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kite-list-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ProjectStore(root);
  await store.init();
  const id = await store.create({ name: 'Vertical', width: 1080, height: 1920 });
  const project = await store.get(id);
  const [summary] = await store.list();
  assert.equal(summary.id, id);
  assert.equal(summary.width, 1080);
  assert.equal(summary.height, 1920);
  assert.deepEqual(summary.firstScene, { id: project.scenes[0].id, duration: project.scenes[0].duration });

  // A project needs a scene, but project.json can be edited by hand to have none.
  const file = path.join(root, id, 'project.json');
  await fs.writeFile(file, JSON.stringify({ ...JSON.parse(await fs.readFile(file, 'utf8')), scenes: [] }));
  const [emptied] = await store.list();
  assert.equal(emptied.firstScene, null);
});

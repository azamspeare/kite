import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Info } from './api';

const saved = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
});
const { currentAgent, setInfo, setProvider, setModel, setEffort, useEditor } = await import('./store');

const info: Info = {
  agents: ['claude-code', 'codex'].map((id) => ({
    id: id as 'claude-code' | 'codex',
    label: id,
    ok: true,
    model: `${id}-model`,
    effort: 'medium',
    models: [{ id: `${id}-model`, label: id, efforts: ['medium', 'high', 'max'], defaultEffort: 'medium' }],
  })),
  defaultProvider: 'codex',
  provider: { ok: true, label: 'Codex' },
  model: 'codex-model',
  effort: 'medium',
  efforts: ['medium', 'high'],
  mcpUrl: '',
  projectsDir: '',
};

test('agent preferences follow the server default, survive reloads and keep legacy Claude choices separate', () => {
  saved.set('sb:model', 'legacy-claude-model');
  saved.set('sb:effort', 'max');
  setInfo(info);
  assert.equal(currentAgent()?.id, 'codex');
  assert.equal(useEditor.getState().model, '');
  assert.equal(useEditor.getState().effort, '');
  setModel('codex-model');
  setEffort('high');
  // No explicit provider selection: reloading must still restore the default provider's preferences.
  assert.ok(!saved.has('sb:provider'));
  useEditor.setState({ provider: '', model: '', effort: '', info: null });
  setInfo(info);
  assert.equal(useEditor.getState().model, 'codex-model');
  assert.equal(useEditor.getState().effort, 'high');
  setProvider('claude-code');
  assert.equal(useEditor.getState().model, 'legacy-claude-model');
  assert.equal(useEditor.getState().effort, 'max');
  setModel('claude-code-model');
  setProvider('codex');
  assert.equal(useEditor.getState().model, 'codex-model');
  assert.equal(useEditor.getState().effort, 'high');
  setProvider('claude-code');
  setInfo(info);
  assert.equal(currentAgent()?.id, 'claude-code');
  assert.equal(useEditor.getState().model, 'claude-code-model');
  useEditor.setState({ provider: 'removed-provider' });
  setInfo(info);
  assert.equal(currentAgent()?.id, 'codex');
});

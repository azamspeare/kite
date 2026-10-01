import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelSelection } from '../../src/shared/agents';
import { AgentRegistry } from './registry';
import type { AgentProvider } from './types';

const provider = (id: 'claude-code' | 'codex', ok: boolean): AgentProvider => ({
  id,
  label: id,
  defaultModel: `${id}-model`,
  status: async () => ({ ok, label: id, detail: ok ? undefined : `${id} missing` }),
  models: async () => [
    {
      id: `${id}-model`,
      label: 'Model',
      efforts: id === 'codex' ? ['low', 'medium', 'high'] : ['medium', 'max'],
      defaultEffort: 'medium',
    },
  ],
  async *run() {},
});

test('registry allows Codex-only installations and keeps Claude as the default when both work', async () => {
  const codexOnly = new AgentRegistry([provider('claude-code', false), provider('codex', true)], null);
  assert.equal((await codexOnly.info()).defaultProvider, 'codex');
  assert.equal((await codexOnly.select({})).provider.id, 'codex');
  const both = new AgentRegistry([provider('claude-code', true), provider('codex', true)], null);
  assert.equal((await both.info()).defaultProvider, 'claude-code');
  const preferred = new AgentRegistry(both.providers, 'codex');
  assert.equal((await preferred.select({})).provider.id, 'codex');
});

test('registry validates provider/model combinations and normalizes incompatible effort', async () => {
  const agents = new AgentRegistry([provider('claude-code', true), provider('codex', true)], null);
  await assert.rejects(agents.select({ provider: 'other' }), /Unknown agent provider/);
  await assert.rejects(agents.select({ provider: 'codex', model: 'claude-code-model' }), /not available for codex/);
  const selected = await agents.select({ provider: 'codex', effort: 'max' });
  assert.equal(selected.model, 'codex-model');
  assert.equal(selected.effort, 'medium');
  const codex = (await agents.info()).agents[1];
  assert.deepEqual(modelSelection(codex, 'stale-model', 'max'), {
    model: 'codex-model',
    effort: 'medium',
    efforts: ['low', 'medium', 'high'],
  });
  await assert.rejects(new AgentRegistry([provider('codex', false)], 'codex').select({}), /codex missing/);
});

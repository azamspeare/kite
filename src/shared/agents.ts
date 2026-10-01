export type AgentProviderId = 'claude-code' | 'codex';

export interface AgentModel {
  id: string;
  label: string;
  efforts: string[];
  defaultEffort: string;
}

export interface AgentInfo {
  id: AgentProviderId;
  label: string;
  ok: boolean;
  version?: string;
  detail?: string;
  models: AgentModel[];
  model: string;
  effort: string;
}

/** Keep saved choices valid when switching providers or models. */
export function modelSelection(agent: AgentInfo, model?: string, effort?: string) {
  const selected = agent.models.find((m) => m.id === model) ?? agent.models.find((m) => m.id === agent.model) ?? agent.models[0];
  return {
    model: selected.id,
    efforts: selected.efforts,
    effort: effort && selected.efforts.includes(effort) ? effort : selected.defaultEffort,
  };
}

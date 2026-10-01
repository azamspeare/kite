import type { AgentInfo, AgentProviderId } from '../../src/shared/agents';
import { modelSelection } from '../../src/shared/agents';
import { DEFAULT_EFFORT } from '../config';
import { preferredProvider } from '../settings';
import { HttpError } from '../util';
import type { AgentProvider } from './types';

/** Provider discovery and defaults shared by the API and turn routing. */
export class AgentRegistry {
  constructor(
    readonly providers: AgentProvider[],
    private preference: AgentProviderId | null = preferredProvider() ?? null,
  ) {}

  get(id: string): AgentProvider {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new HttpError(400, `Unknown agent provider: ${id}`);
    return provider;
  }

  async info(): Promise<{ agents: AgentInfo[]; defaultProvider: AgentProviderId }> {
    const agents = await Promise.all(
      this.providers.map(async (provider): Promise<AgentInfo> => {
        const [status, models] = await Promise.all([provider.status(), provider.models()]);
        return { ...status, id: provider.id, models, model: provider.defaultModel, effort: DEFAULT_EFFORT };
      }),
    );
    const defaultProvider = this.preference ?? agents.find((p) => p.ok)?.id ?? agents[0].id;
    for (const agent of agents) {
      if (agent.id === defaultProvider && process.env.STORYBOARD_MODEL) agent.model = process.env.STORYBOARD_MODEL;
      if (!agent.models.some((m) => m.id === agent.model)) {
        const fallback = agent.models[0];
        agent.models.unshift({ ...fallback, id: agent.model, label: agent.model });
      }
      agent.models = agent.models.map((m) => ({
        ...m,
        defaultEffort: m.efforts.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : m.defaultEffort,
      }));
      agent.effort = modelSelection(agent, agent.model, DEFAULT_EFFORT).effort;
    }
    return { agents, defaultProvider };
  }

  async select(input: { provider?: string; model?: string; effort?: string }) {
    if (input.provider) this.get(input.provider);
    const { agents, defaultProvider } = await this.info();
    const agent = agents.find((p) => p.id === (input.provider || defaultProvider))!;
    if (input.model && !agent.models.some((m) => m.id === input.model))
      throw new HttpError(400, `Model "${input.model}" is not available for ${agent.label}`);
    const selection = modelSelection(agent, input.model, input.effort);
    if (!agent.ok) throw new HttpError(503, agent.detail ?? `${agent.label} is not available`);
    return { provider: this.get(agent.id), ...selection };
  }
}

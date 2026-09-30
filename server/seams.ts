import type { ProjectState, SceneState, SeamResult } from '../src/shared/types';
import type { Capturer, SeamCapture } from './capture';
import type { Hub } from './hub';
import type { ProjectStore } from './projects';
import { round } from './util';

export interface SeamCheck {
  result: SeamResult;
  capture?: SeamCapture;
}

/** Pixel-diffs cuts between consecutive scenes, caching results until either side changes. */
export class SeamService {
  private cache = new Map<string, { signature: string; result: SeamResult }>();

  constructor(
    private store: ProjectStore,
    private capturer: Capturer,
    private hub: Hub,
  ) {}

  private signature(p: ProjectState, from: SceneState, to: SceneState) {
    return [p.codeGeneration, from.version, to.version, from.duration, p.width, p.height].join('|');
  }

  private pairs(p: ProjectState, sceneId?: string): [SceneState, SceneState][] {
    const out: [SceneState, SceneState][] = [];
    for (let i = 0; i + 1 < p.scenes.length; i++) {
      const pair: [SceneState, SceneState] = [p.scenes[i], p.scenes[i + 1]];
      if (!sceneId || pair[0].id === sceneId || pair[1].id === sceneId) out.push(pair);
    }
    return out;
  }

  /** Cached results that are still valid for the current project state. */
  async current(projectId: string): Promise<SeamResult[]> {
    const p = await this.store.get(projectId);
    const out: SeamResult[] = [];
    for (const [from, to] of this.pairs(p)) {
      const hit = this.cache.get(`${projectId}|${from.id}|${to.id}`);
      if (hit && hit.signature === this.signature(p, from, to)) out.push(hit.result);
    }
    return out;
  }

  /**
   * Check the cuts touching `sceneId` (or all cuts). `fresh` re-captures even when cached and
   * returns the images, which the agent tool needs.
   */
  async check(projectId: string, opts: { sceneId?: string; fresh?: boolean } = {}): Promise<SeamCheck[]> {
    const p = await this.store.get(projectId);
    const checks: SeamCheck[] = [];
    for (const [from, to] of this.pairs(p, opts.sceneId)) {
      const key = `${projectId}|${from.id}|${to.id}`;
      const signature = this.signature(p, from, to);
      const hit = this.cache.get(key);
      if (!opts.fresh && hit && hit.signature === signature) {
        checks.push({ result: hit.result });
        continue;
      }
      let result: SeamResult;
      let capture: SeamCapture | undefined;
      try {
        capture = await this.capturer.seam(projectId, from.id, to.id);
        result = { from: from.id, to: to.id, diffPercent: round(capture.diffPercent, 2), checkedAt: Date.now() };
        if (capture.errors.length) result.error = capture.errors[0].split('\n')[0];
      } catch (e) {
        result = { from: from.id, to: to.id, diffPercent: -1, checkedAt: Date.now(), error: (e as Error).message };
      }
      this.cache.set(key, { signature, result });
      checks.push({ result, capture });
    }
    this.hub.send({ type: 'seams', projectId, seams: await this.current(projectId) });
    return checks;
  }
}

export function describeSeam(diffPercent: number): string {
  if (diffPercent < 0) return 'could not be checked';
  if (diffPercent === 0) return 'invisible (0% of pixels differ)';
  if (diffPercent < 0.5) return `${diffPercent.toFixed(2)}% of pixels differ — likely anti-aliasing noise`;
  if (diffPercent < 5) return `${diffPercent.toFixed(2)}% of pixels differ — a small visible jump`;
  return `${diffPercent.toFixed(1)}% of pixels differ — a visible cut`;
}

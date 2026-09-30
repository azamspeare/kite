import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import type { ServerEvent } from '../src/shared/types';

/** Pushes server events to editor tabs (SSE) and to scene frames (Vite's HMR socket). */
export class Hub {
  private clients = new Set<ServerResponse>();
  private vite: ViteDevServer | null = null;
  private pending = new Map<string, NodeJS.Timeout>();

  attachVite(vite: ViteDevServer) {
    this.vite = vite;
  }

  handleSse(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }

  send(event: ServerEvent) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(data);
  }

  /** Custom event to every page connected to Vite (frames listen for these). */
  toFrames(event: string, data: unknown) {
    const env = this.vite?.environments?.client;
    if (env) env.hot.send({ type: 'custom', event, data });
    else this.vite?.ws.send({ type: 'custom', event, data });
  }

  /** Debounced "project changed" to editors and frames. */
  projectChanged(projectId: string) {
    const existing = this.pending.get(projectId);
    if (existing) clearTimeout(existing);
    this.pending.set(
      projectId,
      setTimeout(() => {
        this.pending.delete(projectId);
        this.send({ type: 'project-changed', projectId });
        this.toFrames('sb:project-changed', { projectId });
      }, 40),
    );
  }
}

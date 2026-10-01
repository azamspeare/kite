import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export interface NetworkSettings {
  host?: string;
  port?: number;
}

export function validHost(host: unknown): host is string {
  return typeof host === 'string' && (host === 'localhost' || (!host.includes('%') && isIP(host) !== 0));
}

export function validPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function networkConfig(settings: NetworkSettings | null, env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST ?? settings?.host ?? '127.0.0.1';
  const rawPort = env.PORT ?? settings?.port ?? 5199;
  const port = typeof rawPort === 'string' && /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort;
  if (!validHost(host)) throw new Error('HOST must be an IPv4/IPv6 address or localhost');
  if (!validPort(port)) throw new Error('PORT must be an integer from 1 to 65535');
  const address = canonicalHost(host);
  const connectHost = address === '0.0.0.0' ? '127.0.0.1' : address === '[::]' ? '[::1]' : address;
  return { host, port, baseUrl: `http://${connectHost}:${port}` };
}

function canonicalHost(host: string): string {
  return new URL(`http://${isIP(host) === 6 ? `[${host}]` : host}`).hostname;
}

export function networkExposed(host: string): boolean {
  const address = canonicalHost(host);
  return address !== 'localhost' && address !== '[::1]' && !/^127\./.test(address);
}

export const NETWORK_WARNING =
  'Network access has no authentication. Anyone who can connect can edit projects and run agents using your login. Use only a trusted network/firewall; never expose this port to the internet.';

/** Allow literal addresses of this listener, not arbitrary DNS names that can be rebound to it. */
export function allowedHost(host: string | undefined, bindHost: string, localAddress?: string): boolean {
  if (!host || !/^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::\d+)?$/.test(host)) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return true;
    const bind = canonicalHost(bindHost);
    if (hostname === bind) return true;
    if (bind !== '0.0.0.0' && bind !== '[::]') return false;
    if (!localAddress) return false;
    const local = localAddress.startsWith('::ffff:') ? localAddress.slice(7) : localAddress;
    return hostname === canonicalHost(local) || hostname === canonicalHost(localAddress);
  } catch {
    return false;
  }
}

/** Browser calls must come from this editor, not another website or another port. */
export function isCrossSite(req: Pick<IncomingMessage, 'headers'>): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(`http://${req.headers.host}`).origin;
  } catch {
    return true;
  }
}

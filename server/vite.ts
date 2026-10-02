import type { Server } from 'node:http';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { PROJECTS_DIR, ROOT } from './config';

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Project files are reloaded by Kite itself (see ProjectStore.syncCode); keep Vite's HMR out of it. */
function kitePlugin(): Plugin {
  return {
    name: 'kite-projects',
    hotUpdate({ file }) {
      if (isInside(PROJECTS_DIR, file)) return [];
    },
  };
}

export async function createVite(httpServer: Server): Promise<ViteDevServer> {
  return createServer({
    root: ROOT,
    configFile: false,
    appType: 'mpa',
    clearScreen: false,
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
      fs: { allow: [ROOT, PROJECTS_DIR] },
      watch: { ignored: ['**/.kite/**', '**/renders/**', '**/music/**', '**/sounds/**'] },
    },
    resolve: {
      // `@/` is the editor's own code (the shadcn components import it); scenes never use it.
      alias: { kite: path.join(ROOT, 'src/runtime/index.ts'), '@': path.join(ROOT, 'src/editor') },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      entries: ['index.html', 'frame.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    // Tailwind only builds the editor's stylesheet (its sources are set in src/editor/styles.css), never scene frames.
    plugins: [react(), tailwindcss(), kitePlugin()],
  });
}

/** Drop Vite's cached transforms for every module under a project so the next import is fresh. */
export function invalidateProjectModules(vite: ViteDevServer, projectDir: string) {
  const graph = vite.environments.client.moduleGraph;
  const now = Date.now();
  for (const mod of graph.idToModuleMap.values()) {
    if (mod.file && isInside(projectDir, mod.file)) graph.invalidateModule(mod, new Set(), now, true);
  }
}

/** Compile a file through Vite's pipeline; returns the error message (with code frame) or null. */
export async function diagnoseFile(vite: ViteDevServer, file: string): Promise<string | null> {
  try {
    await vite.environments.client.transformRequest(`/@fs${file}`);
    return null;
  } catch (e) {
    const err = e as { message?: string; frame?: string };
    // eslint-disable-next-line no-control-regex
    return [err.message, err.frame]
      .filter(Boolean)
      .join('\n')
      .replace(/\u001b\[[0-9;]*m/g, '');
  }
}

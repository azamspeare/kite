// Scene frame: renders one scene (or the whole video) of a project at an exact time.
// Hosted by the editor (preview, thumbnails, present) and by headless capture (agent frames, renders).
import '@fontsource-variable/inter/standard.css';
import '@fontsource-variable/inter/standard-italic.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import { Component, type ComponentType, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SceneContext, setAssetBase } from '../runtime/components';
import { createMusic, type Music } from '../runtime/music';
import type { SceneProps } from '../runtime/types';
import type { FrameApi, FrameMessage, FrameRenderResult } from '../shared/frameApi';
import type { ProjectState, SceneState } from '../shared/types';

type Mode = 'editor' | 'thumb' | 'capture' | 'present';

const query = new URLSearchParams(location.search);
const projectId = query.get('project') ?? '';
const mode = (query.get('mode') ?? 'editor') as Mode;
let sceneId: string | null = query.get('scene');
let currentT = Number(query.get('t') ?? 0) || 0;

interface LoadedScene {
  key: string;
  Comp: ComponentType<SceneProps> | null;
  error: string | null;
}

let project: ProjectState | null = null;
let loadError: string | null = null;
const modules = new Map<string, LoadedScene>();
const musicCache = new Map<string, Music>();
let renderErrors: string[] = [];
let lastErrors: string[] = [];
let lastPosted = '';
let boundaryEpoch = 0;

const root = createRoot(document.getElementById('root')!);

type Outgoing = FrameMessage extends infer M ? (M extends FrameMessage ? Omit<M, 'source'> : never) : never;

function post(msg: Outgoing) {
  if (window.parent !== window) window.parent.postMessage({ source: 'sb-frame', ...msg }, '*');
}

/** Make stack lines readable: project-relative paths, no dev-server origin or cache-busting queries. */
function cleanLine(line: string): string {
  let out = line
    .replace(/https?:\/\/[^/\s)]+/g, '')
    .replace(/\/@fs/g, '')
    .replace(/\?[^:\s)]*(?=:\d)/g, '');
  if (project) out = out.split(`${project.dir}/`).join('');
  return out.trim();
}

function cleanStack(stack: string): string {
  return stack
    .split('\n')
    .slice(1, 6)
    .filter((line) => !line.includes('node_modules') && !line.includes('/src/frame/'))
    .map(cleanLine)
    .filter(Boolean)
    .join('\n');
}

function formatError(e: unknown): string {
  if (e instanceof Error) {
    const stack = e.stack ? cleanStack(e.stack) : '';
    return stack ? `${e.message}\n${stack}` : e.message;
  }
  return String(e);
}

// ---------------------------------------------------------------------------
// Loading

async function fetchProject(): Promise<ProjectState> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Project "${projectId}" could not be loaded (HTTP ${res.status})`);
  return res.json();
}

/** Vite hides compile errors behind "Failed to fetch dynamically imported module"; ask the server. */
async function describeImportError(scene: SceneState, e: unknown): Promise<string> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(scene.id)}/diagnostics`, {
      cache: 'no-store',
    });
    const body = (await res.json()) as { error?: string | null };
    if (body.error) return body.error;
  } catch {
    // fall through
  }
  return formatError(e);
}

function scenesToLoad(p: ProjectState): SceneState[] {
  return sceneId ? p.scenes.filter((s) => s.id === sceneId) : p.scenes;
}

async function loadScenes(p: ProjectState) {
  const wanted = scenesToLoad(p);
  const wantedIds = new Set(wanted.map((s) => s.id));
  for (const id of [...modules.keys()]) if (!wantedIds.has(id)) modules.delete(id);
  await Promise.all(
    wanted.map(async (scene) => {
      const key = `${p.codeGeneration}-${scene.version}`;
      if (modules.get(scene.id)?.key === key) return;
      const url = `${scene.url}?t=g${key}`;
      try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
        if (typeof mod.default !== 'function') {
          throw new Error(`scenes/${scene.id}.tsx must have a default export that is a React component`);
        }
        modules.set(scene.id, { key, Comp: mod.default as ComponentType<SceneProps>, error: null });
      } catch (e) {
        modules.set(scene.id, { key, Comp: null, error: await describeImportError(scene, e) });
      }
    }),
  );
}

let reloadChain: Promise<void> = Promise.resolve();

function reload(options: { force?: boolean } = {}): Promise<void> {
  reloadChain = reloadChain.then(async () => {
    try {
      const next = await fetchProject();
      if (options.force) modules.clear();
      project = next;
      loadError = null;
      setAssetBase(`/@fs${next.dir}/assets/`);
      musicCache.clear();
      await loadScenes(next);
    } catch (e) {
      loadError = formatError(e);
    }
    renderAt(currentT);
    post({ type: 'reloaded' });
  });
  return reloadChain;
}

// ---------------------------------------------------------------------------
// Rendering

function totalDuration(p: ProjectState): number {
  return p.scenes.reduce((sum, s) => sum + s.duration, 0);
}

function pickScene(t: number): { scene: SceneState; local: number } | null {
  if (!project || project.scenes.length === 0) return null;
  if (sceneId) {
    const scene = project.scenes.find((s) => s.id === sceneId);
    return scene ? { scene, local: Math.min(Math.max(0, t), scene.duration) } : null;
  }
  for (const scene of project.scenes) {
    if (t < scene.start + scene.duration) return { scene, local: Math.max(0, t - scene.start) };
  }
  const last = project.scenes[project.scenes.length - 1];
  return { scene: last, local: last.duration };
}

function musicFor(p: ProjectState, scene: SceneState): Music {
  const key = `${scene.id}|${scene.start}|${scene.duration}`;
  let music = musicCache.get(key);
  if (!music) {
    music = createMusic({
      analysis: p.musicAnalysis,
      musicStart: p.music?.start ?? 0,
      sceneStart: scene.start,
      sceneDuration: scene.duration,
    });
    musicCache.set(key, music);
  }
  return music;
}

function layout(p: ProjectState) {
  if (mode === 'capture') return { scale: 1, x: 0, y: 0 };
  const scale = Math.min(window.innerWidth / p.width, window.innerHeight / p.height);
  return { scale, x: (window.innerWidth - p.width * scale) / 2, y: (window.innerHeight - p.height * scale) / 2 };
}

function ErrorView(props: { title: string; message: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#fff4f2',
        color: '#b42318',
        padding: 72,
        fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
        fontSize: 30,
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 36, marginBottom: 28 }}>{props.title}</div>
      {props.message}
    </div>
  );
}

class Boundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const where = (info.componentStack ?? '')
      .split('\n')
      .filter((line) => line.includes('/scenes/') || line.includes('/components/'))
      .slice(0, 3)
      .map(cleanLine)
      .join('\n');
    renderErrors.push(`${this.props.label}: ${formatError(error)}${where ? `\n${where}` : ''}`);
  }

  render() {
    if (this.state.error)
      return <ErrorView title={`Runtime error in ${this.props.label}`} message={formatError(this.state.error)} />;
    return this.props.children;
  }
}

function Stage(props: { p: ProjectState; pick: { scene: SceneState; local: number } | null }) {
  const { p, pick } = props;
  const { scale, x, y } = layout(p);
  let content: ReactNode = null;
  if (loadError) {
    content = <ErrorView title="Could not load project" message={loadError} />;
  } else if (pick) {
    const loaded = modules.get(pick.scene.id);
    const label = `scenes/${pick.scene.id}.tsx`;
    if (loaded?.error) {
      content = <ErrorView title={`Could not compile ${label}`} message={loaded.error} />;
    } else if (loaded?.Comp) {
      const sceneProps: SceneProps = {
        t: pick.local,
        duration: pick.scene.duration,
        width: p.width,
        height: p.height,
        fps: p.fps,
        music: musicFor(p, pick.scene),
        scene: {
          id: pick.scene.id,
          name: pick.scene.name,
          index: pick.scene.index,
          count: p.scenes.length,
          start: pick.scene.start,
        },
      };
      const Scene = loaded.Comp;
      content = (
        <SceneContext.Provider value={sceneProps}>
          <Boundary key={`${pick.scene.id}:${loaded.key}:${boundaryEpoch}`} label={label}>
            <Scene {...sceneProps} />
          </Boundary>
        </SceneContext.Provider>
      );
    }
  }
  return (
    <div
      data-sb-stage=""
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: p.width,
        height: p.height,
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
        overflow: 'hidden',
        background: '#ffffff',
        color: '#0a0a0a',
        fontFamily: "'Inter Variable', system-ui, sans-serif",
        WebkitFontSmoothing: 'antialiased',
        contain: 'strict',
      }}
    >
      {content}
    </div>
  );
}

function renderAt(t: number): FrameRenderResult {
  currentT = t;
  if (lastErrors.length > 0) boundaryEpoch++;
  renderErrors = [];
  const pick = project ? pickScene(t) : null;
  flushSync(() => {
    root.render(
      project ? (
        <Stage p={project} pick={pick} />
      ) : loadError ? (
        <ErrorView title="Could not load project" message={loadError} />
      ) : null,
    );
  });
  const errors: string[] = [];
  if (loadError) errors.push(loadError);
  if (pick) {
    const loaded = modules.get(pick.scene.id);
    if (loaded?.error) errors.push(`scenes/${pick.scene.id}.tsx failed to compile:\n${loaded.error}`);
  }
  errors.push(...renderErrors);
  lastErrors = errors;
  const signature = errors.join('\n--\n');
  if (signature !== lastPosted) {
    lastPosted = signature;
    post({ type: 'errors', errors });
  }
  return { errors, sceneId: pick?.scene.id ?? null, localTime: pick?.local ?? 0 };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle() {
  void document.body.offsetHeight; // force style/layout so pending font loads start
  await document.fonts.ready;
  const pending = Array.from(document.images).filter((img) => !img.complete);
  await Promise.all(pending.map((img) => img.decode().catch(() => undefined)));
  await nextFrame();
  await nextFrame();
}

async function preloadFonts() {
  const faces = [
    "400 32px 'Inter Variable'",
    "700 32px 'Inter Variable'",
    "italic 400 32px 'Inter Variable'",
    "400 32px 'Geist Variable'",
    "700 32px 'Geist Variable'",
    "400 32px 'JetBrains Mono Variable'",
  ];
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => undefined)));
}

// ---------------------------------------------------------------------------
// Public API

const ready = (async () => {
  await preloadFonts();
  await reload();
  post({ type: 'ready' });
})();

const api: FrameApi = {
  ready,
  render: (t) => renderAt(t),
  async seek(t) {
    await ready;
    const result = renderAt(t);
    await settle();
    return { ...result, errors: lastErrors };
  },
  reload: (options) => reload(options),
  async setScene(id) {
    await ready;
    if (id === sceneId) return;
    sceneId = id;
    if (project) await loadScenes(project);
    renderAt(0);
  },
  duration() {
    if (!project) return 0;
    if (sceneId) return project.scenes.find((s) => s.id === sceneId)?.duration ?? 0;
    return totalDuration(project);
  },
  errors: () => lastErrors,
};
window.__sb = api;

window.addEventListener('resize', () => {
  if (project) renderAt(currentT);
});

if (import.meta.hot && mode !== 'capture') {
  import.meta.hot.on('sb:project-changed', (data: { projectId: string }) => {
    if (data.projectId === projectId) void reload();
  });
}

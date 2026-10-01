import { create } from 'zustand';
import type { AgentInfo, AgentProviderId } from '../shared/agents';
import type {
  ChatMessage,
  ProjectState,
  ProjectSummary,
  RenderFile,
  RenderJob,
  SceneState,
  SeamResult,
  SoundReport,
} from '../shared/types';
import { api, type Info } from './api';

export type View = 'scenes' | 'render';
export type PreviewMode = 'scene' | 'whole';
/** What fills the right column, picked in the rail beside it. */
export type RailItem = 'chat' | 'soundtrack' | 'sounds';

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  loaded: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone?: 'default' | 'error';
  action?: { label: string; run: () => void };
}

interface EditorState {
  info: Info | null;
  projects: ProjectSummary[];
  project: ProjectState | null;
  sceneId: string | null;
  view: View;
  /** Which chat the Chat panel shows: the selected scene's or the whole project's. */
  panel: 'scene' | 'project';
  rail: RailItem;
  mode: PreviewMode;
  playing: boolean;
  /** Playhead in the current mode's timebase: scene-local in scene mode, video time in whole mode. */
  time: number;
  /** Bumped on user-initiated seeks so playback can re-sync the audio. */
  seekNonce: number;
  loop: boolean;
  muted: boolean;
  chats: Record<string, ChatState>;
  seams: SeamResult[];
  renders: { jobs: RenderJob[]; files: RenderFile[] };
  musicStatus: 'idle' | 'analyzing' | 'ready' | 'error';
  musicError: string | null;
  /** Every scene's sound cues, as the whole-video frame last reported them. */
  soundCues: SoundReport;
  presenting: boolean;
  modal: null | 'art' | 'new-project';
  provider: string;
  effort: string;
  /** Empty = the server default (STORYBOARD_MODEL). */
  model: string;
  toasts: Toast[];
}

const savedProvider = localStorage.getItem('sb:provider') ?? '';

export const useEditor = create<EditorState>(() => ({
  info: null,
  projects: [],
  project: null,
  sceneId: null,
  view: 'scenes',
  panel: 'scene',
  rail: 'chat',
  mode: 'scene',
  playing: false,
  time: 0,
  seekNonce: 0,
  loop: true,
  muted: false,
  chats: {},
  seams: [],
  renders: { jobs: [], files: [] },
  musicStatus: 'idle',
  musicError: null,
  soundCues: { cues: [], errors: [] },
  presenting: false,
  modal: null,
  provider: savedProvider,
  effort: '',
  model: '',
  toasts: [],
}));

const set = useEditor.setState;
const get = useEditor.getState;

// ---------------------------------------------------------------------------
// Derived helpers

export function currentAgent(s = get()): AgentInfo | undefined {
  return s.info?.agents?.find((a) => a.id === (s.provider || s.info?.defaultProvider)) ?? s.info?.agents?.[0];
}

export function currentScene(s = get()): SceneState | null {
  return s.project?.scenes.find((x) => x.id === s.sceneId) ?? s.project?.scenes[0] ?? null;
}

export function totalDuration(project: ProjectState | null): number {
  return project ? project.scenes.reduce((sum, x) => sum + x.duration, 0) : 0;
}

/** Duration of whatever the preview shows. */
export function previewDuration(s = get()): number {
  if (s.mode === 'whole') return totalDuration(s.project);
  return currentScene(s)?.duration ?? 0;
}

export function sceneAtTime(project: ProjectState, t: number): SceneState | null {
  for (const scene of project.scenes) if (t < scene.start + scene.duration) return scene;
  return project.scenes[project.scenes.length - 1] ?? null;
}

export function chatKey(projectId: string, scopeKey: string) {
  return `${projectId}/${scopeKey}`;
}

// ---------------------------------------------------------------------------
// Toasts

let toastId = 0;

export function toast(text: string, options: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, tone: options.tone, action: options.action }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), options.ms ?? (options.action ? 7000 : 3200));
}

export function toastError(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), { tone: 'error', ms: 6000 });
}

// ---------------------------------------------------------------------------
// Navigation

function writeHash() {
  const s = get();
  if (!s.project) return;
  const parts = [s.project.id, s.sceneId ?? ''].filter(Boolean);
  const next = `#/${parts.join('/')}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

export async function loadProjects() {
  const projects = await api.projects();
  set({ projects });
  return projects;
}

export async function openProject(id: string, sceneId?: string | null) {
  const project = await api.project(id);
  const scene = project.scenes.find((x) => x.id === sceneId) ?? project.scenes[0] ?? null;
  set({
    project,
    sceneId: scene?.id ?? null,
    time: 0,
    playing: false,
    seams: [],
    renders: { jobs: [], files: [] },
    musicStatus: project.music ? (project.musicAnalysis ? 'ready' : 'analyzing') : 'idle',
    musicError: null,
    soundCues: { cues: [], errors: [] },
  });
  localStorage.setItem('sb:project', id);
  writeHash();
  void api
    .seams(id)
    .then((seams) => get().project?.id === id && set({ seams }))
    .catch(() => undefined);
  void refreshRenders();
}

export async function refreshProject() {
  const id = get().project?.id;
  if (!id) return;
  const project = await api.project(id);
  if (get().project?.id !== id) return;
  const s = get();
  const sceneId = project.scenes.some((x) => x.id === s.sceneId) ? s.sceneId : (project.scenes[0]?.id ?? null);
  set({ project, sceneId });
  // Keep the playhead inside the (possibly shorter) scene or video.
  const max = previewDuration();
  if (get().time > max) set({ time: max });
  set({
    projects: get().projects.map((x) =>
      x.id === id ? { ...x, name: project.name, sceneCount: project.scenes.length, duration: totalDuration(project) } : x,
    ),
  });
  writeHash();
}

export async function refreshRenders() {
  const id = get().project?.id;
  if (!id) return;
  const renders = await api.renders(id).catch(() => null);
  if (renders && get().project?.id === id) set({ renders });
}

export function selectScene(sceneId: string) {
  const s = get();
  const scene = s.project?.scenes.find((x) => x.id === sceneId);
  if (!scene) return;
  if (s.mode === 'whole') set({ sceneId, time: scene.start });
  else set({ sceneId, time: 0 });
  set({ panel: 'scene' });
  writeHash();
}

export function setMode(mode: PreviewMode) {
  const s = get();
  if (s.mode === mode || !s.project) return;
  const scene = currentScene(s);
  if (mode === 'whole') {
    set({ mode, time: (scene?.start ?? 0) + s.time });
  } else {
    const at = sceneAtTime(s.project, s.time);
    set({ mode, sceneId: at?.id ?? s.sceneId, time: at ? Math.max(0, Math.min(at.duration, s.time - at.start)) : 0 });
  }
}

/** Move the playhead; in whole-video mode the selected scene follows it. */
export function seek(t: number) {
  const s = get();
  const time = Math.max(0, Math.min(previewDuration(s), t));
  if (s.mode === 'whole' && s.project) {
    const at = sceneAtTime(s.project, time);
    if (at && at.id !== s.sceneId) {
      set({ time, sceneId: at.id });
      writeHash();
      return;
    }
  }
  set({ time });
}

/** Seek initiated by the user (scrubbing, stepping): also re-syncs audio during playback. */
export function userSeek(t: number) {
  seek(t);
  set((s) => ({ seekNonce: s.seekNonce + 1 }));
}

export function setPlaying(playing: boolean) {
  const s = get();
  if (playing && s.time >= previewDuration(s) - 1e-3) set({ time: 0 });
  set({ playing });
}

// ---------------------------------------------------------------------------
// Chats

export async function loadChat(projectId: string, scopeKey: string) {
  const thread = await api.chat(projectId, scopeKey);
  set((s) => ({
    chats: { ...s.chats, [chatKey(projectId, scopeKey)]: { messages: thread.messages, busy: thread.busy, loaded: true } },
  }));
}

export function upsertChatMessage(projectId: string, scopeKey: string, message: ChatMessage) {
  set((s) => {
    const key = chatKey(projectId, scopeKey);
    const chat = s.chats[key] ?? { messages: [], busy: false, loaded: false };
    const index = chat.messages.findIndex((m) => m.id === message.id);
    const messages = index >= 0 ? chat.messages.map((m, i) => (i === index ? message : m)) : [...chat.messages, message];
    return { chats: { ...s.chats, [key]: { ...chat, messages } } };
  });
}

export function setChatBusy(projectId: string, scopeKey: string, busy: boolean) {
  set((s) => {
    const key = chatKey(projectId, scopeKey);
    const chat = s.chats[key] ?? { messages: [], busy: false, loaded: false };
    return { chats: { ...s.chats, [key]: { ...chat, busy } } };
  });
}

export function resetChat(projectId: string, scopeKey: string) {
  set((s) => ({ chats: { ...s.chats, [chatKey(projectId, scopeKey)]: { messages: [], busy: false, loaded: true } } }));
}

function agentPreferences(provider: AgentProviderId) {
  return {
    model:
      localStorage.getItem(`sb:model:${provider}`) ?? (provider === 'claude-code' ? localStorage.getItem('sb:model') : '') ?? '',
    effort:
      localStorage.getItem(`sb:effort:${provider}`) ??
      (provider === 'claude-code' ? localStorage.getItem('sb:effort') : '') ??
      '',
  };
}

export function setInfo(info: Info) {
  const provider = info.agents.find((a) => a.id === get().provider)?.id ?? info.defaultProvider;
  set({ info, provider, ...agentPreferences(provider) });
}

export function setProvider(provider: AgentProviderId) {
  localStorage.setItem('sb:provider', provider);
  set({ provider, ...agentPreferences(provider) });
}

export function setEffort(effort: string) {
  localStorage.setItem(`sb:effort:${currentAgent()?.id ?? 'claude-code'}`, effort);
  set({ effort });
}

export function setModel(model: string) {
  localStorage.setItem(`sb:model:${currentAgent()?.id ?? 'claude-code'}`, model);
  set({ model });
}

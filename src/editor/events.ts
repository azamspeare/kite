import type { ServerEvent } from '../shared/types';
import { api } from './api';
import {
  loadChat,
  loadProjects,
  refreshProject,
  refreshRenders,
  resetChat,
  setChatBusy,
  toast,
  upsertChatMessage,
  useEditor,
} from './store';

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let seamsTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleProjectRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshProject().catch(() => undefined);
  }, 60);
  // Once edits settle, drop stale seam badges; the server re-checks missing cuts and pushes results.
  if (seamsTimer) clearTimeout(seamsTimer);
  seamsTimer = setTimeout(() => {
    seamsTimer = null;
    const id = useEditor.getState().project?.id;
    if (id)
      void api
        .seams(id)
        .then((seams) => useEditor.getState().project?.id === id && useEditor.setState({ seams }))
        .catch(() => undefined);
  }, 1500);
}

function handle(event: ServerEvent) {
  const s = useEditor.getState();
  const current = s.project?.id;
  switch (event.type) {
    case 'project-changed':
      if (event.projectId === current) scheduleProjectRefresh();
      break;
    case 'projects-changed':
      void loadProjects().catch(() => undefined);
      break;
    case 'chat-updated':
      upsertChatMessage(event.projectId, event.scopeKey, event.message);
      break;
    case 'chat-reset':
      resetChat(event.projectId, event.scopeKey);
      break;
    case 'chat-busy':
      setChatBusy(event.projectId, event.scopeKey, event.busy);
      break;
    case 'seams':
      if (event.projectId === current) useEditor.setState({ seams: event.seams });
      break;
    case 'render': {
      if (event.job.projectId !== current) break;
      const jobs = [event.job, ...s.renders.jobs.filter((j) => j.id !== event.job.id)];
      useEditor.setState({ renders: { ...s.renders, jobs } });
      if (event.job.status === 'done') {
        void refreshRenders();
        toast('Render finished', { action: { label: 'Show', run: () => useEditor.setState({ view: 'render' }) } });
      }
      if (event.job.status === 'error')
        toast(`Render failed: ${event.job.error ?? 'unknown error'}`, { tone: 'error', ms: 8000 });
      break;
    }
    case 'music-status':
      if (event.projectId !== current) break;
      useEditor.setState({ musicStatus: event.status, musicError: event.error ?? null });
      if (event.status === 'ready') scheduleProjectRefresh();
      if (event.status === 'error') toast(`Music analysis failed: ${event.error}`, { tone: 'error', ms: 8000 });
      break;
  }
}

/** Subscribe to server events; after a reconnect, re-sync whatever is on screen. */
export function connectEvents() {
  let disconnected = false;
  const source = new EventSource('/api/events');
  source.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data) as ServerEvent);
    } catch (err) {
      console.error('Bad server event', err);
    }
  };
  source.onerror = () => {
    disconnected = true;
  };
  source.onopen = () => {
    if (!disconnected) return;
    disconnected = false;
    const s = useEditor.getState();
    void loadProjects().catch(() => undefined);
    if (s.project) {
      scheduleProjectRefresh();
      for (const key of Object.keys(s.chats)) {
        const [projectId, scopeKey] = key.split('/');
        if (projectId === s.project.id) void loadChat(projectId, scopeKey).catch(() => undefined);
      }
    }
  };
  return () => source.close();
}

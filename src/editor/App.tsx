import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { uploadMusicFile, uploadSoundFiles } from './components/AudioPanels';
import { Filmstrip } from './components/Filmstrip';
import { Footer } from './components/Footer';
import { ArtDirectionModal, NewProjectModal } from './components/Modals';
import { Navbar } from './components/Navbar';
import { Present } from './components/Present';
import { Projects } from './components/Projects';
import { RenderView } from './components/RenderView';
import { SidePanel } from './components/SidePanel';
import { Stage } from './components/Stage';
import { Toasts } from './components/Toasts';
import { attachToComposer } from './components/chat/Composer';
import { connectEvents } from './events';
import {
  currentScene,
  loadProjects,
  openProject,
  selectScene,
  setInfo,
  setPlaying,
  setView,
  toastError,
  useEditor,
  userSeek,
} from './store';

/**
 * Whether a key belongs to what has focus rather than to the editor: a field, a picker (Base UI's select
 * trigger is a button with the combobox role), or anything inside a dialog, such as Help.
 */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(
    el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable ||
      el.getAttribute?.('role') === 'combobox' ||
      el.closest?.('[role="dialog"]')),
  );
}

type DropZone = 'music' | 'sounds' | 'composer';

export function App() {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const modal = useEditor((s) => s.modal);
  const presenting = useEditor((s) => s.presenting);
  const [loaded, setLoaded] = useState(false);
  const [dropping, setDropping] = useState(false);
  /**
   * Files dropped on the chat's composer are attached to the message; on the Sound effects panel (or its rail
   * button) they become sound effects; anywhere else, the soundtrack.
   */
  const [dropZone, setDropZone] = useState<DropZone>('music');
  const dragDepth = useRef(0);

  useEffect(() => {
    const disconnect = connectEvents();
    (async () => {
      const [info, projects] = await Promise.all([api.info(), loadProjects()]);
      setInfo(info);
      const [hashProject, hashScene] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
      // `#/projects` asks for the projects page; otherwise the app opens the named or last project, as before.
      if (hashProject === 'projects') return setView('projects');
      const candidates = [hashProject, localStorage.getItem('kite:project'), projects[0]?.id];
      const id = candidates.find((x) => x && projects.some((p) => p.id === x));
      if (id) await openProject(id, hashScene || null);
      else setView('projects');
    })()
      .catch(toastError)
      .finally(() => setLoaded(true));
    return disconnect;
  }, []);

  useEffect(() => {
    // Typing an address, or Back and Forward, can name another page: follow it.
    const onHash = () => {
      const [hashProject, hashScene] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
      const s = useEditor.getState();
      if (hashProject === 'projects') setView('projects');
      else if (hashProject && hashProject !== s.project?.id && s.projects.some((p) => p.id === hashProject))
        void openProject(hashProject, hashScene || null).catch(toastError);
      else if (hashProject && hashProject === s.project?.id) {
        if (s.view === 'projects') setView('scenes');
        if (hashScene && hashScene !== s.sceneId) selectScene(hashScene);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      if (e.defaultPrevented || isTyping(e.target) || s.presenting || s.modal || !s.project || s.view !== 'scenes') return;
      const frame = 1 / s.project.fps;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          setPlaying(!s.playing);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          userSeek(s.time - (e.shiftKey ? 1 : frame));
          break;
        case 'ArrowRight':
          e.preventDefault();
          userSeek(s.time + (e.shiftKey ? 1 : frame));
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const scene = currentScene(s);
          const next = s.project.scenes[(scene?.index ?? 0) + (e.key === 'ArrowDown' ? 1 : -1)];
          if (next) selectScene(next.id);
          break;
        }
        case 'Home':
          userSeek(0);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const zoneOf = (e: React.DragEvent): DropZone => {
    const zone = (e.target as HTMLElement).closest?.<HTMLElement>('[data-drop]')?.dataset.drop;
    return zone === 'sounds' || zone === 'composer' ? zone : 'music';
  };

  const showProjects = loaded && (view === 'projects' || !project);

  return (
    <div
      className="relative flex h-svh w-full flex-col overflow-hidden bg-muted"
      onDragEnter={(e) => {
        if (!hasFiles(e) || !project || view === 'projects') return;
        dragDepth.current++;
        setDropping(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        // Always claimed, so a file dropped where it has no use is ignored instead of opened by the browser.
        e.preventDefault();
        if (!project || view === 'projects') return;
        const zone = zoneOf(e);
        if (zone !== dropZone) setDropZone(zone);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDropping(false);
        if (!project || view === 'projects') return;
        const files = [...e.dataTransfer.files];
        const zone = zoneOf(e);
        if (zone === 'composer' && attachToComposer(files)) return;
        if (zone === 'sounds') void uploadSoundFiles(files);
        else if (files[0]) void uploadMusicFile(files[0]);
      }}
    >
      <Navbar />
      {project && (
        <>
          {/* Hidden, not removed, outside the Scenes view, so the stage's frames stay loaded. */}
          <div
            hidden={view !== 'scenes'}
            className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(25rem,32vw,29rem)_auto] grid-rows-[minmax(0,1fr)_auto] gap-3 px-3 pt-px pb-3 [grid-template-areas:'stage_side_rail'_'filmstrip_side_rail'] [&[hidden]]:hidden"
          >
            <Stage />
            {view === 'scenes' && <Filmstrip />}
            <SidePanel />
          </div>
          {view === 'render' && <RenderView />}
        </>
      )}
      {showProjects && <Projects />}
      <Footer />
      {modal === 'art' && project && <ArtDirectionModal />}
      {modal === 'new-project' && <NewProjectModal />}
      {presenting && project && <Present />}
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-70 grid place-items-center bg-brand-8/70 p-3 backdrop-blur-[2px]">
          <div className="grid size-full place-items-center rounded-3xl border-2 border-dashed border-action text-base font-medium text-action-text">
            {dropZone === 'composer'
              ? 'Drop to attach to your message'
              : dropZone === 'sounds'
                ? 'Drop to add sound effects'
                : 'Drop an audio file to use it as the soundtrack'}
          </div>
        </div>
      )}
      {/* Toasts stack above everything, dialogs (portalled to <body> at z-50) and Present (z-100) included. */}
      <Toasts />
    </div>
  );
}

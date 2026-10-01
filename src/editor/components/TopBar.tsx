import { Clapperboard, Copy, Expand, Monitor, Moon, Palette, Plus, Sun } from 'lucide-react';
import { api } from '../api';
import { currentScene, openProject, setTheme, toast, toastError, useEditor } from '../store';
import type { Theme } from '../theme';
import { Segmented } from './ui';

export function TopBar() {
  const projects = useEditor((s) => s.projects);
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const theme = useEditor((s) => s.theme);
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;

  const copyPath = async () => {
    const s = useEditor.getState();
    if (!s.project) return;
    const scene = currentScene(s);
    const target = s.panel === 'scene' && scene ? scene.file : s.project.dir;
    try {
      await navigator.clipboard.writeText(target);
      toast(`Copied ${target}`);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Clapperboard size={15} strokeWidth={2.2} />
        </span>
        Storyboard
      </div>
      <label className="project-picker">
        <select value={project?.id ?? ''} onChange={(e) => openProject(e.target.value).catch(toastError)} aria-label="Project">
          {!project && <option value="">No project</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button className="btn" onClick={() => useEditor.setState({ modal: 'new-project' })}>
        <Plus size={16} /> New project
      </button>
      {project && (
        <Segmented
          value={view}
          options={[
            ['scenes', 'Scenes'],
            ['render', 'Render'],
          ]}
          onChange={(v) => useEditor.setState({ view: v })}
        />
      )}
      <div className="spacer" />
      {project && (
        <>
          <button className="btn" onClick={() => useEditor.setState({ modal: 'art' })}>
            <Palette size={16} /> Art direction
          </button>
          <button className="btn" onClick={copyPath} title="Copy the scene file path (or the project folder)">
            <Copy size={15} /> Copy path
          </button>
          <button
            className="btn btn-primary"
            onClick={() => useEditor.setState({ presenting: true, playing: false })}
            disabled={project.scenes.length === 0}
          >
            <Expand size={15} /> Present
          </button>
        </>
      )}
      <label className="theme-picker btn" title="Color theme">
        <ThemeIcon size={16} aria-hidden="true" />
        <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Color theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </header>
  );
}

/** What the tooltips call the file browser the server opens (the server runs on this same machine). */
export const FILE_MANAGER = navigator.userAgent.includes('Mac') ? 'Finder' : 'the file manager';

export async function revealFile(path: string) {
  await api.reveal(path).catch(toastError);
}

import { CopyPlus, ExternalLink, FolderOpen, Loader2, Magnet, Music, RefreshCw, ScanLine, Trash2, Undo2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { SceneState } from '../../shared/types';
import { api } from '../api';
import { chatKey, currentScene, refreshProject, selectScene, toast, toastError, totalDuration, useEditor } from '../store';
import { Chat } from './Chat';
import { FILE_MANAGER, revealFile } from './TopBar';
import { Segmented, formatClock } from './ui';

function InlineInput(props: { initial: string; onDone: (value: string | null) => void; numeric?: boolean; className?: string }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(value);
  };
  return (
    <input
      className={`inline-input ${props.className ?? ''}`}
      defaultValue={props.initial}
      autoFocus
      inputMode={props.numeric ? 'decimal' : undefined}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value.trim());
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim())}
    />
  );
}

function SceneTitle({ scene }: { scene: SceneState }) {
  const project = useEditor((s) => s.project)!;
  const [editing, setEditing] = useState<'name' | 'duration' | null>(null);
  const save = async (patch: { name?: string; duration?: number }) => {
    try {
      await api.updateScene(project.id, scene.id, patch);
      await refreshProject();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="side-title">
      {editing === 'name' ? (
        <InlineInput
          initial={scene.name}
          className="title-input"
          onDone={(v) => {
            setEditing(null);
            if (v && v !== scene.name) void save({ name: v });
          }}
        />
      ) : (
        <h1 onDoubleClick={() => setEditing('name')} title="Double-click to rename">
          {scene.name}
        </h1>
      )}
      {editing === 'duration' ? (
        <InlineInput
          numeric
          initial={scene.duration.toFixed(2)}
          className="duration-input"
          onDone={(v) => {
            setEditing(null);
            const seconds = Number(v?.replace(/s$/, ''));
            if (v && Number.isFinite(seconds) && seconds > 0 && seconds !== scene.duration) void save({ duration: seconds });
          }}
        />
      ) : (
        <button className="duration-btn" onClick={() => setEditing('duration')} title="Click to change the duration">
          {scene.duration.toFixed(2)}s
        </button>
      )}
    </div>
  );
}

function useUndo(scopeKey: string) {
  const project = useEditor((s) => s.project)!;
  const chat = useEditor((s) => s.chats[chatKey(project.id, scopeKey)]);
  const canUndo = Boolean(chat && !chat.busy && chat.messages.some((m) => m.undoId && !m.undone));
  const undo = async () => {
    try {
      await api.undo(project.id, scopeKey);
      toast('Reverted Claude’s last change');
    } catch (e) {
      toastError(e);
    }
  };
  const clear = async () => {
    if (!confirm('Clear this chat? Claude starts a fresh conversation (your scene files are not affected).')) return;
    await api.clearChat(project.id, scopeKey).catch(toastError);
  };
  return { canUndo, undo, clear, hasMessages: Boolean(chat?.messages.length) };
}

function SceneToolbar({ scene }: { scene: SceneState }) {
  const project = useEditor((s) => s.project)!;
  const { canUndo, undo, clear, hasMessages } = useUndo(scene.id);
  const duplicate = async () => {
    try {
      const created = await api.duplicateScene(project.id, scene.id);
      await refreshProject();
      selectScene(created.id);
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete “${scene.name}”? The file is moved to the project’s trash.`)) return;
    try {
      await api.deleteScene(project.id, scene.id);
      await refreshProject();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="side-toolbar">
      <button className="btn btn-sm" disabled={!canUndo} onClick={undo} title="Undo Claude’s last change to this scene">
        <Undo2 size={15} /> Undo
      </button>
      <button
        className="icon-btn"
        title="Open this scene in a new tab"
        onClick={() => window.open(`/frame.html?project=${project.id}&scene=${scene.id}&mode=editor`, '_blank')}
      >
        <ExternalLink size={16} />
      </button>
      <button className="icon-btn" title={`Show the scene file in ${FILE_MANAGER}`} onClick={() => revealFile(scene.file)}>
        <FolderOpen size={16} />
      </button>
      <button className="icon-btn" title="Duplicate scene" onClick={duplicate}>
        <CopyPlus size={16} />
      </button>
      <button className="icon-btn icon-danger" title="Delete scene" onClick={remove} disabled={project.scenes.length <= 1}>
        <Trash2 size={16} />
      </button>
      <div className="spacer" />
      <button className="btn-text" onClick={clear} disabled={!hasMessages}>
        Clear chat
      </button>
    </div>
  );
}

function ProjectToolbar() {
  const project = useEditor((s) => s.project)!;
  const { canUndo, undo, clear, hasMessages } = useUndo('_project');
  const [checking, setChecking] = useState(false);
  const checkSeams = async () => {
    setChecking(true);
    try {
      const results = await api.checkSeams(project.id);
      const visible = results.filter((r) => r.diffPercent >= 0.5).length;
      toast(
        results.length
          ? `Checked ${results.length} cuts — ${visible ? `${visible} visible` : 'all invisible'}`
          : 'Only one scene — no cuts',
      );
    } catch (e) {
      toastError(e);
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="side-toolbar">
      <button className="btn btn-sm" disabled={!canUndo} onClick={undo} title="Undo the project chat’s last change">
        <Undo2 size={15} /> Undo
      </button>
      <button className="btn btn-sm" onClick={checkSeams} disabled={checking} title="Pixel-compare every cut">
        {checking ? <Loader2 size={15} className="spin" /> : <ScanLine size={15} />} Check seams
      </button>
      <button
        className="icon-btn"
        title={`Show the project folder in ${FILE_MANAGER}`}
        onClick={() => revealFile(`${project.dir}/project.json`)}
      >
        <FolderOpen size={16} />
      </button>
      <div className="spacer" />
      <button className="btn-text" onClick={clear} disabled={!hasMessages}>
        Clear chat
      </button>
    </div>
  );
}

export async function uploadMusicFile(file: File) {
  const project = useEditor.getState().project;
  if (!project) return;
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|flac|ogg|aiff?)$/i.test(file.name)) {
    toast(`“${file.name}” doesn’t look like an audio file`, { tone: 'error' });
    return;
  }
  useEditor.setState({ musicStatus: 'analyzing', panel: 'project' });
  try {
    await api.uploadMusic(project.id, file);
    await refreshProject();
  } catch (e) {
    useEditor.setState({ musicStatus: 'error', musicError: (e as Error).message });
    toastError(e);
  }
}

function MusicOverview() {
  const project = useEditor((s) => s.project)!;
  const a = project.musicAnalysis!;
  const start = project.music?.start ?? 0;
  const total = totalDuration(project);
  const n = 200;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= n; i++) {
    const v = a.waveform[Math.min(a.waveform.length - 1, Math.floor((i / n) * a.waveform.length))] ?? 0;
    top.push(`${i},${20 - 2 - v * 16}`);
    bottom.push(`${i},${20 + 2 + v * 16}`);
  }
  const x = (t: number) => (t / a.duration) * n;
  const setStart = async (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * a.duration;
    const nearest = a.downbeats.reduce((best, d) => (Math.abs(d - t) < Math.abs(best - t) ? d : best), a.downbeats[0] ?? t);
    try {
      await api.updateMusic(project.id, { start: Math.max(0, nearest) });
      await refreshProject();
      toast(`The video now starts ${nearest.toFixed(2)}s into the track`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <svg className="music-overview" viewBox={`0 0 ${n} 40`} preserveAspectRatio="none" onClick={setStart}>
      <title>Click to start the video at the nearest bar</title>
      <rect
        className="window"
        x={x(start)}
        y={0}
        width={Math.max(0.5, x(Math.min(a.duration, start + total)) - x(start))}
        height={40}
      />
      <path d={`M${top.join(' L')} L${bottom.reverse().join(' L')} Z`} />
      {a.sections.slice(1).map((s) => (
        <line key={s.start} className="section" x1={x(s.start)} x2={x(s.start)} y1={0} y2={40} />
      ))}
    </svg>
  );
}

function MusicCard() {
  const project = useEditor((s) => s.project)!;
  const status = useEditor((s) => s.musicStatus);
  const error = useEditor((s) => s.musicError);
  const input = useRef<HTMLInputElement>(null);
  const [grid, setGrid] = useState<'bar' | 'phrase' | 'beat'>('bar');
  const a = project.musicAnalysis;

  const picker = (
    <input
      ref={input}
      type="file"
      accept="audio/*"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void uploadMusicFile(file);
        e.target.value = '';
      }}
    />
  );

  if (!project.music) {
    return (
      <button className="music-card music-empty" onClick={() => input.current?.click()}>
        <Music size={18} />
        <span>
          <strong>Add a soundtrack</strong>
          <span className="dim">
            Drop an audio file anywhere or click here. Beats, bars and phrases are detected so cuts and animations can lock to the
            music.
          </span>
        </span>
        {picker}
      </button>
    );
  }

  const snap = async () => {
    try {
      const result = await api.snap(project.id, grid);
      await refreshProject();
      toast(
        `Snapped ${result.moved} cut${result.moved === 1 ? '' : 's'} to the ${grid} grid (max shift ${result.maxShift.toFixed(2)}s)`,
        {
          action: {
            label: 'Undo',
            run: () => void api.setDurations(project.id, result.before).then(refreshProject).catch(toastError),
          },
        },
      );
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="music-card">
      <div className="music-head">
        <Music size={15} />
        <span className="music-name" title={project.music.file}>
          {project.music.file}
        </span>
        <button className="icon-btn icon-sm" title="Re-analyze" onClick={() => api.analyzeMusic(project.id).catch(toastError)}>
          <RefreshCw size={13} />
        </button>
        <button
          className="icon-btn icon-sm"
          title="Remove the soundtrack"
          onClick={async () => {
            if (!confirm('Remove the soundtrack from this project?')) return;
            await api.removeMusic(project.id).catch(toastError);
            await refreshProject();
          }}
        >
          <X size={14} />
        </button>
        {picker}
      </div>
      {status === 'error' ? (
        <div className="music-status error">{error ?? 'Analysis failed'}</div>
      ) : !a || status === 'analyzing' ? (
        <div className="music-status">
          <Loader2 size={14} className="spin" /> Detecting beats, bars and phrases…
        </div>
      ) : (
        <>
          <div className="music-stats">
            <strong>{a.bpm.toFixed(1)} BPM</strong> · {a.beatsPerBar}/4 · {formatClock(a.duration)} ·{' '}
            {a.sections.map((s) => s.label).join(' → ')}
          </div>
          <MusicOverview />
          <div className="music-controls">
            <label>
              Starts at
              <input
                type="number"
                step="0.01"
                min="0"
                defaultValue={project.music.start.toFixed(2)}
                key={project.music.start}
                onBlur={async (e) => {
                  const start = Number(e.currentTarget.value);
                  if (!Number.isFinite(start) || start === project.music?.start) return;
                  await api.updateMusic(project.id, { start }).catch(toastError);
                  await refreshProject();
                }}
              />
              s
            </label>
            <label>
              Volume
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                defaultValue={project.music.volume}
                onChange={(e) => {
                  const volume = Number(e.currentTarget.value);
                  void api.updateMusic(project.id, { volume }).then(refreshProject).catch(toastError);
                }}
              />
            </label>
          </div>
          <div className="music-actions">
            <Segmented
              size="sm"
              value={grid}
              options={[
                ['beat', 'Beats'],
                ['bar', 'Bars'],
                ['phrase', 'Phrases'],
              ]}
              onChange={setGrid}
            />
            <button className="btn btn-sm" onClick={snap} title="Move every cut to the nearest grid point">
              <Magnet size={14} /> Snap cuts
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function SidePanel() {
  const panel = useEditor((s) => s.panel);
  const project = useEditor((s) => s.project)!;
  const scene = useEditor((s) => currentScene(s));
  const scopeKey = panel === 'scene' ? scene?.id : '_project';
  return (
    <aside className="side">
      <div className="side-head">
        <Segmented
          size="sm"
          value={panel}
          options={[
            ['scene', 'Scene'],
            ['project', 'Project'],
          ]}
          onChange={(p) => useEditor.setState({ panel: p })}
        />
        {panel === 'scene' && scene ? (
          <SceneTitle scene={scene} />
        ) : (
          <div className="side-title">
            <h1>{project.name}</h1>
            <span className="duration-btn static">{totalDuration(project).toFixed(2)}s</span>
          </div>
        )}
      </div>
      {panel === 'scene' && scene ? <SceneToolbar scene={scene} /> : <ProjectToolbar />}
      {panel === 'project' && <MusicCard />}
      {scopeKey && <Chat key={`${project.id}/${scopeKey}`} scopeKey={scopeKey} />}
    </aside>
  );
}

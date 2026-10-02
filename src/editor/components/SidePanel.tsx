import {
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  DocumentDuplicateIcon,
  FolderOpenIcon,
  TrashIcon,
  ViewfinderCircleIcon,
} from '@heroicons/react/16/solid';
// Heroicons has no chat-bubble, note or waveform of this kind, so the rail's icons come from Hugeicons.
import { AiChat02Icon, AudioWave01Icon, MusicNote03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FILE_MANAGER, revealFile } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { SceneState } from '../../shared/types';
import { api } from '../api';
import {
  chatKey,
  currentScene,
  refreshProject,
  selectScene,
  toast,
  toastError,
  totalDuration,
  useEditor,
  type RailItem,
} from '../store';
import { SoundsPanel, SoundtrackPanel, useSoundProblems } from './AudioPanels';
import { Chat } from './Chat';
import { ISLAND, ISLAND_HEADER, Segmented } from './ui';

/** The row of tools under a panel's header. */
const TOOLBAR = 'flex h-11 shrink-0 items-center gap-1 border-b px-3';

function InlineInput(props: { initial: string; onDone: (value: string | null) => void; numeric?: boolean; className?: string }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(value);
  };
  return (
    <input
      className={cn(
        'min-w-0 rounded-md border border-ring bg-background px-1.5 py-0.5 ring-3 ring-ring/20 outline-none',
        props.className,
      )}
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

/** The scene's name (double-click to rename) and its duration (click to change). */
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
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {editing === 'name' ? (
        <InlineInput
          initial={scene.name}
          className="flex-1 text-sm font-medium"
          onDone={(v) => {
            setEditing(null);
            if (v && v !== scene.name) void save({ name: v });
          }}
        />
      ) : (
        <h2
          onDoubleClick={() => setEditing('name')}
          title={`${scene.name} (double-click to rename)`}
          className="min-w-0 flex-1 cursor-default truncate text-sm font-medium"
        >
          {scene.name}
        </h2>
      )}
      {editing === 'duration' ? (
        <InlineInput
          numeric
          initial={scene.duration.toFixed(2)}
          className="w-20 text-right font-mono text-sm tabular-nums"
          onDone={(v) => {
            setEditing(null);
            const seconds = Number(v?.replace(/s$/, ''));
            if (v && Number.isFinite(seconds) && seconds > 0 && seconds !== scene.duration) void save({ duration: seconds });
          }}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 font-mono text-muted-foreground tabular-nums"
          onClick={() => setEditing('duration')}
          title="Click to change the duration"
        >
          {scene.duration.toFixed(2)}s
        </Button>
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
      toast('Reverted the agent’s last change');
    } catch (e) {
      toastError(e);
    }
  };
  const clear = async () => {
    if (!confirm('Clear this chat? The agent starts a fresh conversation (your scene files are not affected).')) return;
    await api.clearChat(project.id, scopeKey).catch(toastError);
  };
  return { canUndo, undo, clear, hasMessages: Boolean(chat?.messages.length) };
}

/** An icon-only tool in a panel's toolbar; its label is the tooltip and what a screen reader says. */
function ToolButton(props: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className={cn('text-muted-foreground', props.danger && 'hover:bg-destructive/10 hover:text-destructive-foreground')}
    >
      {props.children}
    </Button>
  );
}

function ClearChat({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} className="ml-auto text-muted-foreground">
      Clear chat
    </Button>
  );
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
    <div className={TOOLBAR}>
      <Button variant="outline" size="sm" disabled={!canUndo} onClick={undo} title="Undo the agent’s last change to this scene">
        <ArrowUturnLeftIcon data-icon="inline-start" />
        Undo
      </Button>
      <ToolButton
        label="Open this scene in a new tab"
        onClick={() => window.open(`/frame.html?project=${project.id}&scene=${scene.id}&mode=editor`, '_blank')}
      >
        <ArrowTopRightOnSquareIcon />
      </ToolButton>
      <ToolButton label={`Show the scene file in ${FILE_MANAGER}`} onClick={() => revealFile(scene.file)}>
        <FolderOpenIcon />
      </ToolButton>
      <ToolButton label="Duplicate scene" onClick={duplicate}>
        <DocumentDuplicateIcon />
      </ToolButton>
      <ToolButton label="Delete scene" onClick={remove} disabled={project.scenes.length <= 1} danger>
        <TrashIcon />
      </ToolButton>
      <ClearChat onClick={clear} disabled={!hasMessages} />
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
    <div className={TOOLBAR}>
      <Button variant="outline" size="sm" disabled={!canUndo} onClick={undo} title="Undo the project chat’s last change">
        <ArrowUturnLeftIcon data-icon="inline-start" />
        Undo
      </Button>
      <Button variant="outline" size="sm" onClick={checkSeams} disabled={checking} title="Pixel-compare every cut">
        {checking ? <Spinner data-icon="inline-start" /> : <ViewfinderCircleIcon data-icon="inline-start" />}
        Check seams
      </Button>
      <ToolButton label={`Show the project folder in ${FILE_MANAGER}`} onClick={() => revealFile(`${project.dir}/project.json`)}>
        <FolderOpenIcon />
      </ToolButton>
      <ClearChat onClick={clear} disabled={!hasMessages} />
    </div>
  );
}

/** The right column's icon rail: Chat, Soundtrack, Sound effects. Badges show what's happening in the hidden panels. */
function Rail() {
  const project = useEditor((s) => s.project)!;
  const rail = useEditor((s) => s.rail);
  const busy = useEditor((s) => Object.entries(s.chats).some(([key, chat]) => chat.busy && key.startsWith(`${project.id}/`)));
  const musicStatus = useEditor((s) => s.musicStatus);
  const problems = useSoundProblems().length;
  // A turn that finishes while another panel is open leaves a dot on Chat until it's opened.
  const [unread, setUnread] = useState(false);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy && useEditor.getState().rail !== 'chat') setUnread(true);
    wasBusy.current = busy;
  }, [busy]);
  useEffect(() => {
    if (rail === 'chat') setUnread(false);
  }, [rail]);
  useEffect(() => setUnread(false), [project.id]);

  const item = (id: RailItem, name: string, status: string | null, icon: IconSvgElement, badge: ReactNode = null) => {
    const label = status ? `${name} · ${status}` : name;
    const active = rail === id;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={label}
        title={label}
        className={cn(
          'relative grid size-9 place-items-center rounded-xl transition-colors duration-150',
          active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
        )}
        data-drop={id === 'sounds' ? 'sounds' : undefined}
        onClick={() => useEditor.setState({ rail: id })}
      >
        <HugeiconsIcon icon={icon} strokeWidth={1.5} className="size-5" />
        {badge}
      </button>
    );
  };
  const working = (
    <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-background text-action-text ring-2 ring-background">
      <Spinner className="size-3" />
    </span>
  );
  const dot = (tone: 'brand' | 'error') => (
    <span
      className={cn(
        'absolute top-1 right-1 size-2 rounded-full ring-2 ring-background',
        tone === 'brand' ? 'bg-action' : 'bg-destructive',
      )}
    />
  );

  return (
    <nav
      role="tablist"
      aria-orientation="vertical"
      aria-label="Panels"
      className={cn(ISLAND, 'flex w-12 flex-col items-center gap-1 self-start p-1.5 [grid-area:rail]')}
    >
      {item(
        'chat',
        'Chat',
        busy ? 'The agent is working' : unread ? 'The agent replied' : null,
        AiChat02Icon,
        busy ? working : unread ? dot('brand') : null,
      )}
      {item(
        'soundtrack',
        'Soundtrack',
        musicStatus === 'analyzing' ? 'analyzing' : musicStatus === 'error' ? 'analysis failed' : null,
        MusicNote03Icon,
        musicStatus === 'analyzing' ? working : musicStatus === 'error' ? dot('error') : null,
      )}
      {item(
        'sounds',
        'Sound effects',
        problems ? `${problems} problem${problems === 1 ? '' : 's'}` : null,
        AudioWave01Icon,
        problems ? (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] font-semibold text-amber-950 tabular-nums ring-2 ring-background">
            {problems}
          </span>
        ) : null,
      )}
    </nav>
  );
}

function ChatPanel() {
  const panel = useEditor((s) => s.panel);
  const project = useEditor((s) => s.project)!;
  const scene = useEditor((s) => currentScene(s));
  const scopeKey = panel === 'scene' ? scene?.id : '_project';
  return (
    <>
      <header className={ISLAND_HEADER}>
        <Segmented
          size="sm"
          label="Which chat"
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
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <h2 title={project.name} className="min-w-0 flex-1 truncate text-sm font-medium">
              {project.name}
            </h2>
            <span className="shrink-0 px-2.5 font-mono text-[0.8rem] text-muted-foreground tabular-nums">
              {totalDuration(project).toFixed(2)}s
            </span>
          </div>
        )}
      </header>
      {panel === 'scene' && scene ? <SceneToolbar scene={scene} /> : <ProjectToolbar />}
      {scopeKey && <Chat key={`${project.id}/${scopeKey}`} scopeKey={scopeKey} />}
    </>
  );
}

export function SidePanel() {
  const rail = useEditor((s) => s.rail);
  return (
    <>
      <aside
        aria-label="Side panel"
        className={cn(ISLAND, 'flex min-h-0 min-w-0 flex-col overflow-hidden [grid-area:side]')}
        data-drop={rail === 'sounds' ? 'sounds' : undefined}
      >
        {rail === 'soundtrack' ? <SoundtrackPanel /> : rail === 'sounds' ? <SoundsPanel /> : <ChatPanel />}
      </aside>
      <Rail />
    </>
  );
}

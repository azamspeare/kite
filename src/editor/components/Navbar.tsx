import { ClipboardDocumentIcon, PaintBrushIcon, PlayIcon, PlusIcon } from '@heroicons/react/16/solid';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { FILE_MANAGER } from '@/lib/files';
import { cn } from '@/lib/utils';
import { currentScene, setView, toast, toastError, useEditor, type View } from '../store';
import { KiteMark } from './Logo';
import { ProjectName } from './ProjectName';

/**
 * A navbar link. The ghost button's own hover is `muted`, which is the canvas colour, so hover and the
 * current page use a tint of `foreground` instead (Rika's navbar).
 */
function NavbarLink({
  current = false,
  onClick,
  className,
  children,
}: {
  current?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="lg"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={cn('hover:bg-foreground/5', current && 'bg-foreground/5', className)}
    >
      {children}
    </Button>
  );
}

async function copyPath() {
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
}

const newProject = () => useEditor.setState({ modal: 'new-project' });

/**
 * The navbar sits straight on the canvas, with no bar of its own: the mark and wordmark, the Projects
 * link, then the open project's name and its two views. The project's actions sit at the right.
 */
export function Navbar() {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const inProject = Boolean(project) && view !== 'projects';
  const go = (next: View) => () => setView(next);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4">
      <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-3">
        <NavbarLink onClick={go('projects')} className="shrink-0 gap-2.5">
          <KiteMark className="size-5 text-action-text" />
          <span className="font-brand text-xl leading-none font-medium tracking-tight">Kite</span>
        </NavbarLink>
        <Separator orientation="vertical" className="data-vertical:h-6 data-vertical:self-center" />
        <NavbarLink current={!inProject} onClick={go('projects')} className="shrink-0">
          Projects
        </NavbarLink>
        {inProject && project && (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <div className="flex min-w-0 items-center gap-3">
              <ProjectName key={project.id} id={project.id} name={project.name} />
            </div>
            <Separator orientation="vertical" className="data-vertical:h-6 data-vertical:self-center" />
            <div className="flex shrink-0 items-center gap-1">
              <NavbarLink current={view === 'scenes'} onClick={go('scenes')}>
                Scenes
              </NavbarLink>
              <NavbarLink current={view === 'render'} onClick={go('render')}>
                Render
              </NavbarLink>
            </div>
          </>
        )}
      </nav>
      <div className="flex shrink-0 items-center gap-1.5">
        {inProject && project ? (
          <>
            <Button
              variant="ghost"
              size="lg"
              className="hover:bg-foreground/5"
              onClick={() => useEditor.setState({ modal: 'art' })}
            >
              <PaintBrushIcon data-icon="inline-start" className="text-muted-foreground" />
              Art direction
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="hover:bg-foreground/5"
              onClick={copyPath}
              title={`Copy the scene file's path (or the project folder's) to paste in ${FILE_MANAGER} or a terminal`}
            >
              <ClipboardDocumentIcon data-icon="inline-start" className="text-muted-foreground" />
              Copy path
            </Button>
            <Button variant="outline" size="lg" onClick={newProject} className="ml-1.5">
              <PlusIcon data-icon="inline-start" />
              New project
            </Button>
            <Button
              catalyst
              color="action"
              size="lg"
              className="ml-1.5"
              onClick={() => useEditor.setState({ presenting: true, playing: false })}
              disabled={project.scenes.length === 0}
            >
              <PlayIcon data-icon="inline-start" />
              Present
            </Button>
          </>
        ) : null}
      </div>
    </header>
  );
}

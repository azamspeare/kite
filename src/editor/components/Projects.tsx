import { FilmIcon, PlusIcon } from '@heroicons/react/16/solid';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { posterTime } from '@/lib/scenes';
import type { ProjectSummary } from '../../shared/types';
import { loadProjects, openProject, setView, toastError, useEditor } from '../store';
import { FrameView } from './FrameView';
import { formatRelative } from './ui';

const newProject = () => useEditor.setState({ modal: 'new-project' });

/** The open project only needs showing; opening it again would drop its loaded state, such as its sound cues. */
function open(id: string) {
  if (useEditor.getState().project?.id === id) setView('scenes');
  else openProject(id).catch(toastError);
}

function NewProjectButton() {
  return (
    <Button catalyst color="primary" onClick={newProject}>
      <PlusIcon data-icon="inline-start" />
      New project
    </Button>
  );
}

function sceneCount(count: number) {
  return `${count} scene${count === 1 ? '' : 's'}`;
}

/** A file card, as in Figma's file browser: the first scene runs edge to edge, with the name under it. */
function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Item
      variant="outline"
      render={<button type="button" onClick={() => open(project.id)} />}
      className="flex-col flex-nowrap items-stretch gap-0 overflow-hidden rounded-xl p-0 text-left hover:border-brand"
    >
      <div className="relative flex aspect-video items-center justify-center border-b bg-muted p-5">
        <div
          className="relative h-full max-w-full overflow-hidden rounded-sm bg-white shadow-xs ring-1 ring-foreground/10"
          style={{ aspectRatio: `${project.width} / ${project.height}` }}
        >
          {project.firstScene && (
            <FrameView
              projectId={project.id}
              sceneId={project.firstScene.id}
              mode="thumb"
              time={posterTime(project.firstScene.duration)}
              title={`First scene of ${project.name}`}
              className="pointer-events-none absolute inset-0 size-full border-0"
            />
          )}
        </div>
        <span className="absolute right-2 bottom-2 rounded-md bg-background/90 px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums shadow-xs">
          {project.duration.toFixed(1)}s
        </span>
      </div>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* Item nudges its media to sit beside the title's first line; here it centres on the two lines instead. */}
        <ItemMedia
          variant="icon"
          className="size-8 rounded-lg bg-muted text-foreground group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center"
        >
          <FilmIcon />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="block w-full truncate">{project.name}</ItemTitle>
          <ItemDescription className="line-clamp-1 tabular-nums">
            {sceneCount(project.sceneCount)} · Edited{' '}
            <time dateTime={new Date(project.updatedAt).toISOString()} title={new Date(project.updatedAt).toLocaleString()}>
              {formatRelative(project.updatedAt)}
            </time>
          </ItemDescription>
        </ItemContent>
      </div>
    </Item>
  );
}

/**
 * The projects page, a Catalyst stacked layout as in Rika: one white card on the canvas holds the
 * title, the main action and a grid of project cards, the most recently edited first.
 */
export function Projects() {
  const projects = useEditor((s) => s.projects);
  // Scene counts and edit times change while another project is open, so the list is fetched again on arrival.
  useEffect(() => {
    loadProjects().catch(toastError);
  }, []);
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-px pb-3">
      <div className="flex grow flex-col rounded-3xl bg-background p-6 shadow-xs ring-1 ring-foreground/5 lg:p-10">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl/8 font-semibold">Projects</h1>
              <p className="mt-1 max-w-prose text-sm/6 text-muted-foreground">
                Each project is one video. Every scene in it is a small piece of code the agent writes and refines.
              </p>
            </div>
            {projects.length > 0 && <NewProjectButton />}
          </div>
          <Separator className="mt-6" />
          <div className="mt-8 flex flex-1 flex-col">
            {projects.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilmIcon />
                  </EmptyMedia>
                  <EmptyTitle>No projects yet</EmptyTitle>
                  <EmptyDescription>
                    Start one and describe what you want. Your agent writes each scene while you watch the preview.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <NewProjectButton />
                </EmptyContent>
              </Empty>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
                {projects.map((project) => (
                  <li key={project.id}>
                    <ProjectCard project={project} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

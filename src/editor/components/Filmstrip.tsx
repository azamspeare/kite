import { PlusIcon } from '@heroicons/react/16/solid';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { posterTime } from '@/lib/scenes';
import { cn } from '@/lib/utils';
import type { SceneState, SeamResult } from '../../shared/types';
import { api } from '../api';
import { refreshProject, selectScene, toast, toastError, useEditor } from '../store';
import { FrameView } from './FrameView';

/** A tile is 96px tall at the project's aspect ratio; its name and duration sit under it. */
const TILE = 'h-24 shrink-0 rounded-xl shadow-xs ring-1 ring-foreground/5';

/** How much of the picture changes at a cut, coloured from invisible (green) to a visible cut (neutral). */
const SEAM_TONES = {
  clean: 'bg-success/10 text-success-foreground ring-success/25',
  faint: 'bg-lime-500/10 text-lime-700 ring-lime-600/25',
  jump: 'bg-warning/12 text-warning-foreground ring-warning/30',
  cut: 'bg-background text-muted-foreground ring-foreground/10',
  error: 'bg-destructive/8 text-destructive-foreground ring-destructive/25',
};

function SeamBadge({ seam }: { seam: SeamResult | undefined }) {
  const project = useEditor((s) => s.project)!;
  const [checking, setChecking] = useState(false);
  if (!seam) return <div className="w-7 shrink-0" />;
  const value = seam.diffPercent;
  const tone = value < 0 ? 'error' : value < 0.05 ? 'clean' : value < 0.5 ? 'faint' : value < 5 ? 'jump' : 'cut';
  const label = value < 0 ? '!' : value < 0.05 ? '0%' : `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
  const title =
    value < 0
      ? `Seam check failed: ${seam.error}`
      : `${value.toFixed(2)}% of pixels change at this cut${value < 0.05 ? ' — invisible' : value >= 5 ? ' — a visible cut' : ''}. Click to re-check.`;
  return (
    <div className="grid h-24 w-7 shrink-0 place-items-center">
      <button
        type="button"
        className={cn(
          'z-1 h-5 min-w-5.5 rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums ring-1 transition-opacity',
          SEAM_TONES[tone],
          checking && 'opacity-50',
        )}
        title={title}
        onClick={async () => {
          setChecking(true);
          try {
            const [result] = await api.checkSeams(project.id, seam.from);
            const fresh = result && result.to === seam.to ? result : undefined;
            if (fresh)
              toast(
                `Cut into “${project.scenes.find((s) => s.id === seam.to)?.name}”: ${fresh.diffPercent.toFixed(2)}% of pixels differ`,
              );
          } catch (e) {
            toastError(e);
          } finally {
            setChecking(false);
          }
        }}
      >
        {label}
      </button>
    </div>
  );
}

function SceneCard(props: {
  scene: SceneState;
  selected: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { scene, selected } = props;
  const project = useEditor((s) => s.project)!;
  const [hasError, setHasError] = useState(false);
  const tileWidth = (6 * project.width) / project.height;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selected]);

  return (
    <div
      ref={ref}
      data-scene-card
      className={cn('flex shrink-0 cursor-grab flex-col gap-1.5 select-none', props.dragging && 'opacity-40')}
      // As wide as the tile (6rem tall at the project's ratio), and never narrower than the duration under it.
      style={{ width: `max(4.5rem, ${tileWidth}rem)` }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-scene', scene.id);
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      onClick={() => selectScene(scene.id)}
    >
      <button
        type="button"
        aria-label={`Scene ${scene.index + 1}: ${scene.name}`}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          TILE,
          'relative self-start bg-white transition-shadow duration-150 hover:ring-foreground/25 focus-visible:outline-offset-[5px]',
          // The scene on the stage is marked by a frame laid over the tile, 3px thick, reaching 2px outside it (Rika's strip).
          selected &&
            'after:pointer-events-none after:absolute after:-inset-0.5 after:rounded-[calc(var(--radius-xl)+2px)] after:border-[3px] after:border-action',
        )}
        style={{ aspectRatio: `${project.width} / ${project.height}` }}
      >
        {/* The scene is clipped to the tile's corners here, so the frame above can reach outside it. */}
        <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
          <FrameView
            projectId={project.id}
            sceneId={scene.id}
            mode="thumb"
            time={posterTime(scene.duration)}
            className="pointer-events-none absolute inset-0 size-full border-0"
            title={`${scene.name} thumbnail`}
            onErrors={(errors) => setHasError(errors.length > 0)}
          />
        </span>
        <span className="absolute bottom-1.5 left-1.5 rounded-sm bg-background/85 px-1 text-xs font-medium text-muted-foreground tabular-nums">
          {scene.index + 1}
        </span>
        {hasError && (
          <span
            title="This scene has an error"
            className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </button>
      {/* A narrow (portrait) tile has no room for both on one line, so the duration goes under the name. */}
      <div className={cn('flex px-0.5 text-xs', tileWidth < 7 ? 'flex-col' : 'items-baseline gap-2')}>
        <span className={cn('truncate font-medium', !selected && 'text-foreground/80')}>{scene.name}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{scene.duration.toFixed(2)}s</span>
      </div>
    </div>
  );
}

function DropIndicator() {
  return <div className="-mx-0.5 h-24 w-0.75 shrink-0 rounded-full bg-action" />;
}

export function Filmstrip() {
  const project = useEditor((s) => s.project)!;
  const sceneId = useEditor((s) => s.sceneId);
  const seams = useEditor((s) => s.seams);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  const addScene = async () => {
    try {
      const created = await api.createScene(project.id, {
        name: 'New scene',
        afterId: project.scenes[project.scenes.length - 1]?.id,
      });
      await refreshProject();
      selectScene(created.id);
      document.querySelector<HTMLTextAreaElement>('#composer-input')?.focus();
    } catch (e) {
      toastError(e);
    }
  };

  const drop = async () => {
    if (!dragId || dropIndex === null) return;
    const order = project.scenes.map((s) => s.id).filter((id) => id !== dragId);
    const from = project.scenes.findIndex((s) => s.id === dragId);
    const at = dropIndex > from ? dropIndex - 1 : dropIndex;
    order.splice(at, 0, dragId);
    setDragId(null);
    setDropIndex(null);
    if (order.join() === project.scenes.map((s) => s.id).join()) return;
    try {
      await api.reorder(project.id, order);
      await refreshProject();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    // The strip sits on the canvas, under the stage; its tiles are small islands. The padding gives the tiles'
    // frames and focus rings room inside the scroll area, which clips; the negative margin takes it back.
    <nav
      aria-label="Scenes"
      className="-mx-2 -mb-2 overflow-x-auto overflow-y-hidden px-2 pt-1 pb-2 [grid-area:filmstrip]"
      ref={strip}
      onWheel={(e) => {
        if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY;
      }}
    >
      <div
        className="flex w-max items-start pt-1"
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-scene-card]')];
          let index = cards.length;
          for (let i = 0; i < cards.length; i++) {
            const rect = cards[i].getBoundingClientRect();
            if (e.clientX < rect.left + rect.width / 2) {
              index = i;
              break;
            }
          }
          setDropIndex(index);
        }}
        onDrop={(e) => {
          e.preventDefault();
          void drop();
        }}
      >
        {project.scenes.map((scene, i) => (
          <Fragment key={scene.id}>
            {i > 0 && <SeamBadge seam={seams.find((x) => x.from === project.scenes[i - 1].id && x.to === scene.id)} />}
            {dragId && dropIndex === i && <DropIndicator />}
            <SceneCard
              scene={scene}
              selected={scene.id === sceneId}
              dragging={dragId === scene.id}
              onDragStart={() => setDragId(scene.id)}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
            />
          </Fragment>
        ))}
        {dragId && dropIndex === project.scenes.length && <DropIndicator />}
        <Button
          variant="ghost"
          onClick={addScene}
          title="Add a scene at the end"
          className={cn(
            TILE,
            'ml-7 flex-col gap-1 bg-background text-muted-foreground hover:bg-background hover:text-foreground',
          )}
          style={{ aspectRatio: `${Math.max(project.width / project.height, 1)}` }}
        >
          <PlusIcon />
          Add scene
        </Button>
      </div>
    </nav>
  );
}

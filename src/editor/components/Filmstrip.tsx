import { Plus } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { SceneState, SeamResult } from '../../shared/types';
import { api } from '../api';
import { refreshProject, selectScene, toast, toastError, useEditor } from '../store';
import { FrameView } from './FrameView';

function posterTime(scene: SceneState) {
  return Math.max(0, Math.min(scene.duration - 0.02, scene.duration * 0.62));
}

function SeamBadge({ seam }: { seam: SeamResult | undefined }) {
  const project = useEditor((s) => s.project)!;
  const [checking, setChecking] = useState(false);
  if (!seam) return <div className="seam" />;
  const value = seam.diffPercent;
  const tone = value < 0 ? 'error' : value < 0.05 ? 'clean' : value < 0.5 ? 'faint' : value < 5 ? 'jump' : 'cut';
  const label = value < 0 ? '!' : value < 0.05 ? '0%' : `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
  const title =
    value < 0
      ? `Seam check failed: ${seam.error}`
      : `${value.toFixed(2)}% of pixels change at this cut${value < 0.05 ? ' — invisible' : value >= 5 ? ' — a visible cut' : ''}. Click to re-check.`;
  return (
    <div className="seam">
      <button
        className={`seam-badge seam-${tone} ${checking ? 'checking' : ''}`}
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selected]);

  return (
    <div
      ref={ref}
      className={`scene-card ${selected ? 'selected' : ''} ${props.dragging ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-scene', scene.id);
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      onClick={() => selectScene(scene.id)}
    >
      <div className="thumb" style={{ aspectRatio: `${project.width} / ${project.height}` }}>
        <FrameView
          projectId={project.id}
          sceneId={scene.id}
          mode="thumb"
          time={posterTime(scene)}
          className="thumb-frame"
          title={`${scene.name} thumbnail`}
          onErrors={(errors) => setHasError(errors.length > 0)}
        />
        <span className="thumb-index">{scene.index + 1}</span>
        {hasError && <span className="thumb-error" title="This scene has an error" />}
      </div>
      <div className="scene-card-meta">
        <span className="scene-card-name">{scene.name}</span>
        <span className="scene-card-duration">{scene.duration.toFixed(2)}s</span>
      </div>
    </div>
  );
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
      document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
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
    <div
      className="filmstrip"
      ref={strip}
      onWheel={(e) => {
        if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY;
      }}
    >
      <div
        className="filmstrip-inner"
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.scene-card')];
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
            {dragId && dropIndex === i && <div className="drop-indicator" />}
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
        {dragId && dropIndex === project.scenes.length && <div className="drop-indicator" />}
        <button className="add-card" onClick={addScene} title="Add a scene at the end">
          <Plus size={20} />
          <span>Add scene</span>
        </button>
      </div>
    </div>
  );
}

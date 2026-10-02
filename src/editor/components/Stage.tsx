import { ArrowPathIcon, ArrowRightIcon } from '@heroicons/react/16/solid';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { previewAudio } from '../audio';
import { currentScene, previewDuration, seek, useEditor } from '../store';
import { FrameView, type FrameHandle } from './FrameView';
import { Transport } from './Transport';
import { ISLAND, ISLAND_HEADER } from './ui';

/** Plays the soundtrack and the sound cues from the playhead, and advances time from the audio clock while playing. */
function Playback() {
  const project = useEditor((s) => s.project);
  const soundCues = useEditor((s) => s.soundCues);
  const volume = useEditor((s) => s.project?.music?.volume ?? 1);
  const playing = useEditor((s) => s.playing);
  const muted = useEditor((s) => s.muted);

  useEffect(() => previewAudio.setMuted(muted), [muted]);
  useEffect(() => previewAudio.setMusicVolume(volume), [volume]);
  useEffect(() => {
    if (project) previewAudio.preload(project, soundCues.cues);
  }, [project, soundCues]);

  useEffect(() => {
    if (!playing) return;
    const get = useEditor.getState;
    /** Video time at playhead 0 of whatever is being previewed. */
    const origin = () => {
      const s = get();
      return s.mode === 'scene' ? (currentScene(s)?.start ?? 0) : 0;
    };
    const restart = () => {
      const s = get();
      if (!s.project) return;
      const from = origin();
      void previewAudio.start({
        project: s.project,
        cues: s.soundCues.cues,
        from: from + s.time,
        until: from + previewDuration(s),
      });
    };
    restart();

    let raf = 0;
    const tick = () => {
      const s = get();
      const duration = previewDuration(s);
      const heard = previewAudio.now();
      const t = heard === null ? s.time : heard - origin();
      if (t >= duration) {
        if (s.mode === 'scene' && s.loop) {
          seek(0);
          restart();
        } else {
          seek(duration);
          useEditor.setState({ playing: false });
          return;
        }
      } else {
        seek(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Start over from the new position when the user scrubs, switches mode, or picks another scene in scene mode.
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.seekNonce !== prev.seekNonce || s.mode !== prev.mode || (s.mode === 'scene' && s.sceneId !== prev.sceneId)) restart();
    });
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      previewAudio.stop();
    };
  }, [playing]);

  return null;
}

/** "Scene 2 of 5 · Anatomy", and in scene mode whether the preview loops. Lines up with the side panel's header. */
function StageHeader() {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor((s) => currentScene(s));
  const mode = useEditor((s) => s.mode);
  const loop = useEditor((s) => s.loop);
  return (
    <header className={cn(ISLAND_HEADER, 'justify-between')}>
      {scene ? (
        <p className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium tabular-nums">
          <span className="shrink-0">
            Scene {scene.index + 1} <span className="text-muted-foreground">of {project.scenes.length}</span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="truncate text-muted-foreground" title={scene.name}>
            {scene.name}
          </span>
        </p>
      ) : (
        <p className="text-sm font-medium text-muted-foreground">No scenes</p>
      )}
      {scene && mode === 'scene' && (
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={loop}
          onClick={() => useEditor.setState({ loop: !loop })}
          title="Toggle looping while previewing this scene"
          className="shrink-0 text-muted-foreground"
        >
          {loop ? <ArrowPathIcon data-icon="inline-start" /> : <ArrowRightIcon data-icon="inline-start" />}
          {loop ? 'Loops' : 'Plays once'}
        </Button>
      )}
    </header>
  );
}

export function Stage() {
  const project = useEditor((s) => s.project)!;
  const mode = useEditor((s) => s.mode);
  const sceneId = useEditor((s) => s.sceneId);
  const sceneFrame = useRef<FrameHandle>(null);
  const wholeFrame = useRef<FrameHandle>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const renderNow = () => {
      const s = useEditor.getState();
      (s.mode === 'scene' ? sceneFrame : wholeFrame).current?.render(s.time);
    };
    renderNow();
    return useEditor.subscribe((s, prev) => {
      // Switching scenes in scene mode renders once the frame has loaded the new scene (FrameView → onReady).
      if (s.mode === 'scene' && s.sceneId !== prev.sceneId) return;
      if (s.time !== prev.time || s.mode !== prev.mode || s.sceneId !== prev.sceneId || s.project !== prev.project) renderNow();
    });
  }, []);

  const renderCurrent = () => {
    const s = useEditor.getState();
    (s.mode === 'scene' ? sceneFrame : wholeFrame).current?.render(s.time);
  };

  return (
    <section aria-label="Stage" className={cn(ISLAND, 'flex min-h-0 min-w-0 flex-col overflow-hidden [grid-area:stage]')}>
      <StageHeader />
      {/* The frame is as large as fits, at the project's aspect ratio, on a quiet tray. */}
      <div className="relative min-h-0 flex-1 bg-tray p-4">
        <div className="grid size-full place-items-center [container-type:size]">
          <div
            className="relative aspect-(--ratio) w-[min(100cqw,calc(100cqh*var(--ratio)))] overflow-hidden rounded-lg bg-white shadow-card"
            style={{ ['--ratio' as string]: `${project.width / project.height}` }}
          >
            <FrameView
              key={`${project.id}:scene`}
              ref={sceneFrame}
              projectId={project.id}
              sceneId={sceneId}
              mode="editor"
              className={cn('absolute inset-0 block size-full border-0', mode !== 'scene' && 'invisible')}
              onReady={renderCurrent}
              onErrors={(e) => mode === 'scene' && setErrors(e)}
            />
            <FrameView
              key={`${project.id}:whole`}
              ref={wholeFrame}
              projectId={project.id}
              mode="editor"
              className={cn('absolute inset-0 block size-full border-0', mode !== 'whole' && 'invisible')}
              onReady={renderCurrent}
              onErrors={(e) => mode === 'whole' && setErrors(e)}
              onSounds={(soundCues) => useEditor.setState({ soundCues })}
            />
          </div>
        </div>
        {errors.length > 0 && (
          <p
            role="alert"
            title={errors[0]}
            className="absolute bottom-6 left-6 max-w-[calc(100%-3rem)] truncate rounded-lg bg-destructive px-2.5 py-1.5 text-xs font-medium text-white shadow-island"
          >
            {errors[0].split('\n')[0]}
          </p>
        )}
      </div>
      <Transport />
      <Playback />
    </section>
  );
}

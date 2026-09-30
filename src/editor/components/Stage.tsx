import { useEffect, useRef, useState } from 'react';
import { currentScene, previewDuration, seek, useEditor } from '../store';
import { FrameView, type FrameHandle } from './FrameView';
import { Transport } from './Transport';

/** Keeps the soundtrack in sync with the playhead and advances time while playing. */
function Playback() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicUrl = useEditor((s) => s.project?.musicUrl ?? null);
  const volume = useEditor((s) => s.project?.music?.volume ?? 1);
  const playing = useEditor((s) => s.playing);
  const muted = useEditor((s) => s.muted);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!playing) {
      audio?.pause();
      return;
    }
    const get = useEditor.getState;
    /** Track time at playhead 0 of whatever is being previewed. */
    const offset = () => {
      const s = get();
      const start = s.project?.music?.start ?? 0;
      return s.mode === 'scene' ? start + (currentScene(s)?.start ?? 0) : start;
    };
    const syncAudio = () => {
      if (!audio || !get().project?.musicUrl) return;
      const target = offset() + get().time;
      if (target < 0 || (audio.duration && target >= audio.duration)) {
        audio.pause();
        return;
      }
      if (Math.abs(audio.currentTime - target) > 0.03) audio.currentTime = target;
      void audio.play().catch(() => undefined);
    };
    syncAudio();

    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const s = get();
      const duration = previewDuration(s);
      let t: number;
      if (audio && s.project?.musicUrl && !audio.paused && !audio.ended && audio.readyState >= 2) {
        t = audio.currentTime - offset();
      } else {
        t = s.time + (now - last) / 1000;
      }
      last = now;
      if (t >= duration) {
        if (s.mode === 'scene' && s.loop) {
          seek(0);
          syncAudio();
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

    // Re-sync the audio when the user scrubs, switches mode, or picks another scene in scene mode.
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.seekNonce !== prev.seekNonce || s.mode !== prev.mode || (s.mode === 'scene' && s.sceneId !== prev.sceneId)) {
        last = performance.now();
        syncAudio();
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      audio?.pause();
    };
  }, [playing]);

  return musicUrl ? <audio ref={audioRef} src={musicUrl} preload="auto" muted={muted} /> : null;
}

function StageHeader() {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor((s) => currentScene(s));
  const mode = useEditor((s) => s.mode);
  const loop = useEditor((s) => s.loop);
  if (!scene) return <div className="stage-header">No scenes</div>;
  return (
    <div className="stage-header">
      <strong>
        Scene {scene.index + 1} of {project.scenes.length}
      </strong>
      <span className="dim"> · {scene.name}</span>
      {mode === 'scene' && (
        <>
          <span className="dim"> · </span>
          <button
            className="link-btn dim"
            onClick={() => useEditor.setState({ loop: !loop })}
            title="Toggle looping while previewing this scene"
          >
            {loop ? 'loops' : 'plays once'}
          </button>
        </>
      )}
    </div>
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
    <section className="stage-col">
      <StageHeader />
      <div className="stage-area">
        <div className="stage-frame" style={{ ['--ratio' as string]: `${project.width / project.height}` }}>
          <FrameView
            key={`${project.id}:scene`}
            ref={sceneFrame}
            projectId={project.id}
            sceneId={sceneId}
            mode="editor"
            className={`frame ${mode === 'scene' ? '' : 'frame-hidden'}`}
            onReady={renderCurrent}
            onErrors={(e) => mode === 'scene' && setErrors(e)}
          />
          <FrameView
            key={`${project.id}:whole`}
            ref={wholeFrame}
            projectId={project.id}
            mode="editor"
            className={`frame ${mode === 'whole' ? '' : 'frame-hidden'}`}
            onReady={renderCurrent}
            onErrors={(e) => mode === 'whole' && setErrors(e)}
          />
        </div>
        {errors.length > 0 && <div className="stage-error">{errors[0].split('\n')[0]}</div>}
      </div>
      <Transport />
      <Playback />
    </section>
  );
}

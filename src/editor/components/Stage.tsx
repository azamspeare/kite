import { useEffect, useRef, useState } from 'react';
import { previewAudio } from '../audio';
import { currentScene, previewDuration, seek, useEditor } from '../store';
import { FrameView, type FrameHandle } from './FrameView';
import { Transport } from './Transport';

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
            onSounds={(soundCues) => useEditor.setState({ soundCues })}
          />
        </div>
        {errors.length > 0 && <div className="stage-error">{errors[0].split('\n')[0]}</div>}
      </div>
      <Transport />
      <Playback />
    </section>
  );
}

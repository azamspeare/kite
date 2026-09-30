import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { previewAudio } from '../audio';
import { totalDuration, useEditor } from '../store';
import { FrameView, type FrameHandle } from './FrameView';

/** Fullscreen playback of the whole video with its soundtrack and sound effects. */
export function Present() {
  const project = useEditor((s) => s.project)!;
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<FrameHandle>(null);
  const playingRef = useRef(false);
  const timeRef = useRef(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [controls, setControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const total = totalDuration(project);

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    useEditor.setState({ presenting: false });
  }, []);

  const startAudio = useCallback(() => {
    void previewAudio.start({ project, cues: useEditor.getState().soundCues.cues, from: timeRef.current, until: total });
  }, [project, total]);

  const jump = useCallback(
    (t: number) => {
      timeRef.current = Math.max(0, Math.min(total, t));
      setTime(timeRef.current);
      frame.current?.render(timeRef.current);
      if (playingRef.current) startAudio();
    },
    [total, startAudio],
  );

  useEffect(() => {
    // Presenting always plays the sound, even when the editor preview is muted.
    previewAudio.setMuted(false);
    return () => previewAudio.setMuted(useEditor.getState().muted);
  }, []);

  useEffect(() => {
    void root.current?.requestFullscreen?.().catch(() => undefined);
    const onFullscreen = () => {
      if (!document.fullscreenElement) useEditor.setState({ presenting: false });
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    if (!ready) return;
    frame.current?.render(0);
    const id = setTimeout(() => setPlaying(true), 400);
    return () => clearTimeout(id);
  }, [ready]);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing) {
      previewAudio.stop();
      return;
    }
    if (timeRef.current >= total) jump(0);
    startAudio();
    let raf = 0;
    const tick = () => {
      let t = previewAudio.now() ?? timeRef.current;
      if (t >= total) {
        t = total;
        setPlaying(false);
      }
      timeRef.current = t;
      frame.current?.render(t);
      setTime(t);
      if (t < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      previewAudio.stop();
    };
  }, [playing, total, jump, startAudio]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const starts = project.scenes.map((s) => s.start);
        const now = timeRef.current;
        const target =
          e.key === 'ArrowRight'
            ? (starts.find((s) => s > now + 0.05) ?? total)
            : ([...starts].reverse().find((s) => s < now - 0.3) ?? 0);
        jump(target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, jump, project, total]);

  const poke = () => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 1800);
  };

  return (
    <div ref={root} className={`present ${controls ? '' : 'present-idle'}`} onMouseMove={poke}>
      <FrameView
        ref={frame}
        projectId={project.id}
        mode="present"
        className="present-frame"
        onReady={() => setReady(true)}
        onSounds={(soundCues) => useEditor.setState({ soundCues })}
      />
      <div className="present-controls">
        <button className="present-btn" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {time >= total && !playing ? (
            <RotateCcw size={18} />
          ) : playing ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" />
          )}
        </button>
        <div
          className="present-progress"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            jump(((e.clientX - rect.left) / rect.width) * total);
          }}
        >
          <div style={{ width: `${(time / Math.max(total, 0.001)) * 100}%` }} />
        </div>
        <span className="present-time">
          {time.toFixed(1)} / {total.toFixed(1)}s
        </span>
        <button className="present-btn" onClick={close} aria-label="Exit">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

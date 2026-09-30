import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { totalDuration, useEditor } from '../store';
import { FrameView, type FrameHandle } from './FrameView';

/** Fullscreen playback of the whole video with its soundtrack. */
export function Present() {
  const project = useEditor((s) => s.project)!;
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<FrameHandle>(null);
  const audio = useRef<HTMLAudioElement>(null);
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

  const jump = useCallback(
    (t: number) => {
      timeRef.current = Math.max(0, Math.min(total, t));
      setTime(timeRef.current);
      frame.current?.render(timeRef.current);
      const a = audio.current;
      if (a && project.musicUrl) a.currentTime = (project.music?.start ?? 0) + timeRef.current;
    },
    [total, project],
  );

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
    const a = audio.current;
    if (!playing) {
      a?.pause();
      return;
    }
    if (timeRef.current >= total) jump(0);
    const offset = project.music?.start ?? 0;
    if (a && project.musicUrl) {
      a.currentTime = offset + timeRef.current;
      void a.play().catch(() => undefined);
    }
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      let t =
        a && project.musicUrl && !a.paused && a.readyState >= 2 ? a.currentTime - offset : timeRef.current + (now - last) / 1000;
      last = now;
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
      a?.pause();
    };
  }, [playing, total, project, jump]);

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
      <FrameView ref={frame} projectId={project.id} mode="present" className="present-frame" onReady={() => setReady(true)} />
      {project.musicUrl && <audio ref={audio} src={project.musicUrl} preload="auto" />}
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

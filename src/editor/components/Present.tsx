import { ArrowPathIcon, PauseIcon, PlayIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
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

  const control =
    'grid size-9 shrink-0 place-items-center rounded-full text-white/80 transition-colors duration-150 hover:bg-white/12 hover:text-white';

  return (
    // Black, not a token: it is the letterbox around the video, part of the picture rather than the app's chrome.
    <div ref={root} className={cn('fixed inset-0 z-100 bg-black', !controls && 'cursor-none')} onMouseMove={poke}>
      <FrameView
        ref={frame}
        projectId={project.id}
        mode="present"
        className="absolute inset-0 size-full border-0"
        onReady={() => setReady(true)}
        onSounds={(soundCues) => useEditor.setState({ soundCues })}
      />
      {/* The controls float as a dark island over the bottom of the video and fade out while the pointer rests. */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-6 flex justify-center px-6 transition-opacity duration-300',
          !controls && 'pointer-events-none opacity-0',
        )}
      >
        <div className="flex w-full max-w-3xl items-center gap-3 rounded-full bg-zinc-950/75 py-1.5 pr-2 pl-1.5 text-white shadow-island-stronger backdrop-blur-md">
          <button type="button" className={control} onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
            {time >= total && !playing ? (
              <ArrowPathIcon className="size-4.5" />
            ) : playing ? (
              <PauseIcon className="size-4.5" />
            ) : (
              <PlayIcon className="ml-0.5 size-4.5" />
            )}
          </button>
          <div
            className="h-1.5 flex-1 cursor-pointer overflow-hidden rounded-full bg-white/20"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              jump(((e.clientX - rect.left) / rect.width) * total);
            }}
          >
            <div className="h-full rounded-full bg-white" style={{ width: `${(time / Math.max(total, 0.001)) * 100}%` }} />
          </div>
          <span className="font-mono text-xs text-white/80 tabular-nums">
            {time.toFixed(1)} / {total.toFixed(1)}s
          </span>
          <button type="button" className={control} onClick={close} aria-label="Leave presenting" title="Leave (Esc)">
            <XMarkIcon className="size-4.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

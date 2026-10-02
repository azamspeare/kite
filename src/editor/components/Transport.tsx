import { PauseIcon, PlayIcon, SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/16/solid';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ProjectState, ResolvedCue } from '../../shared/types';
import { currentScene, previewDuration, setMode, setPlaying, useEditor, userSeek } from '../store';
import { Segmented } from './ui';

interface Markers {
  beats: { t: number; down: boolean }[];
  phrases: number[];
  cuts: { t: number; name: string }[];
  wave: string | null;
  /** Sound cues, at the moment each is keyed to. */
  sounds: { t: number; label: string }[];
}

const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];

function useMarkers(project: ProjectState, windowStart: number, duration: number, whole: boolean, cues: ResolvedCue[]): Markers {
  return useMemo(() => {
    const a = project.musicAnalysis;
    const offset = (project.music?.start ?? 0) + windowStart;
    const inWindow = (t: number) => t >= -1e-6 && t <= duration + 1e-6;
    const cuts = whole ? project.scenes.slice(1).map((s) => ({ t: s.start, name: s.name })) : [];
    const sounds = cues.map((c) => ({ t: c.t - windowStart, label: c.sound })).filter((c) => inWindow(c.t));
    if (!a || !project.music) return { beats: [], phrases: [], cuts, wave: null, sounds };
    const downs = new Set(a.downbeats.map((d) => Math.round(d * 1000)));
    const beats = a.beats.map((b) => ({ t: b - offset, down: downs.has(Math.round(b * 1000)) })).filter((b) => inWindow(b.t));
    const phrases = a.phrases.map((p) => p - offset).filter(inWindow);
    // Mirrored waveform for the visible window.
    const n = 240;
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i <= n; i++) {
      const trackTime = offset + (i / n) * duration;
      const idx = Math.floor((trackTime / a.duration) * a.waveform.length);
      const v = idx >= 0 && idx < a.waveform.length ? a.waveform[idx] : 0;
      const h = 4 + v * 44;
      top.push(`${i},${50 - h}`);
      bottom.push(`${i},${50 + h}`);
    }
    const wave = `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`;
    return { beats, phrases, cuts, wave, sounds };
  }, [project, windowStart, duration, whole, cues]);
}

function formatTick(t: number, step: number): string {
  if (t >= 60) return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  return step < 1 ? `${Number(t.toFixed(2))}s` : `${Math.round(t)}s`;
}

function Scrubber(props: { duration: number; markers: Markers }) {
  const { duration, markers } = props;
  const time = useEditor((s) => s.time);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toTime = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  };
  const pct = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`;
  const step = TICK_STEPS.find((s) => (duration / s) * 96 <= width) ?? 300;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(Number(t.toFixed(3)));
  const showBeats = markers.beats.length > 0 && width / Math.max(1, markers.beats.length) > 3;
  // Sounds within a few pixels of the pointer, named in the hover label.
  const near =
    hover === null
      ? []
      : [
          ...new Set(
            markers.sounds.filter((m) => (Math.abs(m.t - hover) / Math.max(duration, 1e-3)) * width < 5).map((m) => m.label),
          ),
        ];

  return (
    <div
      ref={ref}
      aria-label="Scrubber"
      className="relative h-12 min-w-30 flex-1 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        userSeek(toTime(e.clientX));
      }}
      onPointerMove={(e) => {
        const t = toTime(e.clientX);
        setHover(t);
        if (dragging.current) userSeek(t);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {markers.wave && (
        <svg
          className="pointer-events-none absolute inset-x-0 top-0.5 h-7.5 w-full fill-foreground/8"
          viewBox="0 0 240 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d={markers.wave} />
        </svg>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-1.25 h-2.75" aria-hidden>
        {showBeats &&
          markers.beats.map((b, i) => (
            <span
              key={i}
              className={
                b.down ? 'absolute top-px h-2.25 w-px bg-foreground/45' : 'absolute top-1.25 h-1.25 w-px bg-foreground/20'
              }
              style={{ left: pct(b.t) }}
            />
          ))}
        {markers.phrases.map((p, i) => (
          <span
            key={`p${i}`}
            className="absolute -top-0.75 -ml-px h-3.25 w-0.5 rounded-xs bg-brand"
            style={{ left: pct(p) }}
            title={`Phrase at ${p.toFixed(2)}s`}
          />
        ))}
      </div>
      <div className="absolute inset-x-0 top-4.25 h-1.75 rounded-full bg-foreground/10">
        <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/55" style={{ width: pct(time) }} />
        {markers.cuts.map((c) => (
          <span
            key={c.t}
            className="absolute -inset-y-0.5 -ml-px w-0.5 bg-background"
            style={{ left: pct(c.t) }}
            title={`${c.name} starts at ${c.t.toFixed(2)}s`}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-6.5 h-1" aria-hidden>
        {markers.sounds.map((m, i) => (
          <span key={i} className="absolute top-0 -ml-0.5 size-1 rounded-full bg-brand" style={{ left: pct(m.t) }} />
        ))}
      </div>
      <div
        className="pointer-events-none absolute top-2.5 -ml-0.75 h-5.25 w-1.5 rounded-full bg-action ring-3 ring-action/20"
        style={{ left: pct(time) }}
      />
      {hover !== null && (
        <div className="pointer-events-none absolute -top-3.5 -translate-x-1/2" style={{ left: pct(hover) }}>
          <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] whitespace-nowrap text-primary-foreground tabular-nums">
            {hover.toFixed(2)}s{near.length > 0 && ` · ${near.slice(0, 3).join(', ')}${near.length > 3 ? '…' : ''}`}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-8 h-3.5" aria-hidden>
        {ticks.map((t, i) => (
          <span
            key={t}
            className={`absolute text-[11px] whitespace-nowrap text-muted-foreground tabular-nums ${i === 0 ? '' : '-translate-x-1/2'}`}
            style={{ left: pct(t) }}
          >
            {formatTick(t, step)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Transport() {
  const project = useEditor((s) => s.project)!;
  const mode = useEditor((s) => s.mode);
  const playing = useEditor((s) => s.playing);
  const time = useEditor((s) => s.time);
  const muted = useEditor((s) => s.muted);
  const scene = useEditor((s) => currentScene(s));
  const duration = useEditor((s) => previewDuration(s));
  const cues = useEditor((s) => s.soundCues.cues);
  const markers = useMarkers(project, mode === 'scene' ? (scene?.start ?? 0) : 0, duration, mode === 'whole', cues);

  return (
    <div className="flex h-16 shrink-0 items-center gap-4 border-t px-4">
      <Segmented
        label="What plays"
        value={mode}
        options={[
          ['scene', 'This scene'],
          ['whole', 'Whole video'],
        ]}
        onChange={setMode}
      />
      <button
        type="button"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-xs transition-[background-color,scale] duration-150 hover:bg-primary/85 active:scale-95"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause' : 'Play'}
        aria-keyshortcuts="Space"
        title="Play or pause (Space)"
      >
        {playing ? <PauseIcon className="size-4.5" /> : <PlayIcon className="ml-0.5 size-4.5" />}
      </button>
      <p className="min-w-27 shrink-0 font-mono text-sm whitespace-nowrap tabular-nums">
        {time.toFixed(2)}
        <span className="text-muted-foreground"> / {duration.toFixed(2)}s</span>
      </p>
      <Scrubber duration={duration} markers={markers} />
      {(project.musicUrl || cues.length > 0) && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={() => useEditor.setState({ muted: !muted })}
          aria-label={muted ? 'Unmute' : 'Mute'}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <SpeakerXMarkIcon /> : <SpeakerWaveIcon />}
        </Button>
      )}
    </div>
  );
}

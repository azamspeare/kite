import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
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
      className="scrubber"
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
        <svg className="scrub-wave" viewBox="0 0 240 100" preserveAspectRatio="none" aria-hidden>
          <path d={markers.wave} />
        </svg>
      )}
      <div className="scrub-markers" aria-hidden>
        {showBeats &&
          markers.beats.map((b, i) => <span key={i} className={`beat ${b.down ? 'down' : ''}`} style={{ left: pct(b.t) }} />)}
        {markers.phrases.map((p, i) => (
          <span key={`p${i}`} className="phrase" style={{ left: pct(p) }} title={`Phrase at ${p.toFixed(2)}s`} />
        ))}
      </div>
      <div className="scrub-track">
        <div className="scrub-fill" style={{ width: pct(time) }} />
        {markers.cuts.map((c) => (
          <span key={c.t} className="cut" style={{ left: pct(c.t) }} title={`${c.name} starts at ${c.t.toFixed(2)}s`} />
        ))}
      </div>
      <div className="scrub-sounds" aria-hidden>
        {markers.sounds.map((m, i) => (
          <span key={i} style={{ left: pct(m.t) }} />
        ))}
      </div>
      <div className="scrub-handle" style={{ left: pct(time) }} />
      {hover !== null && (
        <div className="scrub-hover" style={{ left: pct(hover) }}>
          <span>
            {hover.toFixed(2)}s{near.length > 0 && ` · ${near.slice(0, 3).join(', ')}${near.length > 3 ? '…' : ''}`}
          </span>
        </div>
      )}
      <div className="scrub-ticks" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
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
    <div className="transport">
      <Segmented
        value={mode}
        options={[
          ['scene', 'This scene'],
          ['whole', 'Whole video'],
        ]}
        onChange={setMode}
        className="segmented-dark"
      />
      <button
        className="play-btn"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause' : 'Play'}
        title="Play / pause (space)"
      >
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <div className="timecode">
        <span>{time.toFixed(2)}</span>
        <span className="dim"> / {duration.toFixed(2)}s</span>
      </div>
      <Scrubber duration={duration} markers={markers} />
      {(project.musicUrl || cues.length > 0) && (
        <button className="icon-btn" onClick={() => useEditor.setState({ muted: !muted })} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      )}
    </div>
  );
}

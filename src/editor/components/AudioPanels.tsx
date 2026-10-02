import { ArrowPathIcon, PlayIcon, PlusIcon, XMarkIcon } from '@heroicons/react/16/solid';
// Heroicons has no magnet or note of this kind, so these come from Hugeicons.
import { Magnet01Icon, MusicNote03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '../api';
import { previewAudio } from '../audio';
import { refreshProject, toast, toastError, totalDuration, useEditor } from '../store';
import { ISLAND_HEADER, Notice, Segmented, formatClock } from './ui';

const isAudioFile = (file: File) =>
  file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus|aiff?|caf)$/i.test(file.name);

export async function uploadMusicFile(file: File) {
  const project = useEditor.getState().project;
  if (!project) return;
  if (!isAudioFile(file)) {
    toast(`“${file.name}” doesn’t look like an audio file`, { tone: 'error' });
    return;
  }
  useEditor.setState({ musicStatus: 'analyzing', rail: 'soundtrack' });
  try {
    await api.uploadMusic(project.id, file);
    await refreshProject();
  } catch (e) {
    useEditor.setState({ musicStatus: 'error', musicError: (e as Error).message });
    toastError(e);
  }
}

/** Audio files dropped on (or picked in) the Sound effects panel join the project's sound-effect library. */
export async function uploadSoundFiles(files: File[]) {
  const project = useEditor.getState().project;
  if (!project) return;
  const audio = files.filter(isAudioFile);
  if (audio.length < files.length) toast('Only audio files can be added as sounds', { tone: 'error' });
  const added: string[] = [];
  for (const file of audio) {
    try {
      added.push((await api.uploadSound(project.id, file)).name);
    } catch (e) {
      toastError(e);
    }
  }
  if (!added.length) return;
  await refreshProject().catch(() => undefined);
  toast(
    `Added ${added.map((n) => `“${n}”`).join(', ')} to the sounds. Ask the agent to use ${added.length === 1 ? 'it' : 'them'}.`,
  );
}

/** Cue errors from the scenes, plus cues naming a sound the library doesn't have. */
export function useSoundProblems(): string[] {
  const sounds = useEditor((s) => s.project?.sounds);
  const report = useEditor((s) => s.soundCues);
  return useMemo(() => {
    const names = new Set(sounds?.map((s) => s.name));
    const missing = [...new Set(report.cues.map((cue) => cue.sound))].filter((name) => !names.has(name));
    return [...report.errors, ...missing.map((name) => `No sound called “${name}” (used by a cue)`)];
  }, [sounds, report]);
}

function MusicOverview() {
  const project = useEditor((s) => s.project)!;
  const a = project.musicAnalysis!;
  const start = project.music?.start ?? 0;
  const total = totalDuration(project);
  const n = 200;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= n; i++) {
    const v = a.waveform[Math.min(a.waveform.length - 1, Math.floor((i / n) * a.waveform.length))] ?? 0;
    top.push(`${i},${20 - 2 - v * 16}`);
    bottom.push(`${i},${20 + 2 + v * 16}`);
  }
  const x = (t: number) => (t / a.duration) * n;
  const setStart = async (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * a.duration;
    const nearest = a.downbeats.reduce((best, d) => (Math.abs(d - t) < Math.abs(best - t) ? d : best), a.downbeats[0] ?? t);
    try {
      await api.updateMusic(project.id, { start: Math.max(0, nearest) });
      await refreshProject();
      toast(`The video now starts ${nearest.toFixed(2)}s into the track`);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <svg
      className="h-18 w-full cursor-pointer rounded-lg bg-background fill-foreground/30 ring-1 ring-foreground/10"
      viewBox={`0 0 ${n} 40`}
      preserveAspectRatio="none"
      onClick={setStart}
    >
      <title>Click to start the video at the nearest bar</title>
      <rect
        className="fill-brand/25"
        x={x(start)}
        y={0}
        width={Math.max(0.5, x(Math.min(a.duration, start + total)) - x(start))}
        height={40}
      />
      <path d={`M${top.join(' L')} L${bottom.reverse().join(' L')} Z`} />
      {a.sections.slice(1).map((s) => (
        <line
          key={s.start}
          className="stroke-action [vector-effect:non-scaling-stroke]"
          strokeWidth={1}
          x1={x(s.start)}
          x2={x(s.start)}
          y1={0}
          y2={40}
        />
      ))}
    </svg>
  );
}

/** The header of an audio panel, lined up with the chat's. */
function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className={ISLAND_HEADER}>
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
      {children}
    </header>
  );
}

const HINT = 'text-xs/5 text-muted-foreground';
const BODY = 'flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 text-sm';

export function SoundtrackPanel() {
  const project = useEditor((s) => s.project)!;
  const status = useEditor((s) => s.musicStatus);
  const error = useEditor((s) => s.musicError);
  const input = useRef<HTMLInputElement>(null);
  const [grid, setGrid] = useState<'bar' | 'phrase' | 'beat'>('bar');
  const music = project.music;
  const a = project.musicAnalysis;

  const snap = async () => {
    try {
      const result = await api.snap(project.id, grid);
      await refreshProject();
      toast(
        `Snapped ${result.moved} cut${result.moved === 1 ? '' : 's'} to the ${grid} grid (max shift ${result.maxShift.toFixed(2)}s)`,
        {
          action: {
            label: 'Undo',
            run: () => void api.setDurations(project.id, result.before).then(refreshProject).catch(toastError),
          },
        },
      );
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <PanelHeader title="Soundtrack" />
      <div className={BODY}>
        {!music ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex items-start gap-3 rounded-xl border border-dashed border-foreground/20 p-4 text-left transition-colors duration-150 hover:border-action hover:bg-brand-8/50"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-8 text-action-text">
              <HugeiconsIcon icon={MusicNote03Icon} strokeWidth={1.5} className="size-5" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Add a soundtrack</span>
              <span className={HINT}>
                Drop an audio file anywhere or click here. Beats, bars and phrases are detected so cuts and animations can lock to
                the music.
              </span>
            </span>
          </button>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                <HugeiconsIcon icon={MusicNote03Icon} strokeWidth={1.5} className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium" title={music.file}>
                  {music.file}
                </span>
                {a && status === 'ready' && (
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {a.bpm.toFixed(1)} BPM · {a.beatsPerBar}/4 · {formatClock(a.duration)} ·{' '}
                    {a.sections.map((s) => s.label).join(' → ')}
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Analyze again"
                title="Analyze again"
                onClick={() => api.analyzeMusic(project.id).catch(toastError)}
              >
                <ArrowPathIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                aria-label="Remove the soundtrack"
                title="Remove the soundtrack"
                onClick={async () => {
                  if (!confirm('Remove the soundtrack from this project?')) return;
                  await api.removeMusic(project.id).catch(toastError);
                  await refreshProject();
                }}
              >
                <XMarkIcon />
              </Button>
            </div>
            {status === 'error' ? (
              <Notice tone="error">{error ?? 'The analysis failed. Analyze it again, or drop another file.'}</Notice>
            ) : !a || status === 'analyzing' ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-3.5" />
                Detecting beats, bars and phrases…
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <MusicOverview />
                  <p className={HINT}>
                    The highlighted part plays under the video. Click the waveform to start at the nearest bar.
                  </p>
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
                  <label htmlFor="music-start" className="text-muted-foreground">
                    Starts at
                  </label>
                  <span className="flex items-center gap-1.5">
                    <Input
                      id="music-start"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={music.start.toFixed(2)}
                      key={music.start}
                      className="w-24 font-mono tabular-nums"
                      onBlur={async (e) => {
                        const start = Number(e.currentTarget.value);
                        if (!Number.isFinite(start) || start === project.music?.start) return;
                        await api.updateMusic(project.id, { start }).catch(toastError);
                        await refreshProject();
                      }}
                    />
                    <span className="text-muted-foreground">s</span>
                  </span>
                  <label htmlFor="music-volume" className="text-muted-foreground">
                    Volume
                  </label>
                  <input
                    id="music-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    defaultValue={music.volume}
                    className="w-full accent-action"
                    onChange={(e) => {
                      const volume = Number(e.currentTarget.value);
                      void api.updateMusic(project.id, { volume }).then(refreshProject).catch(toastError);
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Segmented
                      size="sm"
                      label="Grid"
                      value={grid}
                      options={[
                        ['beat', 'Beats'],
                        ['bar', 'Bars'],
                        ['phrase', 'Phrases'],
                      ]}
                      onChange={setGrid}
                    />
                    <Button variant="outline" size="sm" onClick={snap} title="Move every cut to the nearest grid point">
                      <HugeiconsIcon icon={Magnet01Icon} strokeWidth={1.5} data-icon="inline-start" />
                      Snap cuts
                    </Button>
                  </div>
                  <p className={HINT}>Moves every cut between scenes to the nearest beat, bar or phrase.</p>
                </div>
              </>
            )}
            <p className={`${HINT} mt-auto text-center`}>Drop an audio file anywhere to replace the soundtrack.</p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadMusicFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </>
  );
}

export function SoundsPanel() {
  const project = useEditor((s) => s.project)!;
  const report = useEditor((s) => s.soundCues);
  const problems = useSoundProblems();
  const input = useRef<HTMLInputElement>(null);
  const uses = useMemo(() => {
    const map = new Map<string, number>();
    for (const cue of report.cues) map.set(cue.sound, (map.get(cue.sound) ?? 0) + 1);
    return map;
  }, [report]);
  const count = project.sounds.length;

  return (
    <>
      <PanelHeader title="Sound effects">
        {count > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {count} sound{count === 1 ? '' : 's'} · {report.cues.length} cue{report.cues.length === 1 ? '' : 's'}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} title="Add audio files as sound effects">
          <PlusIcon data-icon="inline-start" />
          Add
        </Button>
        <input
          ref={input}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void uploadSoundFiles(files);
          }}
        />
      </PanelHeader>
      <div className={BODY}>
        {problems.map((problem) => (
          <Notice key={problem} tone="warning">
            {problem}
          </Notice>
        ))}
        {count === 0 ? (
          <p className="text-muted-foreground">No sounds yet. Ask the agent for sound design, or drop audio files here.</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {project.sounds.map((sound) => {
              const used = uses.get(sound.name) ?? 0;
              return (
                <li
                  key={sound.name}
                  className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted"
                >
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="rounded-full text-muted-foreground hover:bg-background"
                    aria-label={`Play ${sound.name}`}
                    onClick={() => void previewAudio.play(sound.url).catch(toastError)}
                  >
                    <PlayIcon />
                  </Button>
                  <span className="truncate font-medium">{sound.name}</span>
                  <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {sound.source} · {sound.duration.toFixed(2)}s · {used ? `${used}×` : 'unused'}
                  </span>
                  <span className="col-start-2 col-end-4 truncate text-xs text-muted-foreground" title={sound.label}>
                    {sound.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {count > 0 && <p className={`${HINT} mt-auto text-center`}>Drop audio files here to add them.</p>}
      </div>
    </>
  );
}

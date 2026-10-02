import { ArrowDownTrayIcon, FilmIcon, FolderOpenIcon, TrashIcon } from '@heroicons/react/16/solid';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { FILE_MANAGER, revealFile } from '@/lib/files';
import type { RenderFile, RenderJob } from '../../shared/types';
import { api } from '../api';
import { refreshRenders, toastError, totalDuration, useEditor } from '../store';
import { Notice, Segmented, formatBytes } from './ui';

function JobProgress({ job }: { job: RenderJob }) {
  const fraction = job.framesTotal ? job.framesDone / job.framesTotal : 0;
  const elapsed = (Date.now() - job.startedAt) / 1000;
  const remaining = fraction > 0.02 ? Math.max(0, elapsed / fraction - elapsed) : null;
  const label =
    job.status === 'queued'
      ? 'Starting…'
      : job.status === 'encoding'
        ? 'Finishing the MP4…'
        : `Frame ${job.framesDone} of ${job.framesTotal}${remaining !== null ? ` · about ${Math.ceil(remaining)}s left` : ''}`;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-sm tabular-nums">
        <Spinner className="size-3.5 text-action-text" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Button variant="outline" size="sm" onClick={() => api.cancelRender(job.id).catch(toastError)}>
          Cancel
        </Button>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-action transition-[width] duration-200"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}

function RenderItem({ file }: { file: RenderFile }) {
  const project = useEditor((s) => s.project)!;
  const path = file.url.replace(/^\/@fs/, '');
  return (
    <li className="overflow-hidden rounded-xl bg-card shadow-card">
      {/* Black, not a token: the letterbox around the video is part of the picture. */}
      <video src={file.url} controls preload="metadata" className="block max-h-[60vh] w-full bg-black" />
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{file.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatBytes(file.size)} · {new Date(file.createdAt).toLocaleString()}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`Show in ${FILE_MANAGER}`}
          title={`Show in ${FILE_MANAGER}`}
          onClick={() => revealFile(path)}
        >
          <FolderOpenIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Download"
          title="Download"
          nativeButton={false}
          render={<a href={file.url} download={file.name} />}
        >
          <ArrowDownTrayIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
          aria-label="Delete this render"
          title="Delete this render"
          onClick={async () => {
            if (!confirm(`Delete ${file.name}?`)) return;
            await api.deleteRender(project.id, file.name).catch(toastError);
            await refreshRenders();
          }}
        >
          <TrashIcon />
        </Button>
      </div>
    </li>
  );
}

/** The Render view: one white card on the canvas, as the projects page, with the settings beside the renders so far. */
export function RenderView() {
  const project = useEditor((s) => s.project)!;
  const renders = useEditor((s) => s.renders);
  const [scale, setScale] = useState(1);
  const [fps, setFps] = useState(project.fps);
  const active = renders.jobs.find((j) => j.status === 'queued' || j.status === 'rendering' || j.status === 'encoding');
  const last = renders.jobs[0];
  const { width: w, height: h } = project;

  const start = async () => {
    try {
      await api.startRender(project.id, { scale, fps });
      await refreshRenders();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
      <div className="flex grow flex-col rounded-3xl bg-background p-6 shadow-xs ring-1 ring-foreground/5 lg:p-10">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
          <h1 className="text-xl/8 font-semibold">Render</h1>
          <p className="mt-1 max-w-prose text-sm/6 text-muted-foreground tabular-nums">
            {project.scenes.length} scene{project.scenes.length === 1 ? '' : 's'} · {totalDuration(project).toFixed(2)}s ·{' '}
            {project.music ? `with “${project.music.file}”` : 'no soundtrack'}
            {project.sounds.length > 0 && ' and sound effects'}
          </p>
          <Separator className="mt-6" />
          <div className="mt-8 grid items-start gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <section aria-labelledby="render-settings" className="flex flex-col gap-5 rounded-xl bg-card p-5 shadow-card">
              <h2 id="render-settings" className="font-heading text-base font-medium">
                Render video
              </h2>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Resolution</span>
                <Segmented
                  label="Resolution"
                  value={scale}
                  options={[
                    [0.5, `${Math.round(w / 2)}×${Math.round(h / 2)}`],
                    [1, `${w}×${h}`],
                    [2, `${w * 2}×${h * 2}`],
                  ]}
                  onChange={setScale}
                  className="self-start"
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Frame rate</span>
                <Segmented
                  label="Frame rate"
                  value={fps}
                  options={[
                    [24, '24 fps'],
                    [30, '30 fps'],
                    [60, '60 fps'],
                  ]}
                  onChange={setFps}
                  className="self-start"
                />
              </div>
              {active ? (
                <JobProgress job={active} />
              ) : (
                <Button catalyst color="action" size="lg" onClick={start} className="w-full">
                  <FilmIcon data-icon="inline-start" />
                  Render MP4
                </Button>
              )}
              {!active && last?.status === 'error' && <Notice tone="error">{last.error}</Notice>}
              {last?.warnings && last.warnings.length > 0 && (
                <Notice tone="warning">
                  Some sound cues were left out: {last.warnings.slice(0, 3).join(' · ')}
                  {last.warnings.length > 3 ? ` (+${last.warnings.length - 3} more)` : ''}
                </Notice>
              )}
              <p className="text-xs/5 text-muted-foreground">
                Every frame is rendered headlessly from the same scene code as the preview, then encoded to H.264 (BT.709) with
                the soundtrack and sound effects mixed in.
              </p>
            </section>
            <section aria-labelledby="render-list" className="flex min-w-0 flex-col gap-4">
              <h2 id="render-list" className="font-heading text-base font-medium">
                Renders
              </h2>
              {renders.files.length === 0 ? (
                <Empty className="rounded-xl border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FilmIcon />
                    </EmptyMedia>
                    <EmptyTitle>No renders yet</EmptyTitle>
                    <EmptyDescription>Each MP4 you render lands here and in the project's renders folder.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col gap-4">
                  {renders.files.map((f) => (
                    <RenderItem key={f.name} file={f} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

import { Download, Film, FolderOpen, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { RenderFile, RenderJob } from '../../shared/types';
import { api } from '../api';
import { refreshRenders, toastError, totalDuration, useEditor } from '../store';
import { FILE_MANAGER, revealFile } from './TopBar';
import { Segmented, formatBytes } from './ui';

function JobProgress({ job }: { job: RenderJob }) {
  const fraction = job.framesTotal ? job.framesDone / job.framesTotal : 0;
  const elapsed = (Date.now() - job.startedAt) / 1000;
  const remaining = fraction > 0.02 ? Math.max(0, elapsed / fraction - elapsed) : null;
  const label =
    job.status === 'queued'
      ? 'Starting…'
      : job.status === 'encoding'
        ? 'Finishing the MP4…'
        : `Frame ${job.framesDone} of ${job.framesTotal}${remaining !== null ? ` · ~${Math.ceil(remaining)}s left` : ''}`;
  return (
    <div className="job">
      <div className="job-row">
        <Loader2 size={14} className="spin" />
        <span>{label}</span>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => api.cancelRender(job.id).catch(toastError)}>
          Cancel
        </button>
      </div>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  );
}

function RenderItem({ file }: { file: RenderFile }) {
  const project = useEditor((s) => s.project)!;
  const path = file.url.replace(/^\/@fs/, '');
  return (
    <div className="render-item card">
      <video src={file.url} controls preload="metadata" />
      <div className="render-meta">
        <div className="render-name">{file.name}</div>
        <div className="dim">
          {formatBytes(file.size)} · {new Date(file.createdAt).toLocaleString()}
        </div>
        <div className="spacer" />
        <button className="icon-btn" title={`Show in ${FILE_MANAGER}`} onClick={() => revealFile(path)}>
          <FolderOpen size={16} />
        </button>
        <a className="icon-btn" href={file.url} download={file.name} title="Download">
          <Download size={16} />
        </a>
        <button
          className="icon-btn icon-danger"
          title="Delete this render"
          onClick={async () => {
            if (!confirm(`Delete ${file.name}?`)) return;
            await api.deleteRender(project.id, file.name).catch(toastError);
            await refreshRenders();
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

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
    <div className="render-view">
      <div className="render-panel card">
        <h2>Render video</h2>
        <p className="dim">
          {project.scenes.length} scene{project.scenes.length === 1 ? '' : 's'} · {totalDuration(project).toFixed(2)}s ·{' '}
          {project.music ? `with “${project.music.file}”` : 'no soundtrack'}
          {project.sounds.length > 0 && ' and sound effects'}
        </p>
        <div className="field">
          <span>Resolution</span>
          <Segmented
            value={scale}
            options={[
              [0.5, `${Math.round(w / 2)}×${Math.round(h / 2)}`],
              [1, `${w}×${h}`],
              [2, `${w * 2}×${h * 2}`],
            ]}
            onChange={setScale}
          />
        </div>
        <div className="field">
          <span>Frame rate</span>
          <Segmented
            value={fps}
            options={[
              [24, '24 fps'],
              [30, '30 fps'],
              [60, '60 fps'],
            ]}
            onChange={setFps}
          />
        </div>
        {active ? (
          <JobProgress job={active} />
        ) : (
          <button className="btn btn-primary btn-lg" onClick={start}>
            <Film size={16} /> Render MP4
          </button>
        )}
        {!active && last?.status === 'error' && <div className="notice notice-error">{last.error}</div>}
        {last?.warnings && last.warnings.length > 0 && (
          <div className="notice notice-warn">
            Some sound cues were left out: {last.warnings.slice(0, 3).join(' · ')}
            {last.warnings.length > 3 ? ` (+${last.warnings.length - 3} more)` : ''}
          </div>
        )}
        <p className="hint">
          Every frame is rendered headlessly from the same scene code as the preview, then encoded to H.264 (BT.709) with the
          soundtrack and sound effects mixed in.
        </p>
      </div>
      <div className="render-list">
        <h3>Renders</h3>
        {renders.files.length === 0 ? (
          <p className="dim">No renders yet.</p>
        ) : (
          renders.files.map((f) => <RenderItem key={f.name} file={f} />)
        )}
      </div>
    </div>
  );
}

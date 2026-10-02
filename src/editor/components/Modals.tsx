import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '../api';
import { loadProjects, openProject, refreshProject, toast, toastError, useEditor } from '../store';
import { Modal, Picker } from './ui';

const close = () => useEditor.setState({ modal: null });

export function ArtDirectionModal() {
  const project = useEditor((s) => s.project)!;
  const [text, setText] = useState(project.artDirection);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.setArtDirection(project.id, text);
      await refreshProject();
      toast('Art direction saved. The agent reads it before every edit.');
      close();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Art direction"
      onClose={close}
      wide
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            Saved as <code className="font-mono">art-direction.md</code> in the project folder.
          </span>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button catalyst onClick={save} disabled={saving}>
            Save art direction
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm/6 text-muted-foreground">
        The look every scene shares: palette, type scale, motion principles, layout rules. The agent reads this before every edit,
        in every scene.
      </p>
      <label htmlFor="art-direction" className="sr-only">
        Art direction
      </label>
      <Textarea
        id="art-direction"
        className="h-[52svh] resize-y font-mono text-[13px]/6 [field-sizing:fixed] md:text-[13px]/6"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
        }}
        spellCheck={false}
        autoFocus
      />
    </Modal>
  );
}

const FORMATS = [
  { label: 'Landscape 16:9 · 1920×1080', width: 1920, height: 1080 },
  { label: 'Square 1:1 · 1080×1080', width: 1080, height: 1080 },
  { label: 'Portrait 4:5 · 1080×1350', width: 1080, height: 1350 },
  { label: 'Vertical 9:16 · 1080×1920', width: 1080, height: 1920 },
];

const FRAME_RATES = [
  { value: 60, label: '60 fps · smoothest UI motion' },
  { value: 30, label: '30 fps' },
  { value: 24, label: '24 fps · filmic' },
];

export function NewProjectModal() {
  const [name, setName] = useState('');
  const [format, setFormat] = useState(0);
  const [fps, setFps] = useState(60);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const { width, height } = FORMATS[format];
      const project = await api.createProject({ name: name.trim() || 'Untitled', width, height, fps });
      await loadProjects();
      await openProject(project.id);
      useEditor.setState({ view: 'scenes', panel: 'project', rail: 'chat', mode: 'scene' });
      close();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New project"
      onClose={close}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button catalyst onClick={create} disabled={busy}>
            Create project
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="project-name" className="text-sm font-medium">
            Name
          </label>
          <Input
            id="project-name"
            autoFocus
            value={name}
            placeholder="Product teaser"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="project-format" className="text-sm font-medium">
            Format
          </label>
          <Picker
            id="project-format"
            label="Format"
            value={format}
            options={FORMATS.map((f, i) => ({ value: i, label: f.label }))}
            onChange={setFormat}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="project-fps" className="text-sm font-medium">
            Frame rate
          </label>
          <Picker id="project-fps" label="Frame rate" value={fps} options={FRAME_RATES} onChange={setFps} />
        </div>
      </div>
    </Modal>
  );
}

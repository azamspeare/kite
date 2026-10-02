import { useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { api } from '../api';
import { loadProjects, refreshProject } from '../store';

/**
 * The project's name in the navbar, editable in place: click it, type, then press Enter or click away
 * to save. Escape puts the saved name back. An emptied name is not saved.
 */
export function ProjectName({ id, name: saved }: { id: string; name: string }) {
  const [name, setName] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  // A rename from elsewhere (the agent, another tab) shows here unless the name is being edited.
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setName(saved);
  }

  async function save() {
    const next = name.trim().replace(/\s+/g, ' ');
    if (next === '' || next === saved) {
      setName(saved);
      setError(null);
      return;
    }
    try {
      await api.updateProject(id, { name: next });
      setError(null);
      await Promise.all([refreshProject(), loadProjects()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The project could not be renamed.');
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      setName(saved);
      setError(null);
      // The reset name is not in the input yet when blur runs, so blur must not save.
      event.currentTarget.dataset.cancelled = 'true';
      event.currentTarget.blur();
    }
  }

  return (
    <>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          if (event.currentTarget.dataset.cancelled) {
            delete event.currentTarget.dataset.cancelled;
            return;
          }
          void save();
        }}
        onKeyDown={onKeyDown}
        aria-label="Project name"
        aria-invalid={error ? true : undefined}
        title={name}
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        // Looks like plain text, focused or not: no box, border or ring, and as wide as the name it holds.
        // The caret and the selected name are what show it is being edited.
        className="field-sizing-content h-auto w-auto max-w-full min-w-4 truncate rounded-none border-0 p-0 font-medium focus-visible:ring-0 aria-invalid:ring-0 md:text-sm"
      />
      {error && (
        <span role="alert" className="shrink-0 text-sm text-destructive-foreground">
          {error}
        </span>
      )}
    </>
  );
}

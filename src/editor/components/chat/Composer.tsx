import { ArrowUpIcon, PlusIcon, StopIcon } from '@heroicons/react/16/solid';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { posterTime } from '@/lib/scenes';
import { cn } from '@/lib/utils';
import { modelSelection, type AgentProviderId } from '../../../shared/agents';
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  attachmentKind,
  maxBytes,
  mentionedScenes,
  toolsFor,
  type AttachmentKind,
  type ChatToolId,
} from '../../../shared/chatOptions';
import type { Attachment } from '../../../shared/types';
import { insertMention, mentionQuery, readDraft, slashQuery, writeDraft } from '../../lib/composer';
import { api } from '../../api';
import { currentAgent, currentScene, setEffort, setModel, setProvider, toastError, useEditor } from '../../store';
import { FrameView } from '../FrameView';
import { Picker } from '../ui';
import { AttachmentCard } from './AttachmentCard';
import { withMentions } from './mentions';
import { TOOL_ICONS, ToolMark } from './ToolMark';

/** How the send shortcut is written on this computer. */
const SEND_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ Enter' : 'Ctrl Enter';

const ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

const MB = 1024 * 1024;

/** A file in the box. `attachment` is null until its upload has finished. */
interface ComposerFile {
  key: string;
  name: string;
  kind: AttachmentKind;
  /** For an image: a local preview while it uploads, then the stored file. */
  src: string | null;
  attachment: Attachment | null;
}

/** Where the editor loads an attached file from: the project's assets/ folder, served like scene assets. */
export function attachmentUrl(projectDir: string, id: string): string {
  return `/@fs${projectDir}/assets/${encodeURIComponent(id)}`;
}

function toComposerFile(projectDir: string, attachment: Attachment): ComposerFile {
  return {
    key: attachment.id,
    name: attachment.name,
    kind: attachment.kind,
    src: attachmentUrl(projectDir, attachment.id),
    attachment,
  };
}

/** Files dropped on the composer (the app routes drops on it here), handed to whichever composer is open. */
const dropTargets = new Set<(files: File[]) => void>();

export function attachToComposer(files: File[]): boolean {
  dropTargets.forEach((add) => add(files));
  return dropTargets.size > 0;
}

/**
 * The box a message is written in (Rika's composer): a rounded card with any attached files on top, the
 * text, and under it the "+" button, the agent, model and effort, and one round send button (Stop while a
 * reply is being written). "/" as the whole input lists the tools; "@" lists the scenes to mention.
 * Enter starts a new line; Command+Enter (Control+Enter) sends. An unsent draft survives a reload.
 */
export function Composer({ scopeKey, busy, fill }: { scopeKey: string; busy: boolean; fill: string | null }) {
  const project = useEditor((s) => s.project)!;
  const onStage = useEditor((s) => currentScene(s)?.id);
  const agent = useEditor(currentAgent);
  const agents = useEditor((s) => s.info?.agents);
  const savedModel = useEditor((s) => s.model);
  const savedEffort = useEditor((s) => s.effort);
  const { model, effort, efforts } = agent
    ? modelSelection(agent, savedModel, savedEffort)
    : { model: '', effort: '', efforts: [] };
  const chat = scopeKey === '_project' ? 'project' : 'scene';
  const tools = toolsFor(chat);
  const draftKey = `kite:draft:${project.id}/${scopeKey}`;

  const [initial] = useState(() => readDraft(sessionStorage.getItem(draftKey)));
  const [text, setText] = useState(initial.text);
  const [tool, setTool] = useState<ChatToolId | null>(
    initial.tool && tools.some((t) => t.id === initial.tool) ? initial.tool : null,
  );
  const [files, setFiles] = useState<ComposerFile[]>(() => initial.files.map((f) => toComposerFile(project.dir, f)));
  const [caret, setCaret] = useState(initial.text.length);
  const [highlight, setHighlight] = useState({ key: '', index: 0 });
  /** The query the user closed with Escape; it stays closed until the query changes. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const caretAfterInsert = useRef<number | null>(null);
  const listId = useId();

  // Keep the draft (finished uploads only) for a reload.
  useEffect(() => {
    const saved = writeDraft({ text, tool, files: files.flatMap((f) => (f.attachment ? [f.attachment] : [])) });
    try {
      if (saved) sessionStorage.setItem(draftKey, saved);
      else sessionStorage.removeItem(draftKey);
    } catch {
      // Storage unavailable: the draft just doesn't survive a reload.
    }
  }, [draftKey, text, tool, files]);

  useEffect(() => {
    if (fill) {
      setText(fill);
      setCaret(fill.length);
      area.current?.focus();
    }
  }, [fill]);

  // After a mention is written in, the caret goes right after it.
  useLayoutEffect(() => {
    if (caretAfterInsert.current !== null && area.current) {
      area.current.setSelectionRange(caretAfterInsert.current, caretAfterInsert.current);
      caretAfterInsert.current = null;
    }
  }, [text]);

  // What the lists show is derived from the text and the caret on each render.
  const slash = slashQuery(text, tool);
  const toolMatches = slash === null ? [] : tools.filter((t) => t.name.toLowerCase().startsWith(slash));
  const beforeCaret = text.slice(0, caret);
  const mention = slash === null ? mentionQuery(beforeCaret) : null;
  const sceneMatches =
    mention && 'scene'.startsWith(mention.word.toLowerCase())
      ? project.scenes.filter((s) => String(s.index + 1).startsWith(mention.digits))
      : [];
  const queryKey = slash !== null ? `/${slash}` : mention ? `${beforeCaret.length}@${mention.word}${mention.digits}` : null;
  const open =
    queryKey === null || dismissed === queryKey ? null : toolMatches.length ? 'tools' : sceneMatches.length ? 'scenes' : null;
  const rows = open === 'tools' ? toolMatches.length : open === 'scenes' ? sceneMatches.length : 0;
  const active = highlight.key === queryKey ? Math.min(highlight.index, Math.max(0, rows - 1)) : 0;

  const uploading = files.some((f) => !f.attachment);
  const canSend = Boolean(agent) && !uploading && (text.trim().length > 0 || files.length > 0) && open === null;

  function chooseTool(id: ChatToolId) {
    setTool(id);
    setText('');
    setCaret(0);
    area.current?.focus();
  }

  function chooseScene(n: number) {
    const next = insertMention(text, caret, n);
    caretAfterInsert.current = next.caret;
    setText(next.text);
    setCaret(next.caret);
    area.current?.focus();
  }

  function addFiles(list: File[]) {
    let problem: string | null = null;
    const room = MAX_ATTACHMENTS - files.length;
    const accepted: { file: File; entry: ComposerFile }[] = [];
    for (const file of list) {
      const kind = attachmentKind(file.name);
      if (!kind) problem = `“${file.name}” isn't an image or audio file.`;
      else if (file.size === 0) problem = `“${file.name}” is empty.`;
      else if (file.size > maxBytes(kind))
        problem = `“${file.name}” is too large: ${kind === 'image' ? 'images' : 'audio files'} can be up to ${maxBytes(kind) / MB} MB.`;
      else if (accepted.length >= room) problem = `A message can carry ${MAX_ATTACHMENTS} files.`;
      else {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        accepted.push({
          file,
          entry: { key, name: file.name, kind, src: kind === 'image' ? URL.createObjectURL(file) : null, attachment: null },
        });
      }
    }
    setNotice(problem);
    if (!accepted.length) return;
    setFiles((current) => [...current, ...accepted.map((a) => a.entry)]);
    for (const { file, entry } of accepted) {
      api
        .uploadAttachment(project.id, file)
        .then((attachment) =>
          setFiles((current) => current.map((f) => (f.key === entry.key ? toComposerFile(project.dir, attachment) : f))),
        )
        .catch((e: Error) => {
          setFiles((current) => current.filter((f) => f.key !== entry.key));
          setNotice(e.message);
        })
        .finally(() => {
          if (entry.src) URL.revokeObjectURL(entry.src);
        });
    }
  }

  // Files dropped on the composer arrive from the app's drop handler.
  const addRef = useRef(addFiles);
  addRef.current = addFiles;
  useEffect(() => {
    const add = (list: File[]) => addRef.current(list);
    dropTargets.add(add);
    return () => void dropTargets.delete(add);
  }, []);

  function removeFile(key: string) {
    setFiles((current) => current.filter((f) => f.key !== key));
    setNotice(null);
  }

  async function send() {
    if (busy || !agent || !canSend) return;
    const s = useEditor.getState();
    const scene = currentScene(s);
    let playhead: number | undefined;
    if (scopeKey === '_project') playhead = s.mode === 'whole' ? s.time : (scene?.start ?? 0) + s.time;
    else if (scene) playhead = s.mode === 'scene' ? s.time : Math.max(0, Math.min(scene.duration, s.time - scene.start));
    const sent = { text, files };
    setText('');
    setCaret(0);
    setFiles([]);
    setNotice(null);
    try {
      await api.send(project.id, scopeKey, {
        text: sent.text.trim(),
        playhead,
        provider: agent.id,
        effort,
        model,
        tool,
        files: sent.files.flatMap((f) => (f.attachment ? [f.attachment.id] : [])),
        scenes: mentionedScenes(
          sent.text,
          project.scenes.map((x) => x.id),
        ),
      });
    } catch (e) {
      setText(sent.text);
      // A file from a saved draft can be gone from assets/; sending again would fail the same way.
      const missing = e instanceof Error && /attached file is missing/i.test(e.message);
      setFiles(missing ? [] : sent.files);
      if (missing) setNotice('An attached file is missing, so the files were removed. Attach them again.');
      else toastError(e);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open !== null && rows > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setHighlight({ key: queryKey ?? '', index: (active + step + rows) % rows });
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === 'Tab') {
        event.preventDefault();
        if (open === 'tools') chooseTool(toolMatches[active].id);
        else chooseScene(sceneMatches[active].index + 1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(queryKey);
        return;
      }
    }
    const atStart = event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0;
    if (tool && ((event.key === 'Backspace' && atStart) || (event.key === 'Delete' && text === ''))) {
      event.preventDefault();
      setTool(null);
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    // Office and Keynote put a picture of copied text next to the text itself (plain and HTML): that paste
    // is text. A copied image (HTML only) or a file from Finder (plain text: its name) still attaches.
    const types = event.clipboardData.types;
    if (types.includes('text/html') && types.includes('text/plain')) return;
    const pasted = [...event.clipboardData.items].flatMap((item) => {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      return file ? [file] : [];
    });
    if (pasted.length === 0) return;
    event.preventDefault();
    addFiles(pasted);
  }

  const placeholder =
    tools.find((t) => t.id === tool)?.placeholder ??
    (scopeKey === '_project'
      ? 'Ask about the whole video… / for tools, @ for scenes'
      : 'What should change? / for tools, @ for scenes');

  const rowClass = (index: number) =>
    cn('flex cursor-default items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm select-none', index === active && 'bg-accent');

  return (
    <form className="relative shrink-0 p-2 pt-0" data-drop="composer" onSubmit={onSubmit}>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={open === 'tools' ? 'Tools' : 'Scenes'}
          className="absolute inset-x-2 bottom-full z-20 mb-2 max-h-72 origin-bottom animate-in overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-150 ease-out fade-in-0 zoom-in-95"
        >
          {open === 'tools'
            ? toolMatches.map((entry, index) => {
                const Icon = TOOL_ICONS[entry.id];
                return (
                  <div
                    key={entry.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    // A mousedown would take focus from the box and close the list before the click lands.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setHighlight({ key: queryKey ?? '', index })}
                    onClick={() => chooseTool(entry.id)}
                    className={rowClass(index)}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-8 text-action-text">
                      <Icon aria-hidden="true" className="size-3.5" />
                    </span>
                    <span className="font-medium">{entry.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{entry.placeholder}</span>
                  </div>
                );
              })
            : sceneMatches.map((scene, index) => (
                <div
                  key={scene.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // Keeps the highlighted row in view when the arrows move past the edge of the list.
                  ref={index === active ? (row) => row?.scrollIntoView({ block: 'nearest' }) : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setHighlight({ key: queryKey ?? '', index })}
                  onClick={() => chooseScene(scene.index + 1)}
                  className={cn(rowClass(index), 'gap-3')}
                >
                  <span
                    className="relative h-9 shrink-0 overflow-hidden rounded-sm bg-white ring-1 ring-foreground/10"
                    style={{ aspectRatio: `${project.width} / ${project.height}` }}
                  >
                    <FrameView
                      projectId={project.id}
                      sceneId={scene.id}
                      mode="thumb"
                      time={posterTime(scene.duration)}
                      className="pointer-events-none absolute inset-0 size-full border-0"
                    />
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">Scene {scene.index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{scene.name}</span>
                  {scene.id === onStage && <span className="shrink-0 text-xs text-muted-foreground">On the stage</span>}
                </div>
              ))}
        </div>
      )}

      <div
        className="flex cursor-text flex-col rounded-3xl border border-input bg-background shadow-xs transition-colors focus-within:border-ring"
        onClick={(e) => {
          // Clicking the card's padding puts the caret in the box, as in Rika.
          if (e.target === e.currentTarget) area.current?.focus();
        }}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2.5 pt-2.5">
            {files.map((f) => (
              <AttachmentCard
                key={f.key}
                name={f.name}
                kind={f.kind}
                src={f.src}
                duration={f.attachment?.duration}
                uploading={!f.attachment}
                onRemove={() => removeFile(f.key)}
              />
            ))}
          </div>
        )}
        {/* The chosen tool sits at the start of the line, so the text carries on right after it. */}
        <div className="flex w-full items-start gap-1.5 px-4 pt-3">
          {tool && <ToolMark tool={tool} className="shrink-0 text-sm/6" />}
          {/*
            A textarea cannot colour part of its text, so its own text is invisible and an identical copy
            with each scene mention marked is drawn over it (Rika's composer). The copy wraps exactly as the
            box does: same font, size, line height and width, and no scrollbar taking width. It sits above
            the box so selected text is highlighted under the letters; clicks pass through it.
          */}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <div
              ref={mirror}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 text-sm/6 wrap-break-word whitespace-pre-wrap"
            >
              {/* The extra weight is a stroke around the same letters: a heavier font would be wider. */}
              {withMentions(text, project.scenes.length, 'text-action-text [-webkit-text-stroke:0.4px]')}
              {'​'}
            </div>
            <label htmlFor="composer-input" className="sr-only">
              Message
            </label>
            <textarea
              id="composer-input"
              ref={area}
              value={text}
              rows={3}
              maxLength={20000}
              placeholder={placeholder}
              aria-autocomplete="list"
              aria-controls={open ? listId : undefined}
              aria-activedescendant={open ? `${listId}-${active}` : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart);
                setDismissed(null);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={(e) => {
                if (mirror.current) mirror.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
              }}
              className="block max-h-56 min-h-18 w-full resize-none bg-transparent p-0 text-sm/6 text-transparent caret-foreground outline-none [field-sizing:content] [scrollbar-width:none] placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="flex items-center gap-0.5 px-2 pt-1 pb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Attach images or audio"
            title="Attach images or audio"
            disabled={files.length >= MAX_ATTACHMENTS}
            onClick={() => fileInput.current?.click()}
            className="mr-0.5 shrink-0 rounded-full text-muted-foreground"
          >
            <PlusIcon />
          </Button>
          <Picker
            quiet
            side="top"
            label="Agent"
            title="Agent"
            value={agent?.id ?? ''}
            disabled={busy || !agents?.length}
            options={(agents ?? []).map((a) => ({ value: a.id, label: a.label }))}
            onChange={(id) => setProvider(id as AgentProviderId)}
          />
          <Picker
            quiet
            side="top"
            label="Model"
            title="Model"
            value={model}
            options={(agent?.models ?? []).map((m) => ({ value: m.id, label: m.label }))}
            onChange={setModel}
          />
          <Picker
            quiet
            side="top"
            label="Effort"
            title="Effort: how much the agent thinks before and while editing"
            value={effort}
            options={efforts.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))}
            onChange={setEffort}
          />
          {/* While a reply is on its way the button is Stop, so it stays enabled even with an empty box. */}
          {busy ? (
            <Button
              type="button"
              size="icon-sm"
              aria-label="Stop"
              title="Stop the agent"
              onClick={() => api.stop(project.id, scopeKey).catch(toastError)}
              className="ml-auto shrink-0 rounded-full bg-action text-white hover:bg-action/90"
            >
              <StopIcon />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Send message"
              aria-keyshortcuts="Meta+Enter Control+Enter"
              title={uploading ? 'Wait for the files to finish uploading' : `Send (${SEND_SHORTCUT})`}
              // Parked while a list is open: Enter belongs to the list there.
              disabled={!canSend}
              className="ml-auto shrink-0 rounded-full bg-action text-white hover:bg-action/90"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
      {/* Under the box, where a field's error belongs. */}
      {notice && (
        <p role="alert" className="px-2 pt-1.5 text-sm text-destructive-foreground">
          {notice}
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        aria-label="Attach images or audio"
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])]);
          // Cleared so choosing the same file again still counts as a change.
          e.target.value = '';
        }}
      />
    </form>
  );
}

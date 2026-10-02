import { ArrowUpIcon, CheckIcon, ChevronRightIcon, ExclamationTriangleIcon, StopIcon } from '@heroicons/react/16/solid';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { ChatMessage, ChatStep } from '../../shared/types';
import { modelSelection, type AgentProviderId } from '../../shared/agents';
import { api } from '../api';
import { chatKey, currentAgent, currentScene, loadChat, setEffort, setModel, setProvider, toastError, useEditor } from '../store';
import { Shimmer } from './ai/Shimmer';
import { KiteMark } from './Logo';
import { Modal, Notice, Picker, RichText } from './ui';

const SCENE_IDEAS = [
  'Hold on the headline a full second longer, then slide the card in from the right.',
  'Make the entrance snappier and land the card exactly on the next downbeat.',
  'Match the first frame to the last frame of the previous scene so the cut is invisible.',
];

const PROJECT_IDEAS = [
  'Add a closing scene with the logo and a one-line tagline.',
  'Tighten the pacing: every scene should end on a bar line.',
  'Check every cut and fix the ones that jump.',
];

/** How the send shortcut is written on this computer. */
const SEND_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ Enter' : 'Ctrl Enter';

function useElapsed(since: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}

/** The agent's mark, at the start of each of its turns. */
function AgentTile() {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-8 text-action-text"
    >
      <KiteMark className="size-4" />
    </span>
  );
}

/**
 * A step inside a reply: one line, shimmering while it runs, check-marked once it has finished. A step
 * with details opens to show them.
 */
function Step({ step }: { step: Extract<ChatStep, { kind: 'tool' }> }) {
  const running = step.status === 'running';
  const label = (
    <>
      <span className={cn('min-w-0 truncate', step.status === 'error' && 'text-destructive-foreground')}>
        {running ? <Shimmer>{step.label}</Shimmer> : step.label}
      </span>
      <span className="flex w-4 shrink-0 items-center justify-end">
        {step.status === 'done' && (
          <CheckIcon
            aria-hidden="true"
            className="size-3.5 animate-in text-success-foreground duration-200 fade-in-0 zoom-in-90"
          />
        )}
        {step.status === 'error' && (
          <ExclamationTriangleIcon aria-label="Failed" className="size-3.5 text-destructive-foreground" />
        )}
      </span>
    </>
  );
  if (!step.detail)
    return (
      <li className="flex max-w-full items-center gap-2 text-sm text-muted-foreground">
        {/* Where a step with details has its chevron, so every label starts on the same line. */}
        <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
          <span className="size-1 rounded-full bg-current opacity-60" />
        </span>
        {label}
      </li>
    );
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group/trigger flex max-w-full items-center gap-2 rounded-md text-left text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground">
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform duration-200 ease-out group-data-panel-open/trigger:rotate-90"
          />
          {label}
        </CollapsibleTrigger>
        <CollapsibleContent>
          {/* The fade is on this inner box, not the panel: Base UI measures the panel and warns if it is animated twice. */}
          <pre className="mt-2 max-h-40 animate-in overflow-auto rounded-xl bg-muted/60 px-3.5 py-2.5 font-mono text-xs/5 whitespace-pre-wrap text-foreground/80 duration-150 ease-out fade-in-0">
            {step.detail}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function Steps({ steps }: { steps: ChatStep[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, i) =>
        step.kind === 'note' ? (
          <li key={i} className="pl-5.5 text-sm text-muted-foreground italic">
            {step.text}
          </li>
        ) : (
          <Step key={step.id} step={step} />
        ),
      )}
    </ol>
  );
}

function FrameStrip({ images, onOpen }: { images: string[]; onOpen: (index: number) => void }) {
  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5">
      {images.map((src, i) => (
        <button
          key={src}
          type="button"
          onClick={() => onOpen(i)}
          title="A frame the agent looked at"
          className="shrink-0 overflow-hidden rounded-lg bg-white shadow-xs ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/25"
        >
          <img src={src} alt="" loading="lazy" className="block h-auto w-26" />
        </button>
      ))}
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const running = message.status === 'running';
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const steps = message.steps ?? [];
  const tools = steps.filter((s) => s.kind === 'tool');
  const images = steps.flatMap((s) => (s.kind === 'tool' ? (s.images ?? []) : []));
  const elapsed = useElapsed(running ? message.createdAt : null);
  const expanded = running || open;
  const stepCount = `${tools.length} step${tools.length === 1 ? '' : 's'}`;

  return (
    <div className="flex animate-in gap-3 duration-150 ease-out fade-in-0 slide-in-from-bottom-1">
      <AgentTile />
      {/* What it did and what it said, in that order. */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-3 pt-0.5', message.undone && 'opacity-55')}>
        {steps.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {!running && (
              <button
                type="button"
                onClick={() => setOpen(!expanded)}
                aria-expanded={expanded}
                className="group/toggle flex items-center gap-2 self-start rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRightIcon
                  aria-hidden="true"
                  className={cn('size-3.5 transition-transform duration-200 ease-out', expanded && 'rotate-90')}
                />
                {stepCount}
                {!expanded && images.length > 0 && ` · ${images.length} frame${images.length === 1 ? '' : 's'} checked`}
              </button>
            )}
            {expanded && <Steps steps={steps} />}
          </div>
        )}
        {images.length > 0 && (
          <FrameStrip images={images.slice(-6)} onOpen={(i) => setViewer(images.length - Math.min(6, images.length) + i)} />
        )}
        {message.text && (
          <div className="text-sm/6">
            <RichText text={message.text} />
          </div>
        )}
        {running && !message.text && (
          <p className="flex items-center gap-2 text-sm tabular-nums">
            <Spinner aria-hidden="true" role={undefined} className="size-3.5 shrink-0 text-action-text" />
            <Shimmer>{`Working… ${elapsed}s`}</Shimmer>
          </p>
        )}
        {message.error && <p className="text-sm whitespace-pre-wrap text-destructive-foreground">{message.error}</p>}
        {!running && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {message.provider && `${message.provider === 'codex' ? 'Codex' : 'Claude Code'} · `}
            {message.durationMs !== undefined && `${Math.max(1, Math.round(message.durationMs / 1000))}s`}
            {message.status === 'stopped' && ' · stopped'}
            {message.undone && ' · undone'}
          </p>
        )}
      </div>
      {viewer !== null && (
        <Modal
          title="A frame the agent looked at"
          onClose={() => setViewer(null)}
          wide
          footer={
            images.length > 1 ? (
              <>
                <span className="mr-auto text-sm text-muted-foreground tabular-nums">
                  {viewer + 1} of {images.length}
                </span>
                <Button variant="outline" disabled={viewer === 0} onClick={() => setViewer(viewer - 1)}>
                  Previous
                </Button>
                <Button variant="outline" disabled={viewer === images.length - 1} onClick={() => setViewer(viewer + 1)}>
                  Next
                </Button>
              </>
            ) : undefined
          }
        >
          <img
            className="mx-auto block max-h-[70svh] max-w-full rounded-lg object-contain ring-1 ring-foreground/10"
            src={images[viewer]}
            alt=""
          />
        </Modal>
      )}
    </div>
  );
}

/** Your turn: a grey bubble on the right, with where the playhead was when you sent it. */
function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="ml-auto flex max-w-[85%] animate-in flex-col items-end gap-1 duration-150 ease-out fade-in-0 slide-in-from-bottom-1">
      <div className="rounded-3xl bg-muted px-4 py-2 text-sm/6 wrap-anywhere whitespace-pre-wrap">{message.text}</div>
      {message.playhead !== undefined && (
        <p className="px-2 text-xs text-muted-foreground tabular-nums">at {message.playhead.toFixed(2)}s</p>
      )}
    </div>
  );
}

/**
 * The box a message is written in (Rika's composer): a rounded card with the text on top and, under it,
 * the agent, model and effort on the left and one round send button on the right, which is Stop while
 * a reply is being written. Enter starts a new line; Command+Enter (Control+Enter) sends.
 */
function Composer({ scopeKey, busy, fill }: { scopeKey: string; busy: boolean; fill: string | null }) {
  const project = useEditor((s) => s.project)!;
  const agent = useEditor(currentAgent);
  const agents = useEditor((s) => s.info?.agents);
  const savedModel = useEditor((s) => s.model);
  const savedEffort = useEditor((s) => s.effort);
  const { model, effort, efforts } = agent
    ? modelSelection(agent, savedModel, savedEffort)
    : { model: '', effort: '', efforts: [] };
  const draftKey = `kite:draft:${project.id}/${scopeKey}`;
  const [text, setText] = useState(() => sessionStorage.getItem(draftKey) ?? '');
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => sessionStorage.setItem(draftKey, text), [draftKey, text]);
  useEffect(() => {
    if (fill) {
      setText(fill);
      area.current?.focus();
    }
  }, [fill]);

  const send = async () => {
    const value = text.trim();
    if (!value || busy || !agent) return;
    const s = useEditor.getState();
    const scene = currentScene(s);
    let playhead: number | undefined;
    if (scopeKey === '_project') playhead = s.mode === 'whole' ? s.time : (scene?.start ?? 0) + s.time;
    else if (scene) playhead = s.mode === 'scene' ? s.time : Math.max(0, Math.min(scene.duration, s.time - scene.start));
    setText('');
    try {
      await api.send(project.id, scopeKey, { text: value, playhead, provider: agent.id, effort, model });
    } catch (e) {
      setText(value);
      toastError(e);
    }
  };

  return (
    <form
      className="shrink-0 p-2 pt-0"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div
        className="flex cursor-text flex-col rounded-3xl border border-input bg-background shadow-xs transition-colors focus-within:border-ring"
        onClick={(e) => {
          // Clicking the card's padding puts the caret in the box, as in Rika.
          if (e.target === e.currentTarget) area.current?.focus();
        }}
      >
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <textarea
          id="composer-input"
          ref={area}
          value={text}
          rows={3}
          maxLength={20000}
          placeholder={
            scopeKey === '_project'
              ? 'Ask about the whole video, e.g. "Add a scene after Anatomy that shows every color variant."'
              : 'What should change? e.g. "Hold on the headline a full second longer, then slide the card in from the right."'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          className="block max-h-56 min-h-18 w-full resize-none bg-transparent px-4 pt-3 text-sm/6 outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-0.5 px-2 pt-1 pb-2">
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
              title={`Send (${SEND_SHORTCUT})`}
              disabled={!text.trim() || !agent}
              className="ml-auto shrink-0 rounded-full bg-action text-white hover:bg-action/90"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

export function Chat({ scopeKey }: { scopeKey: string }) {
  const project = useEditor((s) => s.project)!;
  const key = chatKey(project.id, scopeKey);
  const chat = useEditor((s) => s.chats[key]);
  const provider = useEditor(currentAgent);
  const list = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [fill, setFill] = useState<string | null>(null);

  useEffect(() => {
    if (!chat?.loaded) loadChat(project.id, scopeKey).catch(toastError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages]);

  // Stay pinned to the bottom while content grows (streaming text, frame thumbnails loading).
  useEffect(() => {
    const el = list.current;
    const content = inner.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const messages = chat?.messages ?? [];
  const ideas = scopeKey === '_project' ? PROJECT_IDEAS : SCENE_IDEAS;
  const busy = chat?.busy ?? false;
  const last = messages.at(-1);

  return (
    <div className="flex min-h-52 flex-1 flex-col">
      {/* Announces a reply's progress to screen readers; the text itself is not read out word by word. */}
      <div role="status" className="sr-only">
        {busy ? 'The agent is working…' : last?.role === 'assistant' ? 'The agent replied.' : null}
      </div>
      <div
        role="log"
        className="min-h-0 flex-1 overflow-y-auto"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        <div className="flex min-h-full flex-col gap-6 p-4" ref={inner}>
          {provider && !provider.ok && <Notice tone="error">{provider.detail}</Notice>}
          {chat?.loaded && messages.length === 0 && (
            <div className="my-auto flex flex-col gap-4">
              <Empty className="flex-none p-0 md:p-0">
                <EmptyHeader>
                  <EmptyTitle>{scopeKey === '_project' ? 'What should the video do?' : 'What should change?'}</EmptyTitle>
                  <EmptyDescription>
                    {scopeKey === '_project'
                      ? 'Talk about the video as a whole: structure, pacing, new scenes, consistency.'
                      : 'Describe a change to this scene. The agent edits the code, renders frames to check its work, and the preview updates live.'}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
              <ul className="flex flex-col gap-2">
                {ideas.map((idea) => (
                  <li key={idea}>
                    <button
                      type="button"
                      onClick={() => setFill(idea)}
                      className="w-full rounded-xl px-3.5 py-2.5 text-left text-sm/5 text-foreground/80 ring-1 ring-foreground/10 transition-colors duration-150 hover:bg-muted hover:text-foreground"
                    >
                      {idea}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!chat?.loaded && (
            <div className="my-auto flex justify-center text-muted-foreground">
              <Spinner />
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? <UserMessage key={m.id} message={m} /> : <AssistantMessage key={m.id} message={m} />,
          )}
        </div>
      </div>
      <Composer scopeKey={scopeKey} busy={busy} fill={fill} />
    </div>
  );
}

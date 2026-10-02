import { Fragment, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** A white panel on the grey canvas. Each part of the editor is one (DESIGN.md, "Layout"). */
export const ISLAND = 'rounded-3xl bg-background shadow-xs ring-1 ring-foreground/5';

/** The 48px bar at the top of an island. The stage's and the side panel's line up across the row. */
export const ISLAND_HEADER = 'flex h-12 shrink-0 items-center gap-3 border-b pr-3 pl-4';

/** A small group of tabs on a `muted` track; the chosen one is a white pill. */
export function Segmented<T extends string | number>(props: {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={props.label}
      className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5', props.className)}
    >
      {props.options.map(([value, label]) => {
        const active = props.value === value;
        return (
          <button
            key={String(value)}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => props.onChange(value)}
            className={cn(
              'rounded-md px-2.5 font-medium whitespace-nowrap tabular-nums transition-colors duration-150',
              props.size === 'sm' ? 'h-6 text-xs' : 'h-7 text-sm',
              active
                ? 'bg-background text-foreground shadow-xs ring-1 ring-foreground/5'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A shadcn select over a list of options. `quiet` draws the trigger with no border until hovered, for
 * the settings under the chat composer (Rika's model picker).
 */
export function Picker<T extends string | number>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  quiet?: boolean;
  side?: 'top' | 'bottom';
  id?: string;
  className?: string;
  title?: string;
}) {
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        const option = props.options.find((o) => o.value === value);
        if (option) props.onChange(option.value);
      }}
    >
      <SelectTrigger
        id={props.id}
        size={props.quiet ? 'sm' : 'default'}
        aria-label={props.label}
        title={props.title}
        className={cn(
          props.quiet ? 'max-w-40 border-transparent font-normal text-muted-foreground hover:bg-muted' : 'w-full',
          props.className,
        )}
      >
        <SelectValue>{(value: T) => props.options.find((o) => o.value === value)?.label ?? ''}</SelectValue>
      </SelectTrigger>
      <SelectContent
        side={props.side ?? 'bottom'}
        align={props.quiet ? 'start' : 'center'}
        alignItemWithTrigger={!props.quiet}
        className={props.quiet ? 'min-w-40' : undefined}
      >
        <SelectGroup>
          {props.options.map((o) => (
            <SelectItem key={String(o.value)} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** A dialog that is open while it is rendered; closing it (Escape, the backdrop, the close button) calls `onClose`. */
export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        className={cn('max-h-[88svh] grid-rows-[auto_minmax(0,1fr)_auto]', props.wide ? 'sm:max-w-5xl' : 'sm:max-w-lg')}
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div className="-mx-4 min-h-0 overflow-y-auto px-4">{props.children}</div>
        {props.footer ? <DialogFooter className="items-center">{props.footer}</DialogFooter> : <div />}
      </DialogContent>
    </Dialog>
  );
}

/** A labelled status line inside a panel: what went wrong, or what to watch out for. */
export function Notice({ tone, children, className }: { tone: 'error' | 'warning'; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'rounded-lg px-3 py-2 text-sm/5 whitespace-pre-wrap ring-1',
        tone === 'error'
          ? 'bg-destructive/5 text-destructive-foreground ring-destructive/20'
          : 'bg-warning/10 text-warning-foreground ring-warning/25',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function formatDuration(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "5 min ago", "2 hours ago", "yesterday", "on 3 Oct": when a project was last edited. The exact time is the tooltip. */
export function formatRelative(time: number, now = Date.now()): string {
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `on ${new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })}`;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    out.push(
      token.startsWith('**') ? (
        <strong key={`${keyBase}-${i++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      ) : (
        <code key={`${keyBase}-${i++}`} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">
          {token.slice(1, -1)}
        </code>
      ),
    );
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Small, safe markdown subset for chat replies: paragraphs, lists, **bold**, `code`. */
export function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2.5 wrap-break-word">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l));
        if (isList) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), `${bi}-${li}`)}</li>);
          return ordered ? (
            <ol key={bi} className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
              {items}
            </ol>
          ) : (
            <ul key={bi} className="flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground">
              {items}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

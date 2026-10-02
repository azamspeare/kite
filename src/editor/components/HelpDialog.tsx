import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Fragment, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Kbd, KbdGroup } from '@/components/ui/kbd';

/*
 * The help dialog, after Rika's (and the Docflare editor's): set in Assistant (`font-help`), in blocks of two
 * columns, each column a stack of small bordered islands with a title above. Rows are a name on the
 * left and its meaning, or its keys, on the right.
 */

type Term = { name: string; meaning: string };
type Shortcut = { action: string; combos: string[][] };
type Group<Row> = { id: string; title: string; rows: Row[] };

/** What each part of the editor is called, so a question, a bug report or a request to the agent can name it. */
const PARTS: [Group<Term>[], Group<Term>[]] = [
  [
    {
      id: 'top',
      title: 'Top',
      rows: [
        { name: 'Navbar', meaning: 'The bar across the top: the logo, Projects, the project name and its views.' },
        { name: 'Project name', meaning: 'After the slash. Click it to rename the project.' },
        { name: 'Scenes, Render', meaning: 'The two views of a project: editing its scenes, and rendering the video.' },
        { name: 'Art direction', meaning: 'The look every scene shares. The agent reads it before every edit.' },
        { name: 'Present', meaning: 'Plays the whole video full screen, with its sound.' },
      ],
    },
    {
      id: 'middle',
      title: 'Middle',
      rows: [
        { name: 'Stage', meaning: 'The large panel that shows the scene, or the whole video, at the playhead.' },
        { name: 'Transport', meaning: 'Under the stage: this scene or the whole video, play, the time and the scrubber.' },
        { name: 'Scrubber', meaning: 'The timeline. Ticks are beats and bars, blue marks are phrases and sound cues.' },
        { name: 'Filmstrip', meaning: 'The row of scenes under the stage, in video order. Drag one to move it.' },
        { name: 'Seam badge', meaning: 'Between two scenes: how much of the picture changes at that cut.' },
        { name: 'Add scene tile', meaning: 'The last tile. It adds a scene at the end.' },
      ],
    },
  ],
  [
    {
      id: 'right',
      title: 'Right',
      rows: [
        { name: 'Side panel', meaning: 'The tall panel on the right. The rail picks what it shows.' },
        { name: 'Rail', meaning: 'The icons at the far right: Chat, Soundtrack and Sound effects.' },
        { name: 'Chat', meaning: 'Where you ask the agent for changes, to this scene or to the whole project.' },
        { name: 'Composer', meaning: 'The box you write in, with the agent, model, effort and Send.' },
        { name: 'Soundtrack', meaning: 'The music under the video, with its beats, bars and phrases.' },
        { name: 'Sound effects', meaning: 'The sounds scenes can play, and the problems found in their cues.' },
      ],
    },
    {
      id: 'everywhere',
      title: 'Everywhere',
      rows: [
        { name: 'Canvas', meaning: 'The grey background behind everything.' },
        { name: 'Island', meaning: 'Any white panel on the canvas, like the stage or the side panel.' },
        { name: 'Project card', meaning: 'One video on the Projects page.' },
        { name: 'Footer', meaning: 'The bar along the bottom, with this Help.' },
      ],
    },
  ],
];

/** Every key the app answers to. `Mod` and `Alt` are spelled for the platform when shown. */
const SHORTCUTS: [Group<Shortcut>[], Group<Shortcut>[]] = [
  [
    {
      id: 'playback',
      title: 'Stage',
      rows: [
        { action: 'Play or pause', combos: [['Space']] },
        { action: 'Back or forward one frame', combos: [['← →']] },
        { action: 'Back or forward one second', combos: [['Shift', '← →']] },
        { action: 'Previous or next scene', combos: [['↑ ↓']] },
        { action: 'Go to the start', combos: [['Home']] },
      ],
    },
    {
      id: 'present',
      title: 'Present',
      rows: [
        { action: 'Play or pause', combos: [['Space']] },
        { action: 'Previous or next scene', combos: [['← →']] },
        { action: 'Leave', combos: [['Esc']] },
      ],
    },
  ],
  [
    {
      id: 'composer',
      title: 'Composer',
      rows: [
        { action: 'Send', combos: [['Mod', 'Enter']] },
        { action: 'New line', combos: [['Enter']] },
      ],
    },
    {
      id: 'dialogs',
      title: 'Dialogs',
      rows: [
        { action: 'Save the art direction', combos: [['Mod', 'Enter']] },
        { action: 'Close', combos: [['Esc']] },
      ],
    },
    {
      id: 'help',
      title: 'Help',
      rows: [{ action: 'Open or close this dialog', combos: [['?']] }],
    },
  ],
];

const IS_APPLE = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function keyLabel(key: string): string {
  if (key === 'Mod') {
    return IS_APPLE ? 'Cmd' : 'Ctrl';
  }

  if (key === 'Alt') {
    return IS_APPLE ? 'Option' : 'Alt';
  }

  return key;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

/** A block: a heading over two columns of islands. */
function HelpBlock({ title, columns }: { title: string; columns: [ReactNode, ReactNode] }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {columns.map((column, index) => (
          <div key={index} className="flex min-w-0 flex-col gap-6">
            {column}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A titled island of rows. */
function HelpIsland({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h4 id={id} className="text-sm font-semibold">
        {title}
      </h4>
      <dl className="min-w-0 divide-y rounded-lg border bg-card">{children}</dl>
    </section>
  );
}

const ROW = 'flex min-h-10 items-center justify-between gap-4 px-3 py-1.5';

function TermIsland({ group }: { group: Group<Term> }) {
  return (
    <HelpIsland id={`help-${group.id}`} title={group.title}>
      {group.rows.map((row) => (
        <div key={row.name} className={ROW}>
          <dt className="w-28 shrink-0 text-sm font-semibold">{row.name}</dt>
          <dd className="min-w-0 flex-1 text-xs leading-relaxed text-pretty text-muted-foreground">{row.meaning}</dd>
        </div>
      ))}
    </HelpIsland>
  );
}

function ShortcutIsland({ group }: { group: Group<Shortcut> }) {
  return (
    <HelpIsland id={`help-${group.id}`} title={group.title}>
      {group.rows.map((row) => (
        <div key={row.action} className={ROW}>
          <dt className="min-w-0 text-sm font-semibold">{row.action}</dt>
          <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {row.combos.map((combo, index) => (
              <Fragment key={combo.join('+')}>
                {index > 0 && <span className="text-xs">or</span>}
                <KbdGroup className="gap-1.5">
                  {combo.map((key) => (
                    <Kbd key={key} className="h-6 min-w-6 rounded-md bg-brand/12 px-1.5 font-help text-foreground">
                      {keyLabel(key)}
                    </Kbd>
                  ))}
                </KbdGroup>
              </Fragment>
            ))}
          </dd>
        </div>
      ))}
    </HelpIsland>
  );
}

/**
 * The help dialog and the control that opens it. `?` anywhere opens or closes it too, except while
 * typing, where a question mark is just a question mark.
 */
export function HelpDialog({
  trigger,
  children,
}: {
  /** The element that opens it, without its content. */
  trigger: ReactElement;
  /** The trigger's content. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key !== '?' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        isTypingTarget(event.target)
      ) {
        return;
      }

      // Inside a dialog (this one, or another one over the page), `?` only ever closes this one.
      if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]')) {
        setOpen(false);
        return;
      }

      event.preventDefault();
      setOpen((value) => !value);
    }

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(85svh,52rem)] flex-col gap-7 overflow-x-hidden overflow-y-auto px-12 pt-7 pb-8 font-help sm:max-w-4xl"
      >
        <div className="flex items-center justify-between border-b pb-6">
          <DialogTitle className="text-lg font-semibold">Help</DialogTitle>
          <DialogDescription className="sr-only">
            What each part of the editor is called, and every keyboard shortcut.
          </DialogDescription>
          <DialogClose render={<Button variant="ghost" size="icon-sm" className="-mr-2" aria-label="Close" />}>
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} aria-hidden="true" />
          </DialogClose>
        </div>
        <HelpBlock
          title="Parts of the editor"
          columns={[
            PARTS[0].map((group) => <TermIsland key={group.id} group={group} />),
            PARTS[1].map((group) => <TermIsland key={group.id} group={group} />),
          ]}
        />
        <HelpBlock
          title="Keyboard shortcuts"
          columns={[
            SHORTCUTS[0].map((group) => <ShortcutIsland key={group.id} group={group} />),
            SHORTCUTS[1].map((group) => <ShortcutIsland key={group.id} group={group} />),
          ]}
        />
      </DialogContent>
    </Dialog>
  );
}

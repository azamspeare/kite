// Questions on the rail: pick one (arrow keys or j/k, Enter), pick several (Space), hidden input.
//
//   ◆  Music generation · optional        ◇  Music generation · optional
//   │  (description)                →     │  (description)
//   │  ● Yes, install it                  │  Yes, install it
//   │  ○ No
//   └  ↑/↓ to move · enter to choose
import readline from 'node:readline';
import { cancel } from './input';
import { BAR, bold, cyan, dim, fit, gray, green, showCursor, yellow } from './ui';

export interface Choice<T> {
  value: T;
  label: string;
  /** Shown dimmed after the label. */
  hint?: string;
  /** Marks the answer as a compromise (skipping something): the answered question shows in yellow. */
  warn?: boolean;
}

/** A question's heading, and rail lines to show under it (see railText). */
export interface Question {
  title: string;
  note?: string;
  lines?: string[];
}

export const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** The lines of a question, redrawn in place as the answer changes. */
class Frame {
  private height = 0;
  draw(lines: string[]) {
    const back = this.height ? `\x1b[${this.height}A\r\x1b[0J` : '';
    process.stdout.write(back + lines.map((l) => `${fit(l)}\n`).join(''));
    this.height = lines.length;
  }
}

const heading = (q: Question, state: 'active' | 'done' | 'warn') =>
  `${state === 'active' ? cyan('◆') : state === 'warn' ? yellow('◇') : green('◇')}  ${bold(q.title)}${q.note ? dim(` · ${q.note}`) : ''}`;
const footer = (text: string) => `${gray('└')}  ${dim(text)}`;
const answered = (q: Question, answer: string, warn = false) => [
  BAR,
  heading(q, warn ? 'warn' : 'done'),
  ...(q.lines ?? []),
  `${BAR}  ${warn ? yellow(answer) : dim(answer)}`,
];
const asQuestion = (q: Question | string): Question => (typeof q === 'string' ? { title: q } : q);

type KeyHandler<T> = (str: string | undefined, key: readline.Key, done: (value: T) => void) => void;

function listen<T>(onKey: KeyHandler<T>): Promise<T> {
  if (!isInteractive()) return Promise.reject(new Error('This question needs an interactive terminal.'));
  const stdin = process.stdin;
  readline.emitKeypressEvents(stdin);
  // Setup holds the keyboard the whole time (input.ts); on its own, a question takes it just while it waits.
  const own = !stdin.isRaw;
  if (own) stdin.setRawMode(true);
  stdin.resume();
  process.stdout.write('\x1b[?25l');
  return new Promise((resolve) => {
    const handler = (str: string | undefined, key: readline.Key | undefined) => {
      if (key?.ctrl && key.name === 'c') {
        showCursor();
        cancel();
        return;
      }
      onKey(str, key ?? {}, (value) => {
        stdin.off('keypress', handler);
        if (own) {
          stdin.setRawMode(false);
          stdin.pause();
        }
        process.stdout.write('\x1b[?25h');
        resolve(value);
      });
    };
    stdin.on('keypress', handler);
  });
}

const isEnter = (key: readline.Key) => key.name === 'return' || key.name === 'enter';

function moved(key: readline.Key, index: number, count: number): number | null {
  if (key.name === 'up' || key.name === 'k') return (index + count - 1) % count;
  if (key.name === 'down' || key.name === 'j' || key.name === 'tab') return (index + 1) % count;
  return null;
}

function optionLine(selected: boolean, mark: string, label: string, hint?: string) {
  return `${BAR}  ${mark} ${selected ? label : dim(label)}${hint ? `  ${dim(hint)}` : ''}`;
}

/** Pick one answer. */
export async function select<T>(question: Question | string, choices: Choice<T>[], initial = 0): Promise<T> {
  const q = asQuestion(question);
  let index = Math.min(Math.max(initial, 0), choices.length - 1);
  const frame = new Frame();
  const render = () =>
    frame.draw([
      BAR,
      heading(q, 'active'),
      ...(q.lines ?? []),
      ...choices.map((c, i) => optionLine(i === index, i === index ? cyan('●') : dim('○'), c.label, c.hint)),
      footer('↑/↓ to move · enter to choose'),
    ]);
  render();
  const chosen = await listen<number>((str, key, done) => {
    if (isEnter(key)) return done(index);
    const next = moved(key, index, choices.length) ?? (str && /^[1-9]$/.test(str) ? Number(str) - 1 : null);
    if (next === null || next >= choices.length) return;
    index = next;
    render();
  });
  frame.draw(answered(q, choices[chosen].label, choices[chosen].warn));
  return choices[chosen].value;
}

export function confirm(
  question: Question | string,
  initial = true,
  labels: [yes: string, no: string] = ['Yes', 'No'],
): Promise<boolean> {
  return select(
    question,
    [
      { value: true, label: labels[0] },
      { value: false, label: labels[1] },
    ],
    initial ? 0 : 1,
  );
}

/** Pick any number of answers (none selected unless `selected` says so). */
export async function multiselect<T>(question: Question | string, choices: Choice<T>[], selected: T[] = []): Promise<T[]> {
  const q = asQuestion(question);
  let index = 0;
  const on = new Set(choices.flatMap((c, i) => (selected.includes(c.value) ? [i] : [])));
  const frame = new Frame();
  const render = () =>
    frame.draw([
      BAR,
      heading(q, 'active'),
      ...(q.lines ?? []),
      ...choices.map((c, i) =>
        optionLine(
          i === index,
          on.has(i) ? (i === index ? cyan('◼') : green('◼')) : i === index ? cyan('◻') : dim('◻'),
          c.label,
          c.hint,
        ),
      ),
      footer('↑/↓ to move · space to select · a for all · enter to confirm'),
    ]);
  render();
  await listen<void>((str, key, done) => {
    if (isEnter(key)) return done();
    const next = moved(key, index, choices.length);
    if (next !== null) index = next;
    else if (key.name === 'space') on.has(index) ? on.delete(index) : on.add(index);
    else if (str === 'a') {
      const all = on.size < choices.length;
      choices.forEach((_, i) => (all ? on.add(i) : on.delete(i)));
    } else return;
    render();
  });
  const picked = choices.filter((_, i) => on.has(i));
  frame.draw(answered(q, picked.length ? picked.map((c) => c.label).join(', ') : 'Nothing'));
  return picked.map((c) => c.value);
}

/** Hidden input (a token): one dot per character, never the text. */
export async function secret(question: Question | string, footnote: string): Promise<string> {
  const q = asQuestion(question);
  let value = '';
  const frame = new Frame();
  const render = () =>
    frame.draw([
      BAR,
      heading(q, 'active'),
      ...(q.lines ?? []),
      `${BAR}  ${value ? cyan('•'.repeat(Math.min(value.length, 40))) : dim('paste it here')}`,
      footer(footnote),
    ]);
  render();
  await listen<void>((str, key, done) => {
    if (isEnter(key)) return done();
    if (key.name === 'backspace') value = value.slice(0, -1);
    else if (key.ctrl && key.name === 'u') value = '';
    else if (str && !key.ctrl && !key.meta && str >= ' ') value += str;
    else return;
    render();
  });
  value = value.trim();
  frame.draw(answered(q, value ? `Received · ${value.length} characters` : 'Nothing pasted'));
  return value;
}

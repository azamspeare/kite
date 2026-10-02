// How ./kite looks: a rail down the left that joins the steps, like this:
//
//   ┌  Kite setup
//   │
//   ◇  Basics
//   │  ✓ Node.js 22.23.3
//   │  ◒ Models  ▰▰▰▰▰▱▱▱▱▱  5.9 / 9.8 GB · 12 MB/s · 4 min left
//   │
//   └  Done
//
// Spinners and progress bars redraw one line in place; without a terminal (logs, agents) only the results are printed.
import { stripVTControlCharacters } from 'node:util';

export const isTty = Boolean(process.stdout.isTTY);
const useColor = isTty && !process.env.NO_COLOR;
const style = (open: number, close: number) => (text: string) => (useColor ? `\x1b[${open}m${text}\x1b[${close}m` : text);
export const bold = style(1, 22);
export const dim = style(2, 22);
export const gray = style(90, 39);
export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const cyan = style(36, 39);

export const BAR = gray('│');
const MARKS = { ok: green('✓'), fail: red('✗'), warn: yellow('!'), info: gray('•') };
export type Mark = keyof typeof MARKS;
const SPINNER = ['◒', '◐', '◓', '◑'];

const columns = () => Math.min(process.stdout.columns || 80, 110);
export const visible = (text: string) => stripVTControlCharacters(text).length;

/** Cut a (possibly colored) line to the terminal width, so redrawing in place never wraps. */
export function fit(line: string, width = columns() - 1): string {
  if (visible(line) <= width) return line;
  let out = '';
  let shown = 0;
  // Walk the text, keeping color codes and counting only visible characters.
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) {
      out += part;
      continue;
    }
    const room = width - 1 - shown;
    if (room <= 0) break;
    out += part.slice(0, room);
    shown += Math.min(part.length, room);
  }
  return `${out}${useColor ? '\x1b[0m' : ''}…`;
}

/** Wrap plain text into lines that fit next to the rail (words longer than a line are broken up). */
export function wrap(text: string, indent = 0): string[] {
  const width = Math.max(30, columns() - 4 - indent);
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    const words = paragraph
      .split(' ')
      .flatMap((w) => (w.length > width ? (w.match(new RegExp(`.{1,${width}}`, 'g')) ?? [w]) : [w]));
    for (const word of words) {
      if (line && visible(line) + visible(word) + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

const print = (line = '') => console.log(line);

/** Rail lines for a block of text (a description under a heading, say). */
export function railText(text: string, paint: (t: string) => string = (t) => t): string[] {
  return wrap(text).map((line) => `${BAR}  ${paint(line)}`);
}

export const rail = {
  /** ┌ The first line of a command's output (a launcher that already opened the rail passes KITE_RAIL=open). */
  open(title: string, subtitle?: string) {
    if (process.env.KITE_RAIL === 'open') {
      delete process.env.KITE_RAIL;
    } else {
      print(`${gray('┌')}  ${bold(title)}`);
    }
    if (subtitle) railText(subtitle, dim).forEach((l) => print(l));
  },
  /** ◇ A step of the command. */
  section(title: string, note?: string) {
    print(BAR);
    print(`${green('◇')}  ${bold(title)}${note ? dim(` · ${note}`) : ''}`);
  },
  gap: () => print(BAR),
  /** Lines already made with railText(). */
  lines: (lines: string[]) => lines.forEach((l) => print(l)),
  text: (text: string) => railText(text).forEach((l) => print(l)),
  quiet: (text: string) => railText(text, dim).forEach((l) => print(l)),
  /** ✓ ✗ ! • A result line; long text wraps under itself. */
  mark(mark: Mark, text: string) {
    wrap(text, 2).forEach((line, i) => print(`${BAR}  ${i ? ' ' : MARKS[mark]} ${line}`));
  },
  /** A finished step, like a Task's last line: `✓ label · detail`. */
  done(label: string, detail = '', mark: Mark = 'ok') {
    print(fit(`${BAR}  ${MARKS[mark]} ${label}${detail ? dim(` · ${detail}`) : ''}`));
  },
  ok: (text: string) => rail.mark('ok', text),
  fail: (text: string) => rail.mark('fail', text),
  warn: (text: string) => rail.mark('warn', text),
  info: (text: string) => rail.mark('info', text),
  /** → A fix or next step, under the line it belongs to. */
  hint: (text: string) => wrap(text, 4).forEach((line, i) => print(`${BAR}    ${dim(i ? `  ${line}` : `→ ${line}`)}`)),
  /** Lines of a program's output (the tail of a log), indented and dimmed. */
  output: (lines: string[]) => lines.forEach((line) => print(`${BAR}    ${dim(fit(line, columns() - 6))}`)),
  /** └ The last line. */
  close(text: string, tone: 'ok' | 'warn' | 'fail' = 'ok') {
    const paint = tone === 'ok' ? (t: string) => t : tone === 'warn' ? yellow : red;
    print(BAR);
    print(`${gray('└')}  ${paint(text)}`);
    print();
  },
};

// ---------------------------------------------------------------------------
// Numbers

export function formatSize(bytes: number): string {
  if (bytes >= 100e9) return `${Math.round(bytes / 1e9)} GB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function progressBar(ratio: number, width = 16): string {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width);
  return `${cyan('▰'.repeat(filled))}${gray('▱'.repeat(width - filled))}`;
}

// ---------------------------------------------------------------------------
// Live lines

let cursorHidden = false;
/** The spinner or rows being redrawn right now, so Ctrl+C can clear them. */
let live: { interrupt(): void } | null = null;

/** Stop whatever is being redrawn (before printing a last message on Ctrl+C). */
export function stopLive() {
  live?.interrupt();
  live = null;
  showCursor();
}

function hideCursor() {
  if (isTty && !cursorHidden) {
    process.stdout.write('\x1b[?25l');
    cursorHidden = true;
  }
}
export function showCursor() {
  if (cursorHidden) {
    process.stdout.write('\x1b[?25h');
    cursorHidden = false;
  }
}
process.on('exit', showCursor);

/**
 * One step that takes a while: `│  ◒ label · detail`, redrawn in place, then `│  ✓ label · detail`.
 * Downloads report bytes with progress(), which adds a bar, the speed and the time left.
 */
export class Task {
  private detail = '';
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastPrinted = 0;
  private samples: [time: number, bytes: number][] = [];
  private readonly started = Date.now();

  constructor(private label: string) {
    if (isTty) {
      hideCursor();
      this.timer = setInterval(() => this.draw(), 90);
      this.draw();
      live = { interrupt: () => this.finish(this.line(MARKS.warn, dim('stopped'))) };
    }
  }

  get seconds() {
    return (Date.now() - this.started) / 1000;
  }

  update(detail: string) {
    this.detail = detail;
    this.printOccasionally();
  }

  /** Bytes done out of `total` (null: unknown), with speed and time left from the last few seconds. */
  progress(done: number, total: number | null) {
    const now = Date.now();
    this.samples.push([now, done]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 8000) this.samples.shift();
    const [t0, b0] = this.samples[0];
    const rate = now - t0 > 1500 ? ((done - b0) / (now - t0)) * 1000 : 0;
    const speed = rate > 0 ? ` · ${formatSize(rate)}/s` : '';
    if (total && total > 0) {
      const left = rate > 0 && total > done ? ` · ${formatDuration((total - done) / rate)} left` : '';
      this.detail = `${progressBar(done / total)}  ${formatSize(Math.min(done, total))} / ${formatSize(total)}${dim(speed + left)}`;
    } else {
      this.detail = `${formatSize(done)}${dim(speed)}`;
    }
    this.printOccasionally();
  }

  private line(mark: string, detail = this.detail) {
    const separator = detail.includes('▰') || detail.includes('▱') ? '  ' : dim(' · ');
    return `${BAR}  ${mark} ${this.label}${detail ? `${separator}${detail}` : ''}`;
  }

  private draw() {
    this.frame = (this.frame + 1) % SPINNER.length;
    process.stdout.write(`\r\x1b[2K${fit(this.line(cyan(SPINNER[this.frame])))}`);
  }

  /** Without a terminal, a line now and then so long downloads still show signs of life. */
  private printOccasionally() {
    if (isTty || Date.now() - this.lastPrinted < 15000) return;
    this.lastPrinted = Date.now();
    print(stripVTControlCharacters(this.line('…')));
  }

  private finish(line: string | null) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    live = null;
    if (isTty) process.stdout.write('\r\x1b[2K');
    showCursor();
    if (line !== null) print(fit(line, isTty ? columns() - 1 : 10000));
  }

  done(detail = '') {
    this.finish(this.line(MARKS.ok, detail && dim(detail)));
  }
  fail(detail = '') {
    this.finish(this.line(MARKS.fail, detail));
  }
  warn(detail = '') {
    this.finish(this.line(MARKS.warn, detail));
  }
  /** Remove the line (the caller prints its own results). */
  clear() {
    this.finish(null);
  }
}

/** Several things happening at once (services starting), one line each, redrawn together. */
export class LiveRows {
  private rows: { label: string; mark: Mark | 'spin'; detail: string }[];
  private height = 0;
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly width: number;

  constructor(labels: string[]) {
    this.rows = labels.map((label) => ({ label, mark: 'spin', detail: '' }));
    this.width = Math.max(...labels.map((l) => l.length)) + 2;
    if (isTty) {
      hideCursor();
      this.timer = setInterval(() => this.draw(), 90);
      this.draw();
      live = { interrupt: () => this.stop() };
    }
  }

  set(i: number, mark: Mark | 'spin', detail: string) {
    this.rows[i] = { ...this.rows[i], mark, detail };
    if (!isTty && mark !== 'spin') print(stripVTControlCharacters(this.render(i)));
  }

  private render(i: number): string {
    const { label, mark, detail } = this.rows[i];
    const glyph = mark === 'spin' ? cyan(SPINNER[this.frame]) : MARKS[mark];
    return fit(`${BAR}  ${glyph} ${label.padEnd(this.width)}${mark === 'fail' ? red(detail) : dim(detail)}`);
  }

  private draw() {
    this.frame = (this.frame + 1) % SPINNER.length;
    const back = this.height ? `\x1b[${this.height}A\r` : '';
    process.stdout.write(`${back}${this.rows.map((_, i) => `\x1b[2K${this.render(i)}\n`).join('')}`);
    this.height = this.rows.length;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.draw();
    }
    live = null;
    showCursor();
  }
}

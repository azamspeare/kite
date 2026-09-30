// The keyboard while a command runs. Keys aren't echoed (a stray Enter would break the lines being redrawn, or answer the
// next question by accident), Ctrl+C still stops the command, and questions (prompt.ts) get the keys while they wait.
let held = false;
let cancelled = false;
let onCancel: () => void = () => {
  process.stdout.write('\n');
  process.exit(130);
};

/** What Ctrl+C does (a command can say what it leaves behind). */
export function setCancelHandler(handler: () => void) {
  onCancel = handler;
}

export function cancel() {
  if (cancelled) return;
  cancelled = true;
  onCancel();
}

const swallow = (data: Buffer) => {
  if (data.includes(3)) cancel(); // Ctrl+C
};

/** Take the keyboard (in a terminal only): nothing typed is echoed, and only Ctrl+C does anything. */
export function holdInput() {
  if (held || !process.stdin.isTTY) return;
  held = true;
  process.stdin.setRawMode(true);
  process.stdin.on('data', swallow);
  process.stdin.resume();
}

export function releaseInput() {
  if (!held) return;
  held = false;
  process.stdin.off('data', swallow);
  try {
    process.stdin.setRawMode(false);
  } catch {
    // the terminal is gone (closed window)
  }
  process.stdin.pause();
}

/** Hand the terminal to something that needs it (a login, a password prompt), then take the keyboard back. */
export async function withTerminal<T>(fn: () => Promise<T>): Promise<T> {
  const wasHeld = held;
  releaseInput();
  try {
    return await fn();
  } finally {
    if (wasHeld) holdInput();
  }
}

// Ctrl+C without a terminal, a closed terminal window, or a plain `kill`: the same as Ctrl+C.
for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM'] as const) process.on(signal, cancel);
// A closed window can also show up first as a failed write (or read) on the terminal.
process.stdout.on('error', cancel);
process.stdin.on('error', cancel);

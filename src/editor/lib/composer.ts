import { isChatToolId, type ChatToolId } from '../../shared/chatOptions';
import type { Attachment } from '../../shared/types';

/*
 * The chat composer's text logic, kept apart from the component so it can be tested: when the "/" and
 * "@" lists open, how a mention is written in, and how a draft is saved across reloads.
 */

/** The letters after "/" when the whole input is "/" and letters and no tool is chosen yet; otherwise null. */
export function slashQuery(text: string, tool: ChatToolId | null): string | null {
  return tool === null && /^\/[a-zA-Z]*$/.test(text) ? text.slice(1).toLowerCase() : null;
}

/** A mention being typed just before the caret: "@", then letters (the start of "Scene"), then digits. */
export function mentionQuery(beforeCaret: string): { word: string; digits: string } | null {
  const match = /(?:^|\s)@([a-zA-Z]*)(\d*)$/.exec(beforeCaret);
  return match ? { word: match[1], digits: match[2] } : null;
}

/** Replace the mention being typed before `caret` with "@Scene n ", and say where the caret goes. */
export function insertMention(text: string, caret: number, n: number): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  const mention = `@Scene ${n} `;
  return { text: `${before.slice(0, at)}${mention}${text.slice(caret)}`, caret: at + mention.length };
}

export interface Draft {
  text: string;
  tool: ChatToolId | null;
  files: Attachment[];
}

function isAttachment(value: unknown): value is Attachment {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    (v.kind === 'image' || v.kind === 'audio') &&
    typeof v.size === 'number' &&
    (v.duration === undefined || typeof v.duration === 'number')
  );
}

/** A saved draft. Older versions saved the bare text; anything unreadable starts the box empty. */
export function readDraft(saved: string | null): Draft {
  const empty: Draft = { text: '', tool: null, files: [] };
  if (!saved) return empty;
  let value: unknown;
  try {
    value = JSON.parse(saved);
  } catch {
    return { ...empty, text: saved };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...empty, text: saved };
  const v = value as Record<string, unknown>;
  return {
    text: typeof v.text === 'string' ? v.text : '',
    tool: isChatToolId(v.tool) ? v.tool : null,
    files: Array.isArray(v.files) ? v.files.filter(isAttachment) : [],
  };
}

/** What to keep for a draft, or null when there is nothing worth keeping. */
export function writeDraft(draft: Draft): string | null {
  if (!draft.text && !draft.tool && draft.files.length === 0) return null;
  return JSON.stringify(draft);
}

// What the chat composer offers, shared by the editor and the server: the "/" tools, the files a
// message may carry, and how "@Scene N" mentions are read.

export type ChatToolId = 'animate' | 'design' | 'sound' | 'music';

export interface ChatTool {
  id: ChatToolId;
  name: string;
  /** The composer's placeholder while the tool is chosen. */
  placeholder: string;
  /** The sentence the tool adds to the turn, telling the agent what kind of change this is. */
  focus: string;
  /** Offered in the project chat only. */
  projectOnly?: boolean;
}

export const CHAT_TOOLS: readonly ChatTool[] = [
  {
    id: 'animate',
    name: 'Animate',
    placeholder: 'How should it move? Timing, easing, holds…',
    focus: 'Focus on motion and timing: how things move, ease, hold and land. Keep the look unless asked.',
  },
  {
    id: 'design',
    name: 'Design',
    placeholder: 'How should it look? Layout, colour, type…',
    focus: 'Focus on the look: layout, colour, type and spacing, within the art direction. Keep the timing unless asked.',
  },
  {
    id: 'sound',
    name: 'Sound',
    placeholder: 'What should it sound like? Hits, whooshes, clicks…',
    focus: 'Focus on sound effects: add, place or adjust cues, then run check_audio. Leave the visuals alone unless asked.',
  },
  {
    id: 'music',
    name: 'Music',
    placeholder: 'What music should play under the video?',
    focus: 'Focus on the soundtrack: compose, choose or adjust the music, and fit the cuts to it.',
    projectOnly: true,
  },
];

export function isChatToolId(value: unknown): value is ChatToolId {
  return CHAT_TOOLS.some((t) => t.id === value);
}

export function toolsFor(scope: 'scene' | 'project'): ChatTool[] {
  return CHAT_TOOLS.filter((t) => scope === 'project' || !t.projectOnly);
}

export type AttachmentKind = 'image' | 'audio';

/** The files a message may carry, by lower-case extension. */
export const ATTACHMENT_TYPES: Readonly<Record<string, AttachmentKind>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  wav: 'audio',
  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  aif: 'audio',
  aiff: 'audio',
  caf: 'audio',
};

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_ATTACHMENT_BYTES = 200 * 1024 * 1024;

export function maxBytes(kind: AttachmentKind): number {
  return kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_ATTACHMENT_BYTES;
}

/** The lower-case extension after the last dot, or '' when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function attachmentKind(name: string): AttachmentKind | null {
  return ATTACHMENT_TYPES[extensionOf(name)] ?? null;
}

/** "@Scene 2" in a message: the second scene of the video, at the time it was written. */
export const MENTION = /@Scene (\d+)/g;

/** The scenes a message mentions, as ids, in order and once each. Numbers with no scene behind them are skipped. */
export function mentionedScenes(text: string, sceneIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const id = sceneIds[Number(match[1]) - 1];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

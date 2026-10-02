# Composer: "/" tools, "@" scene mentions and file attachments

Status: approved in chat 2026-10-03. Branch: `redesign`.

## Goal

Bring Rika's three composer features to Kite's chat: pick a tool with `/`, mention a scene with `@`, and attach images and audio. Attached files are saved in the project and the agent is told their paths; nothing is sent to the model directly. The agent opens or uses the files itself.

## Decisions (from the user)

| Topic | Decision |
| --- | --- |
| Tools | `/animate`, `/design`, `/sound`, `/music` (`/music` in the project chat only) |
| Attachments | Images and audio. Store them in the project, point the agent at the paths |
| Audio | Can be background music or a short sound: the agent decides, with one tool for each |
| Codex | Claude only can look at images; Codex gets the paths |

## Out of scope

Video, PDF and text attachments; Codex seeing raster images; mentions of anything but scenes; deleting attachments from `assets/` (they stay with the project, like the user's other files).

## 1. Shared definitions — `src/shared/chatOptions.ts` (new)

```ts
export type ChatToolId = 'animate' | 'design' | 'sound' | 'music';
export const CHAT_TOOLS: { id: ChatToolId; name: string; placeholder: string; focus: string; projectOnly?: boolean }[];
export const ATTACHMENT_TYPES: Record<string, 'image' | 'audio'>; // by lower-case extension
export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_ATTACHMENT_BYTES = 200 * 1024 * 1024;
export function extensionOf(name: string): string; // 'png', '' when none
export function attachmentKind(name: string): 'image' | 'audio' | null;
export function isChatToolId(value: unknown): value is ChatToolId;
export function toolsFor(scope: 'scene' | 'project'): typeof CHAT_TOOLS;
export function mentionedScenes(text: string, sceneIds: string[]): string[]; // "@Scene 2" → ids, in order, no duplicates, unknown numbers dropped
```

- Images: png, jpg, jpeg, gif, webp, svg. Audio: wav, mp3, m4a, aac, flac, ogg, opus, aif, aiff, caf.
- Tools and the sentence each adds to the turn:
  - **Animate** — "Focus on motion and timing: how things move, ease, hold and land. Keep the look unless asked."
  - **Design** — "Focus on the look: layout, colour, type and spacing, within the art direction. Keep the timing unless asked."
  - **Sound** — "Focus on sound effects: add, place or adjust cues, then run check_audio. Leave the visuals alone unless asked."
  - **Music** (project only) — "Focus on the soundtrack: compose, choose or adjust the music, and fit the cuts to it."

`src/shared/types.ts`:

```ts
export interface Attachment {
  /** The file's name in the project's assets/ folder: a 6-character random prefix, a dash, a safe stem and the extension. */
  id: string;
  /** The name the file had on the user's computer. */
  name: string;
  kind: 'image' | 'audio';
  size: number;
  /** Audio only: seconds. */
  duration?: number;
}
// ChatMessage gains (user messages only):
tool?: ChatToolId;
files?: Attachment[];
/** Scene ids the message mentions with "@Scene N", in order. */
scenes?: string[];
```

## 2. Server

**`server/attachments.ts` (new)**

- `saveAttachment(projectDir, originalName, data): Promise<Attachment>`. Rules:
  - The name must be 1–200 characters, and `attachmentKind` must know its extension; otherwise 415, "Kite can attach images and audio files".
  - Empty data is 400. Over the kind's limit is 413, with a message that names the limit.
  - The stem is reduced to `[A-Za-z0-9_-]`, at most 60 characters, falling back to `file`. The id is `${random6}-${stem}.${ext}`.
  - It is written to `<project>/assets/<id>` (exclusive create).
  - Audio is decoded with ffmpeg. A file that cannot be decoded is removed, and the call fails with 400 "can't be read as audio". The duration is measured from the decode.
- `findAttachments(projectDir, ids): Promise<Attachment[]>`:
  - Each id must match `/^[a-z0-9]{6}-[A-Za-z0-9_-]{1,60}\.[a-z0-9]{1,5}$/` and exist under `assets/`. Otherwise 400 "An attached file is missing".
  - Kind and size come from the disk. Audio duration is measured again.
  - The original name comes from a sidecar. Each upload writes `<project>/.kite/attachments.json`, a map from id to `{ name, duration? }`. A missing entry falls back to the id.
- `attachmentStem(id)`: the id without its random prefix and extension, which is a good default name for a sound.

**Route** `POST /api/projects/:id/attachments`. The raw body plus `x-filename` (URI-encoded) return an `Attachment`. It sits behind the existing `/api` guard.

**`server/chat.ts`**

- `SendInput` gains `tool?: string`, `files?: string[]` and `scenes?: string[]`.
- `startTurn` rules:
  - Text may be empty when there are files.
  - At most `MAX_ATTACHMENTS` files.
  - `tool` must pass `isChatToolId`, and `music` is refused in a scene chat (400).
  - Files go through `findAttachments`.
  - Scene ids are kept only if they exist (deduplicated).
  - The user message stores `tool`, `files` and `scenes`.
- The `<previous_chat>` history notes attachments on a user line: `(attached: assets/…, …)`.

**`server/agents/prompts.ts`**

`messageContext(project, { tool, files, scenes })` returns lines added inside `<kite_context>` by both `sceneTurnPrompt` and `projectTurnPrompt`. Both take a new `message` argument.

- `Mentioned: Scene 2 = scenes/anatomy.tsx ("Anatomy"); …` (current numbers).
- `Attached to this message (in assets/, open images with Read): assets/a1b2c3-logo.png (image, "logo.png"); assets/d4e5f6-intro.mp3 (audio, 2:31, "intro.mp3").`
- When audio is attached:
  - Project chat: `For attached audio, use add_sound_from_attachment for a sound effect, or set_soundtrack_from_attachment for background music, as the message asks.`
  - Scene chat: `use add_sound_from_attachment` (the soundtrack is set in the Project chat).
- The tool's focus sentence.
- Empty text becomes "See the attached files."

`SCENE_GUIDE` gains one line under `assets/`: files the user attaches in the chat land here; scenes show them with `asset('<id>')`.

**MCP tools (`server/mcp.ts`)**

- `add_sound_from_attachment { project?, file, name? }`:
  - `file` is an attachment id, or `assets/<id>`. It must be an audio attachment of this project.
  - It copies the file into the sound library through `SoundLibrary.importFile`, named `name` or the attachment's stem.
  - It returns the sound's name and duration, and reminds the agent to cue it by that name.
  - It is added to `SCENE_TOOLS`: scene chats may add sounds.
- `set_soundtrack_from_attachment { project?, file, start? }`:
  - Project chat only (`assertStructural('Changing the soundtrack')`).
  - It calls `MusicService.importUpload`, then `store.updateMusic({ start })` when `start` is given.
  - It returns `musicSummary`.

## 3. Editor

**`src/editor/lib/composer.ts` (new, pure)**

- `slashQuery(text, tool)`: the text after `/` when the whole input is `/` plus letters and no tool is chosen; otherwise `null`.
- `mentionQuery(beforeCaret)`: `{ word, digits }` for a trailing `@word123` after the start or whitespace.
- `insertMention(text, caret, n)`: returns `{ text, caret }` with `@Scene n ` in place of the query.
- Draft read/write helpers for `{ text, tool, files }`. An old plain-string draft is read as text.

**`api.uploadAttachment(projectId, file): Promise<Attachment>`**, built like `uploadSound`.

**`Composer` (in `Chat.tsx`, after Rika's)**

- **"/"**: when the whole input is `/` plus letters, a list of `toolsFor(scope)` opens above the box. Each row has an icon tile (`brand-8`), the name and the placeholder. Choosing one shows `ToolMark` at the start of the line in `brand-text`, clears the text, and changes the placeholder. The tool stays after sending. Backspace at the start (or Delete in an empty box) removes it.
- **"@"**: a trailing `@` query opens a list of the project's scenes. Each row has a `FrameView` thumbnail, "Scene N", the scene's name, and "On the stage" for the current scene. The list is filtered by the digits typed. Choosing a row writes `@Scene N `.
  - Mentions of scenes that exist are drawn in `brand-text`, with a 0.4px text stroke, by a mirror layer over a transparent-text textarea, as in Rika. The same highlight applies in sent messages.
- **Keys**: while a list is open, ↑/↓ wrap, Enter or Tab chooses, and Esc closes (the same query stays closed). ⌘/Ctrl+Enter sends; Send is parked while a list is open.
- **Attachments**:
  - Three ways in: a round **+** button (a hidden file input accepting the types above, multiple files); paste (file items from the clipboard); and dropping files on the composer.
  - Each file is checked before upload (type, size, number of slots). The last problem shows under the box in `destructive-foreground`.
  - Each file uploads at once, showing a spinner on its card, and is removed if the upload fails.
  - Send waits until no upload is running. A message needs text or files.
- **Draft**: `{ text, tool, files }` survives a reload (sessionStorage, same key). Files still uploading are left out.
- **Drop routing**: the composer carries `data-drop="composer"`. The app's drop overlay then reads "Drop to attach to your message". On drop, the files go to the composer through a small listener registry in `Chat.tsx` (`attachToComposer(files)`); other zones behave as before.

**`AttachmentCard`**

- An image is a 64px square thumbnail.
- Audio is a `h-16 w-44` card: a round play button (plays through `previewAudio`), then the name and the duration in mono.
- In the composer, every card has a round remove button and a spinner overlay while it uploads.
- Files are shown from `/@fs<project.dir>/assets/<id>`, like the frames' assets.

**Sent user messages** show the cards above the bubble, right-aligned. The bubble starts with the `ToolMark` and highlights mentions. A message with files and no text shows only the cards.

## 4. Docs

- `HelpDialog` Composer rows: "Choose a tool `/`", "Mention a scene `@`", "Attach files: Paste, or drop on the box".
- `DESIGN.md` "Inside the chat" gains the three features.
- `docs/using-kite.md` gets a short "Tools, mentions and files" paragraph.

## Done when

1. Unit tests pass for:
   - `chatOptions` (kinds, mentions);
   - `composer.ts` (queries, insertion, drafts);
   - `attachments.ts` (accepts and names files, rejects type, size and undecodable audio, finds files, rejects bad ids);
   - `messageContext` (lines for tool, mentions, image, audio in either chat, empty text);
   - `startTurn` validation (files without text, `music` refused in a scene chat).
2. `npm run typecheck`, `npm test` and `npm run format:check` pass.
3. In the browser:
   - `/` and `@` lists open, filter, take the keyboard and insert;
   - pasting an image and dropping an audio file on the composer each upload with a spinner, and the cards show;
   - a sent message shows its files, tool and highlighted mention;
   - the draft survives a reload.
4. One real Claude turn: an attached PNG is opened with Read; an attached WAV, with "use this as a whoosh on the cut", becomes a sound through `add_sound_from_attachment`. The test files are cleaned up afterwards.

## Changes made during the build

- **Durations** of attached audio are measured once on upload and kept in `.kite/attachments.json`; `findAttachments` reads them from there instead of decoding again.
- **After review:** the context line is provider-aware (Claude: "open images with Read"; Codex: "you can't view images here, use them by file name") and spells out the exact `asset('<file name>')` call; user file names are stripped of quotes, angle brackets and control characters in the prompt; SVGs that could run script are refused; the upload route answers 400 for an unreadable file name and 413 from `Content-Length` before reading the body; `add_sound_from_attachment` refuses audio over the sound library's 50 MB limit and points at the soundtrack tool; a paste of text with a picture of it (Office, Keynote) stays text; a draft whose file has gone drops its files with a note; "@Scene 2" typed out keeps filtering; the transcript stays pinned when the composer grows.
- **Known limit:** undoing a turn does not remove a sound made from an attachment (sound files the user adds are not tracked by undo); remove it from `sounds/` by hand.

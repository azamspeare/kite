# Composer tools, mentions and attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` tools, `@Scene N` mentions and image/audio attachments in Kite's chat composer; attachments are stored in `assets/` and the agent is pointed at them.

**Architecture:** Shared definitions in `src/shared/chatOptions.ts`; the server stores uploads (`server/attachments.ts`, one route), validates and records them on the user message (`chat.ts`), and adds context lines to the turn prompt (`prompts.ts`); two MCP tools turn attached audio into a sound or the soundtrack. The editor's composer gains the lists, the mirror highlight and attachment cards; pure logic lives in `src/editor/lib/composer.ts`.

**Tech Stack:** TypeScript, node:test, Hono, React 19, Tailwind v4, Base UI, Heroicons.

**Spec:** `docs/superpowers/specs/2026-10-03-composer-tools-mentions-attachments-design.md`

## Global Constraints

- Images: png, jpg, jpeg, gif, webp, svg ≤ 10 MB. Audio: wav, mp3, m4a, aac, flac, ogg, opus, aif, aiff, caf ≤ 200 MB. At most 5 per message.
- Attachment id: `/^[a-z0-9]{6}-[A-Za-z0-9_-]{1,60}\.[a-z0-9]{1,5}$/`, stored at `<project>/assets/<id>`.
- `/music` only in the project chat; `add_sound_from_attachment` in both chats; `set_soundtrack_from_attachment` project chat only.
- UI copy in sentence case, no exclamation marks; tokens only (DESIGN.md).
- Install nothing new.

## Review Focus

1. **Path safety** — an attachment id from the client must never reach outside `assets/` (`../x`, absolute, odd characters): `findAttachments` rejects by pattern. Test in Task 2.
2. **Upload races** — sending while a file still uploads must be impossible; a failed upload must not leave a card. Checked in Task 6 (browser) and enforced by `canSend`.
3. **Keyboard conflicts** — Enter/Tab/arrows inside an open list must not send or move focus; Esc must not close the composer's parent. Checked in Task 6.
4. **Drop routing** — a file dropped on the composer attaches; elsewhere the old soundtrack/sound behaviour holds; the overlay always clears. Checked in Task 6.
5. **Old drafts** — a draft saved as plain text by the previous version still loads. Test in Task 4.

---

### Task 1: Shared chat options and message fields
**Files:** Create `src/shared/chatOptions.ts`, `src/shared/chatOptions.test.ts`; Modify `src/shared/types.ts`.
- [ ] Test: `attachmentKind('A.PNG') === 'image'`, `('x.mp3') === 'audio'`, `('x.pdf') === null`, `('noext') === null`; `toolsFor('scene')` lacks `music`, `toolsFor('project')` has 4; `mentionedScenes('see @Scene 2 and @Scene 9 and @Scene 2', ['a','b','c'])` → `['b']`; `isChatToolId('music')` true, `'x'` false.
- [ ] Run → FAIL; implement; run → PASS.
- [ ] Add `Attachment` and the `tool`/`files`/`scenes` fields to `types.ts`.

### Task 2: Store attachments on the server
**Files:** Create `server/attachments.ts`, `server/attachments.test.ts`; Modify `server/api.ts`, `src/editor/api.ts`.
- [ ] Tests (temp project dir; WAV fixture written as a 0.5 s 48 kHz 16-bit PCM file built in the test):
  - saves `logo.png` bytes → id matches pattern, file exists under `assets/`, kind image, name `logo.png`;
  - saves the WAV → kind audio, duration ≈ 0.5;
  - rejects `doc.pdf` (415), empty data (400), image over 10 MB (413), undecodable `.mp3` (400, and the file is removed);
  - `findAttachments` returns the saved two with names; rejects `../etc.png`, `abc.png`, a well-formed id that doesn't exist.
- [ ] Implement; route `POST /projects/:id/attachments`; client `uploadAttachment`.

### Task 3: Messages and turn prompts
**Files:** Modify `server/chat.ts`, `server/agents/prompts.ts`, `server/templates.ts`, `server/agents/chat.test.ts`; Create `server/agents/prompts.test.ts`.
- [ ] Prompt tests: `messageContext` lines for tool focus, a mention (`Scene 2 = scenes/<id>.tsx`), an image, audio in the project chat (both tools named) and in a scene chat (only add_sound…); empty text → "See the attached files.".
- [ ] Chat tests: a project send with `files` and empty text stores `files` and reaches the provider prompt with the asset path; `tool: 'music'` in a scene chat rejects 400; an unknown file id rejects 400.
- [ ] Implement; scene guide line.

### Task 4: Composer logic
**Files:** Create `src/editor/lib/composer.ts`, `src/editor/lib/composer.test.ts`.
- [ ] Tests: `slashQuery('/an', null) === 'an'`, `('/an', 'design') === null`, `('hi /an', null) === null`; `mentionQuery('look at @sc')` → `{word:'sc',digits:''}`, `('a@b')` → null, `('@scene2')` → `{word:'scene',digits:'2'}`; `insertMention('see @sc', 7, 3)` → `{ text: 'see @Scene 3 ', caret: 13 }`; `readDraft('plain text')` → `{text:'plain text', tool:null, files:[]}`, round trip of `writeDraft`.
- [ ] Implement.

### Task 5: MCP tools for attached audio
**Files:** Modify `server/mcp.ts`, `server/agents/tools.ts`.
- [ ] `add_sound_from_attachment` (in SCENE_TOOLS) and `set_soundtrack_from_attachment` (project only), both resolving through `findAttachments` and refusing images.
- [ ] Typecheck.

### Task 6: Composer UI
**Files:** Modify `src/editor/components/Chat.tsx`, `src/editor/App.tsx`, `src/editor/components/HelpDialog.tsx`; Create `src/editor/components/chat/AttachmentCard.tsx`, `src/editor/components/chat/ToolMark.tsx`, `src/editor/components/chat/mentions.tsx`.
- [ ] Lists, mirror highlight, keyboard, attachments (+, paste, drop), draft, sent-message rendering, drop routing, help rows.
- [ ] Browser checks for Review Focus 2–4 and the spec's "Done when" 3.

### Task 7: Docs, real turn, review
- [ ] DESIGN.md, docs/using-kite.md.
- [ ] One real Claude turn with a PNG and a WAV; clean up.
- [ ] typecheck, test, format:check; fresh reviewer on the range; fix; push.

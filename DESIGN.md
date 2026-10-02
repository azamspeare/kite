# Kite Design System

UI conventions for Kite, the editor in this repository. Keep them consistent across every view and component. Design tokens live in `src/editor/styles.css`; the mark lives in `src/editor/components/Logo.tsx`. When building UI, reach for an existing token or pattern before inventing a value. When a view needs something this file does not cover, add it here first, then build it.

**Design language in one line:** a calm, neutral zinc canvas with one sky-blue brand accent, soft "island" elevation, and colour used almost only to carry status, not decoration.

**Where it comes from:** Kite uses the design system of its sister app Rika (`../rika/DESIGN.md`), which takes its neutral system from the Docflare platform. Surfaces, text, borders, shadows, motion, the components and the island layout are Rika's. The sky-blue brand, the kite mark and the editor's own parts (stage, transport, filmstrip, rail) are Kite's.

**What this file does not cover:** the videos Kite makes. A scene can look like anything the user asks for. This file governs only the app around the scenes. Scene frames (`frame.html`) never load the editor's stylesheet: Tailwind scans only `src/editor/` (`source(none)` and `@source '.'` at the top of `styles.css`), so nothing here can change a preview or a render.

---

## 1. Color

Never hard-code a hex or `oklch()` value in a component; use a token or a Tailwind palette class. The exceptions are the mark in `public/favicon.svg`, and black behind video in present mode and render previews (the letterbox is part of the picture, not chrome).

### Semantic tokens

Rika's, unchanged. Defined in `:root` in `styles.css`, exposed as Tailwind utilities (`bg-background`, `text-muted-foreground`, …). Neutrals sit on Tailwind's `zinc` scale.

| Token | Value | Role |
| --- | --- | --- |
| `background` / `foreground` | white / zinc-950 | island surface / primary text |
| `card`, `popover` | white | raised surfaces (dialogs, menus, cards) |
| `primary` / `primary-foreground` | zinc-900 / white | high-emphasis fills (default button, play button) |
| `muted` / `muted-foreground` | zinc-100 / zinc-500 | the canvas, recessive surfaces / secondary text |
| `accent` | zinc-100 | hover and active tint (the rail's current panel) |
| `destructive` / `destructive-foreground` | red-600 / red-700 | danger fill / danger text |
| `border`, `input` | zinc-950 at 10% / 15% | hairlines / field borders |
| `ring` | brand step 3 | focus ring |
| `tray` | `#f9f9fb` | the inset area the stage's frame sits on |

### Brand ramp

Eight steps, dark (1) to light (8), on Rika's lightness and chroma steps at Kite's sky hue (235). Steps 2 and 3 are a little darker than Rika's so blue keeps the same contrast; chroma is clamped to sRGB.

| Token | Value | Use |
| --- | --- | --- |
| `brand-1` | `oklch(0.355 0.074 235)` | darkest, for deep accents |
| `brand-2` | `oklch(0.45 0.094 235)` | **brand text** (`--brand-text`, `text-action-text`). 7.31 on white |
| `brand-3` | `oklch(0.555 0.116 235)` | **the fill step** (`action`, `ring`). Takes white labels at 4.65 |
| `brand-4` | `oklch(0.632 0.133 235)` | hover of the fill step |
| `brand-5` to `brand-8` | lighter tints | soft backgrounds, the drop overlay, the agent's avatar |
| `brand` | `#3cbbf9` | **the flagship**: the logo's sky. Phrase marks and sound cues on the scrubber, card hover borders |
| `action` | = `brand-3` | the branded call-to-action fill |
| `navy` | `oklch(0.25 0.08 235)` | ink on the flagship (7.30) |

Rules:

- **`brand` (the flagship sky) never carries white text.** White on it measures 2.17. It takes `navy` labels, or none (the Catalyst `brand` button is navy on sky).
- **A blue button uses `action`**, which is deep enough for white labels: Present, Render MP4, the send button.
- **Blue text uses `brand-text`**, never the flagship or the fill step.
- Blue is the only chromatic colour in the chrome. If everything is blue, nothing is.

### Status

| Token | Use |
| --- | --- |
| `success` / `success-foreground` | a finished step's check, an invisible cut's seam badge |
| `warning` / `warning-foreground` | cue problems, a jumpy cut, the rail's problem count |
| `info` / `info-foreground` | reserved |
| `destructive` / `destructive-foreground` | errors, delete on hover, a failed seam check |

The `-foreground` step is the one that holds contrast as text. Seam badges also use Tailwind's `lime` for a faint cut, between green and amber.

---

## 2. Typography

Loaded from `@fontsource-variable` at the top of `styles.css`, so they work offline.

| Token | Family | Role |
| --- | --- | --- |
| `--font-sans` | the Apple system font (SF Pro), then **Inter** | all UI text |
| `--font-heading` | = sans | headings: set apart by weight and size |
| `--font-brand` | **Sora** | the "Kite" wordmark only |
| `--font-mono` | **Geist Mono** | timecodes, durations, code, step details |
| `--font-help` | **Assistant** | the help dialog only |
| `font-serif` | the system serif, italic | the footer's tagline, its only use |

- **Headings** are `font-medium` or `font-semibold`, never bold: panel and dialog titles `text-sm`/`text-base font-medium`, page titles `text-xl/8 font-semibold`.
- **Numbers** that align or update in place use `tabular-nums`; times on the transport and durations use `font-mono`.
- **Secondary text** is `text-muted-foreground`, usually `text-sm` or `text-xs`.
- Headings balance and paragraphs avoid orphans (set globally).

---

## 3. Shape and elevation

`--radius` is 8px (`rounded-lg`); the rest of the scale is derived from it (`xl` 11.2px, `3xl` 17.6px). Buttons, inputs and menus `rounded-lg`/`rounded-md`; dialogs, filmstrip tiles and project cards `rounded-xl`; islands and the composer `rounded-3xl`; round buttons (play, send) and badges `rounded-full`.

| Token | Use |
| --- | --- |
| `shadow-island`, `shadow-island-stronger` | floating chrome: toasts, the present-mode controls |
| `shadow-card` | cards on a white island: the render settings, render items, the stage's frame |
| `shadow-xs` + `ring-1 ring-foreground/5` | islands and filmstrip tiles |

```
ISLAND        = 'rounded-3xl bg-background shadow-xs ring-1 ring-foreground/5'   (components/ui.tsx)
ISLAND_HEADER = 'flex h-12 shrink-0 items-center gap-3 border-b pr-3 pl-4'
```

---

## 4. Layout

The page is the `muted` canvas. Everything sits on it as islands, 12px apart and 12px in from the screen's edges. The app fills the screen and never scrolls as a page; panels scroll inside themselves.

- **Navbar** (`components/Navbar.tsx`): straight on the canvas, no bar of its own. The mark and "Kite" (a button to the projects page), a separator, **Projects**, then with a project open `/`, the project's name (edited in place, borderless), a separator and the views **Scenes** and **Render**. The current page has a `foreground/5` tint, the same as hover. At the right: **Art direction** and **Copy path** (ghost), **New project** (outline) and **Present**, the editor's one primary action (Catalyst `action`).
- **Footer** (`components/Footer.tsx`): white, edge to edge, a hairline on top. The mark, "Kite © year", the tagline "Every frame is code." in the serif, and **Help** at the right.
- **Help** (`components/HelpDialog.tsx`): Rika's dialog in Assistant. "Parts of the editor" names every part; "Keyboard shortcuts" lists every key, each in a `Kbd` tinted `brand/12`. `?` opens or closes it except while typing. When a part of the editor is added, renamed or given a shortcut, update this dialog.

### Projects page

`components/Projects.tsx`. One white card on the canvas (`rounded-3xl`, `p-10`), content capped at `max-w-6xl`: the title, a description, **New project** (Catalyst primary) at the right, a separator, then a grid of project cards, columns at least 272px, most recently edited first. A card is an outlined `Item` at `rounded-xl`, the whole card a button; hover turns its border `brand`. Its thumbnail is the first scene, drawn by `FrameView` at the project's aspect ratio on `muted`, with the video's length as a small mono badge in the corner. Under it: an icon tile, the name (one line) and "5 scenes · Edited 2 hours ago". With no projects: an `Empty` state with **New project**. The address is `#/projects`.

### Editor (Scenes)

A grid on the canvas: stage and filmstrip on the left, the side panel and the rail on the right.

- **Stage** (`components/Stage.tsx`): the largest island. A 48px header: "Scene 2 of 5" (`text-sm font-medium tabular-nums`, the total muted), the scene's name, and in scene mode a ghost **Loops / Plays once** toggle. Under it the frame, as large as fits at the project's ratio, on the `tray` with a 16px margin, `rounded-lg shadow-card`. A scene error shows as a red pill at its bottom left. The **transport** runs along the island's bottom edge behind a hairline: This scene / Whole video, a round `primary` play button, the mono timecode, the scrubber, and mute.
- **Scrubber** (`components/Transport.tsx`): the waveform in `foreground/8`, beats and downbeats in `foreground` at 20% and 45%, phrase marks and sound cues in `brand`, the played part in `foreground/55`, cuts as gaps in the track, the playhead in `action` with an `action/20` ring.
- **Filmstrip** (`components/Filmstrip.tsx`): on the canvas under the stage, as in Rika's slide strip. Each scene is a small island tile, 96px tall at the project's ratio, with its number at the bottom left and its name and duration under it (stacked for a portrait tile). The scene on the stage is framed 3px in `action`. Seam badges sit between tiles, coloured by status. The drop indicator while reordering is a 3px `action` bar. **Add scene** is the last tile.
- **Side panel** (`components/SidePanel.tsx`): a tall island, its 48px header lined up with the stage's. The rail picks what it holds:
  - **Chat**: Scene / Project tabs, the name (double-click to rename) and the duration (click to change); a toolbar row with Undo, icon tools and Clear chat; the transcript; the composer.
  - **Soundtrack** and **Sound effects** (`components/AudioPanels.tsx`).
- **Rail**: a slim island at the far right, three Hugeicons buttons; the current one has the `accent` fill. Badges: a spinner while the agent works, an `action` dot for an unread reply, a red dot for a failed analysis, an amber count for cue problems.
- **Drop overlay**: `brand-8` at 70% over everything, a dashed `action` border and one line saying what the drop will do.

### Inside the chat

`components/Chat.tsx`, after Rika's chat.

- **Your turn**: a `muted` bubble on the right, `rounded-3xl`, with the playhead under it.
- **The agent's turn**: the kite mark in a `brand-8` circle, then the steps, the frames it checked, the reply (`RichText`, no bubble) and a muted line with the agent and time.
- **A step** is one line: a chevron if it has details (it opens to show them, mono, on `muted/60`), a dot if not. Its label shimmers while it runs and gets a green check when done; a failed step is red with a warning icon. Once the reply is done the steps fold into "3 steps · 2 frames checked".
- **"Working… 12s"** shimmers, after a spinner, until the reply's text arrives.
- **The composer** is a `rounded-3xl` card: the text on top, under it the agent, model and effort as quiet selects, and one round `action` button at the right: an arrow to send, a square to stop. Enter is a new line; Command+Enter (Control+Enter) sends.
- **"/" lists the tools** (Animate, Design, Sound, and Music in the project chat) when it is the whole input. The chosen tool sits at the start of the line in `brand-text` with its icon, changes the placeholder, stays after sending, and goes with Backspace at the start of the box.
- **"@" lists the scenes**, each with its thumbnail and name, filtered by the number typed; choosing one writes "@Scene 2". A mention of a scene that exists is `brand-text` and a little bolder, in the box (a highlight layer drawn over a transparent-text textarea, as in Rika) and in sent messages.
- **Both lists** open above the box as a `popover` panel at `rounded-xl`; the highlighted row is `accent`. Arrows move, Enter or Tab chooses, Esc closes.
- **Files**: images and audio, by the **+** button, paste, or a drop on the box (the drop overlay says "Drop to attach to your message"). They upload to the project's `assets/` at once, each card with a spinner until done. An image is a 64px thumbnail; audio is a small card with a play button, its name and length. Problems show under the box in `destructive-foreground`. The agent is told the files' paths; it opens images with Read and makes audio a sound or the soundtrack with its tools.
- **Empty**: a title and description over three suggestions as outlined `rounded-xl` rows.

### Render view

`components/RenderView.tsx`. The same white page card as the projects page: the title "Render", what will be rendered, a separator, then the settings card (resolution, frame rate, **Render MP4** in Catalyst `action`, progress in `action`) beside the renders, each a card with its video and file actions.

### Present

Full screen on black. The controls float as a dark rounded pill (`zinc-950/75`, blurred, `shadow-island-stronger`) near the bottom and fade out while the pointer rests.

---

## 5. Components

Components are **shadcn on the Base UI base** (style `base-nova`, `components.json`), copied from Rika into `src/editor/components/ui/`: `Button` (with Catalyst), `Collapsible`, `Dialog`, `Empty`, `Input`, `Item`, `Kbd`, `Select`, `Separator`, `Spinner`, `Textarea`. Kite's own shared pieces live in `src/editor/components/ui.tsx`: `ISLAND`, `ISLAND_HEADER`, `Segmented` (tabs on a `muted` track with a white pill), `Picker` (a `Select` from a list of options; `quiet` for the composer), `Modal` (a `Dialog` that is open while rendered), `Notice` (an error or warning line) and `RichText`.

- **shadcn first.** If shadcn has the component, add it with `npm run shadcn -- add <name>`: it writes to `src/editor/components/ui/` on Base UI and imports `cn`. Do not hand-build a styled `div` or `button` where a component exists. The CLI may rewrite tokens in `styles.css` when a preset is applied; Kite's values win, so check the diff.
- **The copied kit is exempt from the token rules.** Its files keep shadcn's own `oklch()` literals (the Catalyst recipes) and `dark:` variants, so they stay easy to compare with upstream; `dark:` does nothing because `.dark` is never set. Kite's own components follow section 1.
- **`components.json` asks for Hugeicons**, so added components draw their icons with `@hugeicons/react`, which is installed. Swap them for Heroicons where Heroicons has the icon, to match the rest of the UI.
- **Override, do not fork.** When a stock component does not fit, pass `className` or edit the copied file, and say why in a comment.
- **Two button styles.** Stock shadcn for everyday controls; `<Button catalyst>` for a screen's main action (Present, Render MP4, Create project, Save art direction). `color="action"` is the blue one.
- **Base UI, not Radix.** Custom triggers use the `render` prop; a `Button` rendered as a link needs `nativeButton={false}`.
- **Icons are Heroicons** (`@heroicons/react`), `16/solid` in buttons and small controls. When Heroicons lacks one, take it from Hugeicons (`@hugeicons/react` + `@hugeicons/core-free-icons`), as the rail does. Do not draw one by hand.

Every screen:

- **One primary action**, and its label says what happens: "Render MP4", "Create project". Never "Submit" or "OK".
- **Every interactive element shows keyboard focus** (a global `:focus-visible` outline in `ring`). The project-name field is the one exception: it reads as text.
- **Every input has a real `<label>`**, `sr-only` where the placeholder is enough.

---

## 6. Logo

| Asset | Where | Notes |
| --- | --- | --- |
| The mark, in code | `KiteMark` in `src/editor/components/Logo.tsx` | A diamond kite, its sail split in four by the spars (drawn as gaps), tilted 18° to the left, on a curving tail. `currentColor` |
| Browser tab icon | `public/favicon.svg` | the navy mark on a rounded flagship-sky tile |
| Wordmark | none, it is text | "Kite" in `font-brand text-xl font-medium tracking-tight` next to the mark |

- The favicon draws the same shapes as `Logo.tsx`; change them together.
- **One flat colour**, no gradient or outline. In the navbar it is `brand-text`; in the footer `muted-foreground`; on the flagship sky it is `navy`.
- Smallest size: 16px.

---

## 7. Voice

- **Short, plain sentences.** Sentence case everywhere: headings, buttons, labels.
- **Errors say what happened and what to do next.** No apologies, no "something went wrong".
- **No exclamation marks, no emoji in the UI.**
- **No hype words:** "AI-powered", "magic", "seamless".
- Say **project** for a video being made, **scene** for one part of it, **cut** for where two scenes meet, **render** for an exported MP4. The assistant is "the agent".

---

## 8. Dark mode

Not supported, as in Rika: `:root` sets `color-scheme: light` and the theme picker is gone. Components use the semantic tokens, never raw `zinc-*` for surfaces or text, so a `.dark` block can invert them in one place later.

---

## 9. Motion

Rika's named animations live in `styles.css`; prefer them over ad-hoc durations: `animate-bar-in`/`out` (toasts), `animate-text-shimmer` (running steps, "Working…"), `animate-card-in`/`out`, `animate-shake`, `animate-marching-ants`, `animate-mark-spin`. Messages enter with a short fade and rise (`animate-in fade-in-0 slide-in-from-bottom-1`).

One global rule switches off every animation and transition under `prefers-reduced-motion: reduce`. Keep new motion quiet and quick: nothing that bounces, and nothing that loops fast enough to distract from a scene.

---

## 10. Principles

1. **The video is the star.** The app steps back around the user's work.
2. **Neutral canvas, colour for meaning.** Grey by default; a hue almost always encodes status. One brand accent, used sparingly.
3. **Tokens over literals.** If you are typing an `oklch()` or a hex in a component, stop and use or extend a token.
4. **Quiet weight.** Medium-weight headings, hairline borders, soft island shadows.
5. **Match before you invent.** Find the nearest pattern here or in Rika's `DESIGN.md`. If nothing fits, write the new rule here, then build.

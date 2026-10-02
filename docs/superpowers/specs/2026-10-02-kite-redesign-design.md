# Kite redesign: Rika's design system on the Storyboard editor

Status: approved in chat 2026-10-02. Branch: `redesign`.

## Goal

Make this app the user's own studio tool, **Kite**: the Storyboard editor's behaviour, wearing the design system of the user's sister app Rika (`../rika`, `DESIGN.md` there), with a sky-blue brand. Design only: no new editing features.

## Decisions (from the user)

| Topic | Decision |
| --- | --- |
| Brand | New studio brand, name **Kite**, accent **sky blue**, mark is a kite (diamond with a tail) |
| Stack | Same as Rika: Tailwind v4, shadcn on Base UI, Heroicons (Hugeicons where Heroicons has no icon) |
| Theme | Light only, like Rika. The system/light/dark picker is removed |
| Layout | Rika's layout adapted to Kite's editor (stage, filmstrip, side panel, rail); Kite's own arrangement where Rika's does not fit |

## Assumptions (not stated by the user)

- The rename is **UI only**: page title, navbar, footer, help, welcome copy. The CLI (`./storyboard`), docs, README, agent prompts, `package.json` name and `localStorage` keys (`sb:*`) keep "Storyboard" for now; renaming them is a later, separate pass.
- No behaviour changes: same API calls, same store, same keyboard shortcuts, same drag-and-drop. The only server change is extra fields on the project summary for the projects grid.
- The app still opens on the last project (as today). The projects page is reached from the navbar and is shown when there are no projects.

## 1. Foundation

**Dependencies added** (`npm install --ignore-scripts`, lockfile diff shown to the user): `tailwindcss`, `@tailwindcss/vite`, `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `shadcn` (for `shadcn/tailwind.css` only), `@heroicons/react`, `@hugeicons/react`, `@hugeicons/core-free-icons`, `@fontsource-variable/sora`, `@fontsource-variable/geist-mono`, `@fontsource-variable/assistant`. Chat Markdown keeps Kite's existing `RichText`; no Markdown library is added.

**Removed at the end:** `lucide-react`, `@fontsource-variable/jetbrains-mono`, `@fontsource-variable/geist` (if unused).

**Wiring**

- `server/vite.ts` adds `tailwindcss()` to `plugins`.
- `src/editor/styles.css` imports `tailwindcss` with `source(none)` and `@source` pointing at `src/editor/` only. Scenes under `projects/`, `src/frame/` and `frame.html` never load Tailwind, so preview, capture and render output cannot change.
- Alias `@/` → `src/editor/` in `tsconfig.json` `paths` and in `server/vite.ts` `resolve.alias`.
- shadcn components copied from Rika's `src/components/ui/` into `src/editor/components/ui/`: `button` (with the Catalyst variant), `dialog`, `badge`, `item`, `empty`, `input`, `textarea`, `select`, `separator`, `spinner`, `kbd`, `collapsible`, plus `lib/utils.ts` (`cn`). Their `lucide-react` imports become Heroicons.
- `components.json` added so `shadcn add` works later.
- Prettier covers the new files (existing `format` globs already match `src/**`).

## 2. Tokens

`src/editor/styles.css` is replaced by Rika's `src/styles.css`: zinc semantic tokens, `tray`/`line`/`ink` greys, island and card shadows, `--radius` 8px and the derived scale, motion tokens and keyframes, global `:focus-visible`, text wrapping, the reduced-motion rule. `color-scheme: light`.

**Brand ramp, hue 235.** Rika's lightness/chroma steps, with steps 2 and 3 darkened so contrast holds for blue (chroma clamped to sRGB):

| Token | Value | Hex | Role |
| --- | --- | --- | --- |
| `brand-1` | `oklch(0.355 0.074 235)` | `#02415d` | deep accents |
| `brand-2` | `oklch(0.45 0.094 235)` | `#045c82` | brand text (`--brand-text`), 7.31 on white |
| `brand-3` | `oklch(0.555 0.116 235)` | `#077cad` | fill step (`action`, `ring`), white labels at 4.65 |
| `brand-4` | `oklch(0.632 0.133 235)` | `#0695ce` | hover of the fill |
| `brand-5` | `oklch(0.776 0.114 235)` | `#65c2f4` | tint |
| `brand-6` | `oklch(0.84 0.079 235)` | `#98d3f7` | tint |
| `brand-7` | `oklch(0.914 0.041 235)` | `#c9e8fa` | tint |
| `brand-8` | `oklch(0.96 0.019 235)` | `#e6f4fd` | soft background |
| `brand` (flagship) | `#3cbbf9` | | logo, hover borders. Never carries white text (2.17) |
| `navy` | `oklch(0.25 0.08 235)` | | ink on the flagship (7.30) |

Status colours stay on Tailwind's scales as in Rika (`success`, `warning`, `info`, `destructive`, each with a `-foreground` text step). Kite-specific status (seam tones, rail badges, error banners) map onto these tokens.

**Fonts:** UI in the Apple system font then Inter; **Sora** for the "Kite" wordmark only; **Geist Mono** for timecodes, durations and code; **Assistant** for the help dialog.

**Removed:** `src/editor/theme.ts`, `src/editor/theme.test.ts`, the `theme` state and `setTheme` in `store.ts`, the theme script in `index.html`, the theme picker in the top bar.

## 3. Layout

The page is the `muted` grey canvas. Parts are white islands (`rounded-3xl bg-background shadow-xs ring-1 ring-foreground/5`), 12px apart and 12px in from the screen edges. The editor fills the screen and never scrolls as a page.

**Navbar** (straight on the canvas, no bar of its own; Rika's `Navbar`):
- Left: kite mark + "Kite" (Sora) as a link to Projects, vertical separator, **Projects** link, then `/` and the project's name, edited in place (borderless input, `api.updateProject` rename).
- Then the view tabs **Scenes** and **Render** as navbar links (current one tinted `foreground/5`, Rika's section style).
- Right: **Art direction** and **Copy path** as ghost buttons, **New project** as an outline button, **Present** as the screen's one primary action: `<Button catalyst color="action">`.

**Projects page** (replaces the project `<select>` and today's `Welcome`): Rika's `AppLayout` card ("Projects", "Each project is one video.", New project at the right). Rika's file-card grid, columns ≥ 272px, most recently edited first. Each card: a thumbnail of the first scene drawn by `FrameView` in `thumb` mode at the project's aspect ratio on `muted`, then a 32px icon tile, the name, and "4 scenes · 32.0s · Edited 2 hours ago". Hover turns the border `brand`. Empty state: "No projects yet" with New project. Reached via `#/projects`; opening a card goes to `#<project>` as today.

**Server change for the grid:** `ProjectSummary` gains `width`, `height` and `firstScene: { id: string; duration: number } | null`, filled in `ProjectStore.list()`.

**Editor** (view = Scenes), a grid on the canvas:
- **Stage island** (left, top): 48px header with "Scene 2 of 5" (`text-sm font-medium tabular-nums`, total in `muted-foreground`), the scene name and the loop toggle; the frame centred on a `muted` area below it; the transport along the island's bottom edge. Scene errors show under the frame in `destructive-foreground`.
- **Filmstrip island** (under the stage, same width): Rika's strip tiles (`rounded-xl`, 16:9 or the project's ratio), the selected scene framed 3px in `action`, scene number and duration under each, seam badges between tiles coloured by status tokens, the drop indicator in `action`, and an "Add scene" tile at the end.
- **Side island** (right, full height, `clamp(400px, 34vw, 460px)` as today): 48px header matching the stage's. Chat panel: Scene/Project segmented control, title (rename on double-click) and duration, toolbar with Undo and icon buttons. Soundtrack and Sound effects panels in the same island.
- **Rail**: a slim island right of the side island, icon buttons (ghost; current one `accent` fill), the same badges (spinner, unread dot in `brand`, error dot, problem count).

**Render view:** the navbar stays; the body is Rika's `AppLayout`-style card titled "Render" holding the existing settings, jobs and files, restyled.

**Footer** (Rika's): edge-to-edge bar, kite mark, "Kite © year · tagline" (tagline: "Every frame is code.", in the system serif italic), and **Help**.

**Help dialog** (Rika's `HelpDialog`, `?` from anywhere except while typing): "Parts of the editor" (navbar, stage, transport, filmstrip, seams, side panel, rail, render) and "Keyboard shortcuts" (Space, ← →, Shift+← →, ↑ ↓, Home, ?), keys in `Kbd` tinted `brand/12`, Cmd/Ctrl spelled for the platform.

**Present:** full screen as today; controls restyled as floating islands (`shadow-island`).

**Below `lg`:** not a target for the editor (it is a desktop tool today and stays one); the projects page and dialogs work at phone width.

## 4. Components

- **Chat:** Rika's look over Kite's behaviour. Your turn: `muted` bubble on the right. Agent turn: the kite mark in a `brand-8` circle, then the reply (existing `RichText`) without a bubble, then the steps in order: one line each, label shimmering while running (`animate-text-shimmer`), green check when done, `destructive-foreground` warning on error, detail in a `Collapsible`. Capture frame strips and the image viewer keep working. Ideas list, elapsed time, Stop, model/effort/provider pickers stay, restyled. The composer is Rika's `rounded-3xl` card with the round `action` send/stop button. Keyboard behaviour stays as Kite has it.
- **Dialogs** (New project, Art direction, chat image viewer, any `Modal`): shadcn `Dialog`, `rounded-xl`, title `font-heading text-base font-medium`.
- **Buttons:** stock shadcn `Button` everywhere; Catalyst only for Present and each dialog's primary action. Labels say exactly what happens.
- **Inputs, selects, textareas:** shadcn components, each with a real `<label>` (`sr-only` where the placeholder is enough).
- **Segmented controls** (Scene/Project, render settings): a small shadcn-styled tab group on `muted` with a white active pill.
- **Transport:** play button as a round icon button, timecodes in Geist Mono `tabular-nums`, the timeline track and playhead in tokens, the playhead in `action`.
- **Audio panels:** sections as cards (`shadow-card`), waveform and beat grid in neutrals with `action` for the playhead and markers.
- **Toasts:** bottom-centre floating islands (`shadow-island-stronger`), `animate-bar-in`/`out`, error tone in `destructive-foreground`, the action as a ghost button.
- **Drop overlay:** `brand-8` fill with a marching-ants border in `action`.
- **Icons:** Heroicons `16/solid` in buttons, `24/outline` larger; Hugeicons where Heroicons has none.
- **Voice:** sentence case, no exclamation marks or emoji, errors say what happened and what to do.

## 5. Docs

- `DESIGN.md` at the repo root: Kite's design system, adapted from Rika's (sky brand, Kite layout, components above).
- `AGENTS.md` map: mention `DESIGN.md`, Tailwind wiring in `server/vite.ts`, the `@/` alias and `src/editor/components/ui/`.

## Out of scope

Renaming the CLI, docs, agent prompts or storage keys; dark mode; mobile editor; chat `/` and `@` features; a branded welcome "stage" page; any change to scenes, frames, capture, render or audio behaviour.

## Done when

1. `npm run typecheck`, `npm test` and `npm run format:check` pass.
2. No `lucide-react` import remains; no hex or `oklch()` literal in editor components (tokens only, except the logo).
3. The app runs (`PORT=5299 npm run dev`) and each view is checked in the browser with a screenshot: projects page, empty projects page, editor, chat during and after a turn, soundtrack panel, sound effects panel, render view, New project and Art direction dialogs, help dialog, present mode, a toast, the drop overlay.
4. A frame renders identically before and after (one `frame.html` capture of the example project compared pixel for pixel), proving Tailwind does not reach scenes.

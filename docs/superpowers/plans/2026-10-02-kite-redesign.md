# Kite redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the editor UI (`src/editor/`) on Rika's design system (Tailwind v4 + shadcn/Base UI + Heroicons) with the Kite brand, without changing behaviour.

**Architecture:** Tailwind is added as a Vite plugin in `server/vite.ts` and scans only `src/editor/`. Rika's tokens replace `src/editor/styles.css`; Rika's shadcn components are copied into `src/editor/components/ui/`. Every editor component is rewritten in Tailwind classes, one area at a time; store, API, events and audio code stay as they are.

**Tech Stack:** React 19, zustand, Vite 8 (middleware mode), Tailwind v4, Base UI, class-variance-authority, Heroicons, Hugeicons.

**Spec:** `docs/superpowers/specs/2026-10-02-kite-redesign-design.md`

## Global Constraints

- Install with `npm install --ignore-scripts <pkg>@<version>` only; never `npx` packages not in `node_modules`.
- Tailwind must not reach `frame.html`, `src/frame/`, `src/runtime/` or `projects/`: `@import 'tailwindcss' source(none)` plus `@source "."` in `src/editor/styles.css`.
- Light only: `color-scheme: light`; no `dark:` styles used.
- No hex or `oklch()` literals in components; tokens only (exceptions: logo SVG, the black present-mode backdrop and white video letterbox, which are content, not chrome).
- Brand values exactly as the spec's table (hue 235; `brand` = `#3cbbf9`; `action` = `brand-3`; `--brand-text` = `brand-2`).
- UI copy: sentence case, no exclamation marks, no emoji. The product name in the UI is "Kite".
- `localStorage`/`sessionStorage` keys stay `sb:*`.
- Prettier width 130 (`npm run format`).

## Review Focus

1. **Scene previews unchanged** — a frame of the example project captured before and after must be pixel-identical (Tailwind preflight must not leak into iframes). Checked in Task 9 with `.capture-frames.mjs` + pixelmatch.
2. **Keyboard shortcuts still work and don't fire while typing** — Space/arrows/Home in the editor, `?` for help; typing `?` or space in the chat composer or project-name input must not trigger them. Checked in Task 9 in the browser.
3. **Drag and drop** — dropping an audio file anywhere sets the soundtrack; on the Sound effects panel/rail button adds sounds; reordering scenes in the filmstrip still works. Checked in Task 9.
4. **Long names and many scenes** — a long project or scene name truncates instead of breaking the navbar/side header; 5+ scenes scroll the filmstrip sideways. Checked in Task 9 by renaming.
5. **Modal focus & Escape** — dialogs close on Escape and backdrop click; Cmd+Enter saves Art direction; Enter creates a project. Checked in Task 9.

---

### Task 1: Foundation (deps, Tailwind wiring, tokens, ui kit)

**Files:**
- Modify: `package.json`, `package-lock.json`, `server/vite.ts`, `tsconfig.json`, `src/editor/main.tsx`, `index.html`
- Replace: `src/editor/styles.css`
- Create: `components.json`, `src/editor/lib/utils.ts`, `src/editor/components/ui/{button,badge,collapsible,dialog,empty,item,input,kbd,select,separator,spinner,textarea}.tsx`

- [ ] Install: `npm install --ignore-scripts tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3 @base-ui/react@^1.8.0 class-variance-authority@^0.7.1 clsx tailwind-merge tw-animate-css@^1.4.0 shadcn@^4.21.1 @heroicons/react@^2.2.0 @hugeicons/react@^1.1.10 @hugeicons/core-free-icons@^4.3.5 @fontsource-variable/sora @fontsource-variable/geist-mono @fontsource-variable/assistant`
- [ ] `server/vite.ts`: `import tailwindcss from '@tailwindcss/vite'`; `plugins: [react(), tailwindcss(), storyboardPlugin()]`; alias `'@': path.join(ROOT, 'src/editor')`.
- [ ] `tsconfig.json` paths: `"@/*": ["./src/editor/*"]`.
- [ ] `src/editor/lib/utils.ts`: `export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }`
- [ ] `styles.css`: Rika's file with `@import 'tailwindcss' source(none); @source '.';`, Kite font imports, brand ramp at hue 235, `navy`, `--brand-text`, everything else verbatim.
- [ ] Copy the 12 ui components from `../rika/src/components/ui/`, change `from "cn"` to `from '@/lib/utils'`, swap any `lucide-react` icon for Heroicons.
- [ ] `index.html`: title "Kite", remove the theme script, favicon `public/favicon.svg`; `main.tsx` imports `./styles.css`.
- [ ] Run `npm run typecheck` → PASS. Commit.

### Task 2: Brand, shell and projects page

**Files:**
- Create: `src/editor/components/Logo.tsx` (`KiteMark`), `public/favicon.svg`, `src/editor/components/Navbar.tsx`, `src/editor/components/Footer.tsx`, `src/editor/components/HelpDialog.tsx`, `src/editor/components/ProjectName.tsx`, `src/editor/components/Projects.tsx`, `src/editor/components/Toasts.tsx`
- Modify: `src/editor/App.tsx`, `src/editor/store.ts` (`View` gains `'projects'`; `writeHash`/hash parsing handle `#/projects`; theme removed), `src/shared/types.ts` (`ProjectSummary` gains `width`, `height`, `firstScene`), `server/projects.ts` (`list()` fills them), `src/editor/components/TopBar.tsx` (deleted; `FILE_MANAGER`/`revealFile` move to `src/editor/lib/files.ts`)
- Delete: `src/editor/theme.ts`, `src/editor/theme.test.ts`

- [ ] Server: in `ProjectStore.list()` add `width: project.width, height: project.height, firstScene: scenes[0] ? { id, duration } : null`. Add a test in `server/projects.test.ts` if one exists for `list()`; otherwise assert via `curl /api/projects` in Task 9.
- [ ] Navbar: mark + "Kite" (button to Projects), separator, Projects link, then (with a project) `/` + `ProjectName` + Scenes/Render links; right: Art direction, Copy path (ghost), Present (Catalyst `action`).
- [ ] Projects page: `AppLayout`-style card, grid `grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]`, `FrameView` thumbs, empty state.
- [ ] Footer + HelpDialog with Kite's parts and shortcuts.
- [ ] Typecheck, test, commit.

### Task 3: Stage, transport, present

**Files:** Modify `src/editor/components/Stage.tsx`, `Transport.tsx`, `Present.tsx`, `ui.tsx` (`Segmented` in Tailwind)
- [ ] Stage island with 48px header; frame on `muted` area; error line; transport inside the island bottom.
- [ ] Scrubber restyled with tokens (`--color-action` playhead, `brand` phrase/sound markers).
- [ ] Present controls as a floating dark island.
- [ ] Typecheck, commit.

### Task 4: Filmstrip

**Files:** Modify `src/editor/components/Filmstrip.tsx`
- [ ] Island, Rika tiles (`rounded-xl`, `ring-3 ring-action` selected), seam badges with status tokens, drop indicator `bg-action`, Add scene tile.
- [ ] Typecheck, commit.

### Task 5: Side panel, rail and chat

**Files:** Modify `src/editor/components/SidePanel.tsx`, `Chat.tsx`
- [ ] Side island + 48px header; Scene/Project segmented; toolbar; rail island with badges.
- [ ] Chat in Rika's style: user bubble `bg-muted rounded-3xl`, agent mark tile, steps with `Shimmer` and check, composer `rounded-3xl` with round `action` send/stop.
- [ ] Typecheck, commit.

### Task 6: Audio panels

**Files:** Modify `src/editor/components/AudioPanels.tsx`
- [ ] Panels in Tailwind; waveform, window and section lines in tokens; shadcn inputs.
- [ ] Typecheck, commit.

### Task 7: Render view, modals, drop overlay

**Files:** Modify `RenderView.tsx`, `Modals.tsx`, `ui.tsx` (`Modal` → shadcn `Dialog`), `App.tsx`
- [ ] Render page card; dialogs on shadcn `Dialog`; drop overlay `bg-brand-8/80` with dashed `action` border.
- [ ] Typecheck, commit.

### Task 8: Cleanup and docs

- [ ] `npm uninstall lucide-react @fontsource-variable/jetbrains-mono @fontsource-variable/geist` (only those no longer imported; check with grep).
- [ ] `grep -rn "lucide-react\|#[0-9a-fA-F]\{3,6\}\b\|oklch(" src/editor/components` → only allowed exceptions.
- [ ] Write `DESIGN.md`; update `AGENTS.md` map.
- [ ] `npm run format`, `npm run typecheck`, `npm test`, `npm run format:check` → PASS. Commit.

### Task 9: Verification

- [ ] `node .capture-frames.mjs http://127.0.0.1:5299 <after>`; compare each PNG with pixelmatch against `<before>` → 0 differing pixels.
- [ ] Screenshot every view listed in the spec's "Done when" and look at each.
- [ ] Walk the Review Focus list in the browser.
- [ ] Delete the temporary `.capture-frames.mjs` and `.shot.mjs`.
- [ ] Final whole-branch review by a fresh reviewer; fix findings; commit.

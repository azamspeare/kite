# Art direction — Kite teaser

Light, precise, product-first. One idea per scene; the cut between scenes should be invisible whenever an object carries on.

## Canvas & palette
- Background `#fafafa` in every scene (never pure white — it makes cuts between scenes seamless and keeps white UI cards visible).
- Ink `#0a0a0a`; secondary text `#8a8a8f`; quiet text `#a1a1aa`; hairlines `#e6e6e9`.
- One accent: pink `#ff2e88` — only for annotations, flashes, the playhead-style highlights and the logo's middle clip. Playhead/active-time blue `#3b82f6` appears only in the timeline.

## Type
- Headlines: Inter Variable 700, 104 px, letter-spacing −0.045em, line-height 1, centred with the line box top at y = 118 (shared by every scene via `components/Headline.tsx`).
- The headline is a running sentence: "Every …" stays, the tail swaps (scene is code → part in its place → style → beat.). Old words lift away first, the line re-centres, then new words rise in (`swapWords`).
- Sublines: Inter 600, 46 px, −0.03em, `#a1a1aa`.
- UI text inside cards: Inter 15–23 px; labels/tags in JetBrains Mono (uppercase, +0.1em tracking for pills).
- Callout labels: Inter 500, 22 px, `#3f3f46`.

## Layout
- The prompt card rests at x 620, y 432, 680 × 340 (`CARD` in `components/tokens.ts`); reuse it rather than re-placing it.
- Generous margins: nothing closer than ~120 px to the canvas edge except full-bleed moments.

## Motion
- Entrances: `ease.outExpo` (0.4–0.9 s) or springs for physical UI; exits: `ease.inCubic`, faster than entrances (0.25–0.45 s).
- Big transforms and camera-like moves (tilts, lifts): `ease.smooth`.
- Stagger related items 45–100 ms; overlap moves instead of queueing them.
- Style changes wipe left → right with a thin pink scan line instead of cross-fading colours.
- Callout lines draw from the part outward (dot → elbow → label), labels fade in last and leave first.

## Music
- Interaction beats ride the grid: clicks snap to half-beats (`music.snap(t, 'half')`), keyframes snap to beats, the logo clips nudge on bar lines (`music.pulse(t, { grid: 'bar' })`). Without a track the grid is 120 BPM from each scene start.

## Seams
- Every cut in this project is designed to be invisible (0 % with `check_seams`): the last frame of each scene is rebuilt exactly by the next scene's first frame (same components, same positions, no leftover transforms).

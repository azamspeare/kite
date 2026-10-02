/** Marks the project CLAUDE.md and AGENTS.md guides as managed: Kite refreshes it on start. Delete the line to keep your own edits. */
export const GUIDE_MARKER = '<!-- kite:managed-guide v3 -->';

export function starterScene(name: string): string {
  const text = JSON.stringify(name);
  return `import { Fill, ease, progress, type SceneProps } from 'kite';

export default function Scene({ t, duration }: SceneProps) {
  const enter = progress(t, 0.1, 0.9, ease.outExpo);
  const exit = progress(t, duration - 0.35, duration, ease.inCubic);
  return (
    <Fill center style={{ background: '#fafafa' }}>
      <div
        style={{
          fontSize: 112,
          fontWeight: 680,
          letterSpacing: '-0.045em',
          color: '#0a0a0a',
          opacity: enter * (1 - exit),
          transform: \`translateY(\${(1 - enter) * 28}px)\`,
        }}
      >
        {${text}}
      </div>
    </Fill>
  );
}
`;
}

export const ART_DIRECTION_TEMPLATE = `# Art direction

The agent reads this before every edit. Describe the look and feel every scene should share.

- **Palette:** near-white background (#fafafa), ink #0a0a0a, secondary text #8a8a8a, one accent (#ff2e88) used sparingly for annotations.
- **Type:** Inter Variable. Headlines 96–140 px, weight 650–720, letter-spacing −0.045em, tight line-height (1.0). Labels 18–24 px, weight 500.
- **Motion:** calm and precise. Entrances 0.5–0.9 s with ease.outExpo or ease.standard; exits quicker (0.25–0.4 s, ease.inCubic). Springs only for physical UI objects. Stagger related items 40–70 ms.
- **Layout:** generous whitespace, one idea per scene, centered compositions unless a scene says otherwise.
- **Cuts:** hide cuts by matching the last frame of a scene to the first frame of the next whenever the same object continues.
`;

export const SCENE_GUIDE = `${GUIDE_MARKER}
# Kite projects

This folder holds Kite video projects (a prompt-driven motion-design editor). A video is an ordered list of scenes; every scene is a React component that renders one frame for a given time. Each project folder contains:

- \`project.json\` — name, canvas size, fps, the ordered scene list (\`id\`, \`name\`, \`duration\` in seconds) and the music reference. While the app is running, change structure and timing through the Kite tools (set_scene_duration, create_scene, move_scene, …) rather than editing this file by hand.
- \`scenes/<id>.tsx\` — one component per scene.
- \`components/\` — optional components shared by several scenes (import them relatively).
- \`assets/\` — images/SVGs, referenced with \`asset('file.png')\`.
- \`art-direction.md\` — the visual rules every scene follows. Read it before designing.
- \`music/\`, \`music.json\` — the soundtrack and its beat analysis.
- \`sounds/\` — the sound-effect library: audio files the user adds, plus \`sounds.json\` (synth recipes and generated sounds, managed by the tools; don't edit it by hand).
- \`renders/\` — exported videos. \`.kite/\` — internal (chats, undo, caches); never touch.

## The scene contract

\`\`\`tsx
import { Fill, SplitText, ease, interpolate, progress, spring, springs, type SceneProps } from 'kite';

export default function Anatomy({ t, duration, music }: SceneProps) {
  const enter = progress(t, 0.1, 0.8, ease.outExpo);            // 0 → 1
  const lift = spring(t - music.beat(2), { from: 60, to: 0, ...springs.snappy });
  const exit = progress(t, duration - 0.3, duration, ease.inCubic);
  return (
    <Fill style={{ background: '#fafafa' }} center>
      <h1 style={{ margin: 0, fontSize: 120, fontWeight: 700, letterSpacing: '-0.045em',
                   opacity: 1 - exit, transform: \`translateY(\${lift}px)\` }}>
        <SplitText text="Every part in its place" by="words" piece={(i) => {
          const p = progress(t, 0.1 + i * 0.05, 0.7 + i * 0.05, ease.outExpo);
          return { opacity: p * enter, transform: \`translateY(\${(1 - p) * 30}px)\` };
        }} />
      </h1>
    </Fill>
  );
}
\`\`\`

- The default export receives \`SceneProps\`: \`t\` (seconds since the scene started, 0 → \`duration\`), \`duration\`, \`width\` × \`height\` (the canvas in CSS px, usually 1920 × 1080), \`fps\`, \`music\` (beat grid, below) and \`scene\` (\`id\`, \`name\`, \`index\`, \`count\`, \`start\`).
- **Everything must be a pure function of the props.** Frames are rendered out of order and one at a time. No \`useState\`/\`useEffect\`-driven animation, timers, \`requestAnimationFrame\`, \`Date.now()\`, \`Math.random()\` (use \`random(seed)\`), CSS \`transition\`/\`animation\`/\`@keyframes\`, videos, or network requests.
- Import only from \`react\`, \`kite\` and relative files inside the project.
- Style with inline \`style={{…}}\` (a \`<style>\` tag with static CSS is fine). Position with absolute layout on the fixed canvas; animate with \`transform\`, \`opacity\`, \`filter\`, \`clip-path\`, SVG attributes (e.g. \`strokeDashoffset\` for line drawing). CSS 3D (\`perspective\`, \`preserve-3d\`, \`rotateX/Y\`, \`translateZ\`) works.
- Fonts: \`'Inter Variable'\` (100–900 with optical sizing, so large sizes get the Display cut), \`'Geist Variable'\`, \`'JetBrains Mono Variable'\`. Nothing else loads.
- Paint your own background with a full-bleed \`<Fill>\`; the stage default is white.
- Rebuild UI in code (cards, inputs, buttons, charts) rather than using screenshots, so every element can move independently and stays crisp.

## \`kite\` runtime

- \`progress(t, start, end, easing?)\` → 0…1, clamped and eased. The workhorse.
- \`interpolate(t, [t0, t1, …], [v0, v1, …], { easing?: e | e[], clamp?: true })\` → multi-stop mapping (per-segment easings allowed).
- \`keyframes(t, [[time, value], [time, value, easing], …])\` → same idea as tuples.
- \`spring(tSinceStart, { from, to, stiffness, damping, mass, velocity })\` → exact damped spring; \`springs.smooth | snappy | gentle | bouncy\`; \`springDuration(config)\`.
- \`ease.*\`: \`linear\`, \`in/out/inOut\` × \`Sine Quad Cubic Quart Quint Expo Circ Back\`, \`outElastic\`, \`outBounce\`, \`standard\` (UI default), \`decelerate\`, \`accelerate\`, \`smooth\` (camera moves), \`css\`, \`bezier(x1,y1,x2,y2)\`, \`backOut(overshoot)\`, \`steps(n)\`.
- \`mix(a, b, p)\`, \`clamp(v, min, max)\`, \`stagger(i, each, start)\`, \`staggerFrom(i, count, each, 'center')\`, \`loop(t, period)\`, \`pingpong(t, period)\`.
- \`mixColor(a, b, p)\`, \`interpolateColor(t, times, colors, opts)\`, \`withAlpha(color, a)\` (hex / rgb / rgba).
- \`random(seed)\` → deterministic 0…1, \`randomRange(seed, min, max)\`, \`noise(x, seed)\` → smooth −1…1 for gentle drift.
- \`<Fill center? style>\` full-canvas layer, \`<SplitText text by="chars"|"words" piece={(i, count, text) => style}>\` for kinetic type, \`typed(text, p)\` for typewriter text, \`asset('logo.svg')\`, \`useScene()\` (props in nested components).
- \`measureText(text, { fontSize, fontWeight, letterSpacing, fontFamily })\` → \`{ width, height }\` in canvas px, measured by the renderer itself — for centering, underlines, or animating between word widths.

## Music

\`music\` exposes the soundtrack in **scene-local seconds**: \`bpm\`, \`beatLength\`, \`beats\`, \`downbeats\`, \`phrases\`, \`sections\`, \`accents\`, plus \`music.beat(n)\` / \`music.bar(n)\` / \`music.phrase(n)\` (nth grid point at or after the scene start; fractional n works), \`music.snap(t, 'beat'|'bar'|'phrase'|'half'|'quarter')\`, \`music.pulse(t, { grid, decay })\` (1 on each hit, decaying) and \`music.beatPhase(t)\`. Key important moments to the grid (\`music.bar(1)\`, \`music.beat(3)\`) instead of hard-coded seconds so they stay locked when cuts move. Without a track (\`music.hasTrack === false\`) the grid is a steady 120 BPM from t = 0.

## Sound effects

A scene plays sound effects by exporting \`sounds\`: cues in scene-local seconds. Name each moment once and use it in both the component and \`sounds\` (never copy numbers between them), so picture and sound stay locked when timing changes.

\`\`\`tsx
import { progress, type SceneProps, type SceneSounds, type SoundProps } from 'kite';

// Every moment the animation and the sounds share, from one place.
const moments = ({ music }: SoundProps) => ({ type: music.beat(2), key: music.beatLength / 4, send: music.bar(1) });

export const sounds: SceneSounds = (props) => {
  const m = moments(props);
  return [
    ...'8.8.8.8'.split('').map((_, i) => ({ at: m.type + i * m.key, sound: 'key', pitch: (i % 3) - 1, volume: 0.8 })),
    { at: m.send, sound: 'enter' },
    { at: m.send + 0.35, sound: 'whoosh', align: 'peak' },
  ];
};

export default function Request(props: SceneProps) {
  const m = moments(props);
  const rise = progress(props.t, m.send, m.send + 0.7);
  // …
}
\`\`\`

- Cue fields: \`at\` (scene seconds; negative starts before the cut), \`sound\` (a name from the library), \`volume\` (1 = as made), \`pitch\` (semitones; also changes the length), \`pan\` (−1 … 1), \`align\` (\`'start'\`, or \`'peak'\` to land the sound's loudest moment on \`at\`, for whooshes, risers and swells) and \`duration\` (cut it short).
- \`sounds\` is an array, or a function of the scene props without \`t\` (\`SoundProps\`: \`duration\`, \`music\`, \`scene\`, …). Keep it pure, like the component.
- The library (\`sounds/\`) holds synth sounds (\`create_sound\`: presets like click, keystroke, pop, blip, ping, whoosh, riser, impact, thud, sparkle), generated sounds (\`generate_sound\`, while the sound-effects engine runs) and audio files the user drops in, named by their file name without the extension.
- The preview and renders mix every cue with the soundtrack (−1 dBFS limiter, fade at the very end). You can't hear it: \`check_audio\` reports how each cue cuts through the mix.

## Seams

Scenes play back to back with hard cuts. When an object continues across a cut, the last frame of the earlier scene (t = duration) must be pixel-identical to the first frame (t = 0) of the next: same positions, sizes, colors, weights, shadows. \`check_seams\` measures it; 0 % means the cut is invisible. If a cut is meant to be a visible change, say so rather than chasing 0 %.

- At rest, render the shared pose flat on both sides of the cut: no leftover \`perspective\`/\`preserve-3d\`/\`translateZ\`, filters or wrapper transforms (composited layers anti-alias text differently, which shows up as a small diff).
- Put values that must match across scenes (positions, sizes, copy, colors) in \`components/\` and import them from both scenes; don't import one scene from another.

## Tools (MCP server \`kite\`)

- \`render_frames\` — render frames of a scene at the times you choose and look at them. Always check your work visually: the start, the end, and each moment you changed.
- \`check_seams\` — pixel-diff the cuts into and out of a scene (or all cuts).
- \`get_project\`, \`get_music_context\` — structure, timing, file paths; tempo/beats/phrases in scene-local time.
- \`set_scene_duration\`, \`create_scene\`, \`duplicate_scene\`, \`delete_scene\`, \`move_scene\`, \`rename_scene\` — timing and structure.
- \`generate_music\`, \`wait_for_music\`, \`list_music_takes\`, \`describe_music_take\`, \`use_music_take\`, \`repaint_music\` — compose and choose the soundtrack with the local music model. Only listed while the music engine runs (\`./kite start\`).
- \`list_sounds\`, \`describe_sound\`, \`create_sound\`, \`delete_sound\` — the sound-effect library; \`generate_sound\` makes sounds from a prompt while the sound-effects engine runs (\`./kite start\`).
- \`check_audio\` — mix the soundtrack and every cue like the render and measure each cue against the mix; \`set_music_volume\` — balance the soundtrack against the effects.

## Craft

- Design at full size: 1920 × 1080 is big. Headlines 96–160 px, body UI 20–32 px. Leave generous margins.
- Motion reads best when it overlaps: stagger related items 30–80 ms; start the next move before the last one fully settles.
- Entrances decelerate (\`ease.outExpo\`, \`ease.standard\`, springs), exits accelerate (\`ease.inCubic\`) and are faster than entrances.
- Give text time: at least ~0.4 s + 0.06 s per word fully visible.
- Keep timing tight and intentional; think in beats when there is music.
`;

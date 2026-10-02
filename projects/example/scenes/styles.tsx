import { Fill, ease, keyframes, mix, progress, type SceneProps, type SceneSounds } from 'kite';
import { Headline, swapWords } from '../components/Headline';
import { PILLS_TOP, Pills, STYLE_LABELS, pillLayout } from '../components/Pills';
import { LOOKS, PromptCard, VARIANTS } from '../components/PromptCard';
import { BG, CARD, PINK } from '../components/tokens';

/** Where each click lands: roughly every 0.7 s, snapped to the half-beat grid so it rides the music. */
function clickTimes(music: SceneProps['music'], duration: number): number[] {
  const out: number[] = [];
  [1.1, 1.8, 2.5, 3.2].forEach((desired, i) => {
    const prev = out[i - 1] ?? 0.7;
    let at = music.snap(desired, 'half');
    if (at < prev + 0.45 || at > duration - 0.85) at = Math.min(Math.max(prev + 0.55, desired), duration - 0.85);
    out.push(at);
  });
  return out;
}

const WIPE = 0.36;

export const sounds: SceneSounds = ({ music, duration }) =>
  clickTimes(music, duration).flatMap((at, i) => [
    { at, sound: 'click', pitch: [0, 1, -1, 2][i], volume: [0.95, 1.1, 1.05, 0.95][i] },
    { at: at + WIPE / 2, sound: 'swish', align: 'peak' as const, pitch: i - 1, pan: -0.3 + i * 0.2, volume: 0.35 },
  ]);

function Cursor({ x, y, press }: { x: number; y: number; press: number }) {
  return (
    <svg
      width={30}
      height={36}
      viewBox="0 0 30 36"
      style={{
        position: 'absolute',
        left: x - 5,
        top: y - 3,
        transform: `scale(${1 - 0.14 * press})`,
        transformOrigin: '5px 3px',
        overflow: 'visible',
      }}
    >
      <path
        d="M5 3 L5 28 L11.2 22.2 L15.4 32 L20 30 L15.9 20.4 L24.5 20.4 Z"
        fill="#0a0a0a"
        stroke="#ffffff"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Styles({ t, duration, music }: SceneProps) {
  const swap = progress(t, 0.05, 0.9);
  const clicks = clickTimes(music, duration);

  // Each click wipes the next style across the card, left to right.
  let active = 0;
  let base = LOOKS.inset;
  let next: typeof base | null = null;
  let wipe = 0;
  clicks.forEach((at, i) => {
    const p = progress(t, at, at + WIPE, ease.inOutCubic);
    if (p <= 0) return;
    active = i + p;
    if (p >= 1) {
      base = LOOKS[VARIANTS[i + 1]];
      next = null;
    } else {
      base = { ...LOOKS[VARIANTS[i]], shadow: mix(LOOKS[VARIANTS[i]].shadow, LOOKS[VARIANTS[i + 1]].shadow, p) };
      next = LOOKS[VARIANTS[i + 1]];
      wipe = p;
    }
  });

  // Pills rise in under the card.
  const pillsIn = progress(t, 0.35, 0.9, ease.outExpo);
  const { widths, xs, total } = pillLayout(STYLE_LABELS);
  const pillCenter = (i: number) => 960 - total / 2 + xs[i] + widths[i] / 2;

  // A cursor visits each pill just before its click, then leaves.
  const cursorIn = progress(t, 0.55, 0.95, ease.outCubic);
  const cursorOut = progress(t, clicks[3] + 0.3, clicks[3] + 0.65, ease.inCubic);
  const px = keyframes(t, [
    [0, 1280],
    [clicks[0] - 0.12, pillCenter(1), ease.inOutCubic],
    [clicks[1] - 0.12, pillCenter(2), ease.inOutCubic],
    [clicks[2] - 0.12, pillCenter(3), ease.inOutCubic],
    [clicks[3] - 0.12, pillCenter(4), ease.inOutCubic],
    [clicks[3] + 0.65, pillCenter(4) + 150, ease.inCubic],
  ]);
  const py = keyframes(t, [
    [0, PILLS_TOP + 150],
    [clicks[0] - 0.12, PILLS_TOP + 20, ease.outCubic],
    [clicks[3] + 0.12, PILLS_TOP + 20],
    [clicks[3] + 0.65, PILLS_TOP + 110, ease.inCubic],
  ]);
  const press = clicks.reduce(
    (m, at) => Math.max(m, progress(t, at - 0.08, at, ease.outQuad) * (1 - progress(t, at + 0.02, at + 0.16))),
    0,
  );
  const cursorOpacity = cursorIn * (1 - cursorOut);

  return (
    <Fill style={{ background: BG }}>
      <Headline words={swapWords('Every', ['part', 'in', 'its', 'place'], ['style'], swap)} />
      <PromptCard look={base} style={{ left: CARD.x, top: CARD.y }} />
      {next && (
        <>
          <PromptCard look={next} style={{ left: CARD.x, top: CARD.y, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }} />
          <div
            style={{
              position: 'absolute',
              left: CARD.x + CARD.w * wipe - 1,
              top: CARD.y - 10,
              width: 2,
              height: CARD.h + 20,
              borderRadius: 1,
              background: PINK,
              opacity: Math.min(1, wipe * 6, (1 - wipe) * 6) * 0.85,
            }}
          />
        </>
      )}
      {pillsIn > 0 && (
        <Pills
          labels={STYLE_LABELS}
          active={active}
          centerX={960}
          top={PILLS_TOP}
          style={pillsIn < 1 ? { opacity: pillsIn, transform: `translateY(${mix(16, 0, pillsIn)}px)` } : undefined}
        />
      )}
      {clicks.map((at, i) => {
        const ring = progress(t, at, at + 0.45, ease.outCubic);
        if (ring <= 0 || ring >= 1) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: pillCenter(i + 1) - 30,
              top: PILLS_TOP + 17 - 30,
              width: 60,
              height: 60,
              borderRadius: 30,
              border: '2px solid rgba(255, 46, 136, 0.9)',
              opacity: 1 - ring,
              transform: `scale(${0.4 + ring * 0.9})`,
            }}
          />
        );
      })}
      {cursorOpacity > 0 && (
        <div style={{ opacity: cursorOpacity }}>
          <Cursor x={px} y={py} press={press} />
        </div>
      )}
    </Fill>
  );
}

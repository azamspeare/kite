import { Fill, ease, progress, type SceneProps, type SceneSounds } from 'storyboard';
import { Headline, swapWords } from '../components/Headline';
import { CARD_H, CARD_W, LOOKS, PromptCard, type LayerName } from '../components/PromptCard';
import { BG, CARD, DISPLAY, INK } from '../components/tokens';

const PERSPECTIVE = 2600;
/** How far each layer lifts off the surface when fully exploded (px, before scale). */
const LIFT: Record<LayerName, number> = { surface: 0, inset: 70, header: 150, text: 150, footer: 115, send: 195 };

interface Callout {
  label: string;
  layer: LayerName;
  /** Anchor in card coordinates. */
  x: number;
  y: number;
  side: 'left' | 'right';
}

const CALLOUTS: Callout[] = [
  { label: 'Header', layer: 'header', x: 0, y: 16, side: 'left' },
  { label: 'Prompt', layer: 'text', x: 0, y: 137, side: 'left' },
  { label: 'Inset border', layer: 'inset', x: 0, y: 200, side: 'left' },
  { label: 'Surface: soft', layer: 'surface', x: 120, y: CARD_H, side: 'left' },
  { label: 'Duration', layer: 'header', x: 581, y: 3, side: 'right' },
  { label: 'Actions', layer: 'send', x: 652, y: 290, side: 'right' },
];

/** Moments shared by the animation and the sound cues. */
const EXPLODE_AT = 1.0;
const CALLOUT_AT = (i: number) => 1.6 + i * 0.1;
const COLLAPSE_AT = 4.0;
const LAND_AT = 4.75;

export const sounds: SceneSounds = [
  { at: EXPLODE_AT + 0.2, sound: 'whoosh', align: 'peak', volume: 0.8 },
  ...CALLOUTS.map((c, i) => ({
    at: CALLOUT_AT(i),
    sound: 'tick',
    pitch: [0, 2, 4, -1, 1, 3][i],
    pan: c.side === 'left' ? -0.35 : 0.35,
    volume: 0.5 + (i % 3) * 0.06,
  })),
  { at: (COLLAPSE_AT + LAND_AT) / 2, sound: 'swish', align: 'peak', pitch: -3, volume: 0.5 },
  { at: LAND_AT, sound: 'thud', volume: 0.8 },
];

const LEFT_COLUMN = 520; // right edge of left labels
const RIGHT_COLUMN = 1400; // left edge of right labels

interface Pose {
  ax: number;
  az: number;
  scale: number;
  cx: number;
  cy: number;
  explode: number;
}

function pose(tilt: number, drift: number, explode: number): Pose {
  return {
    ax: 52 * tilt,
    az: (-34 - 5 * drift) * tilt,
    scale: 1 - 0.06 * tilt,
    cx: CARD.x + CARD_W / 2,
    cy: CARD.y + CARD_H / 2 + 40 * tilt,
    explode,
  };
}

/** Same math as the CSS transform below: rotateX(ax) rotateZ(az) scale3d(s) around the card centre, then perspective. */
function project(p: Pose, x: number, y: number, z: number): [number, number] {
  let px = (x - CARD_W / 2) * p.scale;
  let py = (y - CARD_H / 2) * p.scale;
  let pz = z * p.explode * p.scale;
  const a = (p.az * Math.PI) / 180;
  [px, py] = [px * Math.cos(a) - py * Math.sin(a), px * Math.sin(a) + py * Math.cos(a)];
  const b = (p.ax * Math.PI) / 180;
  [py, pz] = [py * Math.cos(b) - pz * Math.sin(b), py * Math.sin(b) + pz * Math.cos(b)];
  const k = PERSPECTIVE / (PERSPECTIVE - pz);
  return [p.cx + px * k, p.cy + py * k];
}

/** Label rows: evenly spaced per side around the anchors (in the fully exploded pose), for clean elbows. */
const LABEL_Y = (() => {
  const ref = pose(1, 0.5, 1);
  const ys = new Map<Callout, number>();
  for (const side of ['left', 'right'] as const) {
    const items = CALLOUTS.filter((c) => c.side === side)
      .map((c) => ({ c, y: project(ref, c.x, c.y, LIFT[c.layer])[1] }))
      .sort((a, b) => a.y - b.y);
    const gap = 84;
    const mean = items.reduce((sum, item) => sum + item.y, 0) / items.length;
    const first = mean - ((items.length - 1) * gap) / 2 + (side === 'left' ? 24 : -36);
    items.forEach((item, i) => ys.set(item.c, first + i * gap));
  }
  return ys;
})();

export default function Anatomy({ t }: SceneProps) {
  const swap = progress(t, 0.05, 0.9);
  const tilt = progress(t, 0.5, 1.5, ease.smooth) * (1 - progress(t, 4.35, 5.25, ease.smooth));
  const drift = progress(t, 1.2, 4.4, ease.inOutSine);
  const explode =
    progress(t, EXPLODE_AT, EXPLODE_AT + 0.95, ease.outExpo) * (1 - progress(t, COLLAPSE_AT, LAND_AT, ease.inOutCubic));
  const p = pose(tilt, drift, explode);
  const flat = tilt === 0 && explode === 0;

  return (
    <Fill style={{ background: BG }}>
      <Headline words={swapWords('Every', ['scene', 'is', 'code.'], ['part', 'in', 'its', 'place'], swap)} />
      {flat ? (
        <PromptCard look={LOOKS.inset} style={{ left: CARD.x, top: CARD.y }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, perspective: PERSPECTIVE, perspectiveOrigin: `${p.cx}px ${p.cy}px` }}>
          <div
            style={{
              position: 'absolute',
              left: p.cx - CARD_W / 2,
              top: p.cy - CARD_H / 2,
              width: CARD_W,
              height: CARD_H,
              transformStyle: 'preserve-3d',
              transform: `rotateX(${p.ax}deg) rotateZ(${p.az}deg) scale3d(${p.scale}, ${p.scale}, ${p.scale})`,
            }}
          >
            <PromptCard
              look={LOOKS.inset}
              style={{ left: 0, top: 0, transformStyle: 'preserve-3d' }}
              layer={(name) => ({ transform: `translateZ(${LIFT[name] * explode}px)` })}
            />
          </div>
        </div>
      )}
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {CALLOUTS.map((c, i) => {
          const start = CALLOUT_AT(i);
          const draw = progress(t, start + 0.1, start + 0.65, ease.outCubic);
          const retract = progress(t, 3.85 + i * 0.03, 4.2 + i * 0.03, ease.inCubic);
          const dot = progress(t, start, start + 0.25, ease.outBack) * (1 - retract);
          if (dot <= 0 && draw <= 0) return null;
          const [x, y] = project(p, c.x, c.y, LIFT[c.layer]);
          const ly = LABEL_Y.get(c)!;
          const lx = c.side === 'left' ? LEFT_COLUMN + 14 : RIGHT_COLUMN - 14;
          const elbow = c.side === 'left' ? lx + 90 : lx - 90;
          const shown = draw * (1 - retract);
          return (
            <g key={c.label}>
              <path
                d={`M${x},${y} L${elbow},${ly} L${lx},${ly}`}
                fill="none"
                stroke={INK}
                strokeOpacity={0.75}
                strokeWidth={1.6}
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - shown}
              />
              <circle cx={x} cy={y} r={5.5 * dot} fill="#fff" stroke={INK} strokeWidth={1.6} />
            </g>
          );
        })}
      </svg>
      {CALLOUTS.map((c, i) => {
        const start = CALLOUT_AT(i);
        const shown = progress(t, start + 0.45, start + 0.8, ease.outCubic) * (1 - progress(t, 3.8 + i * 0.03, 4.05 + i * 0.03));
        if (shown <= 0) return null;
        const ly = LABEL_Y.get(c)!;
        const slide = (1 - shown) * 10 * (c.side === 'left' ? 1 : -1);
        return (
          <div
            key={c.label}
            style={{
              position: 'absolute',
              top: ly - 15,
              ...(c.side === 'left' ? { right: 1920 - LEFT_COLUMN } : { left: RIGHT_COLUMN }),
              fontFamily: DISPLAY,
              fontSize: 22,
              fontWeight: 500,
              lineHeight: '30px',
              color: '#3f3f46',
              whiteSpace: 'nowrap',
              opacity: shown,
              transform: `translateX(${slide}px)`,
            }}
          >
            {c.label}
          </div>
        );
      })}
    </Fill>
  );
}

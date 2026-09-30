import type { CSSProperties } from 'react';
import { clamp, mix, mixColor } from 'storyboard';
import { CARD, MONO } from './tokens';

/** The style toggles shown under the card in "Every style" (and handed off to "Every beat."). */
export const STYLE_LABELS = ['INSET', 'FLUSH', 'DIVIDED', 'DARK', 'SOFT'] as const;
export const PILLS_TOP = CARD.y + CARD.h + 58;

const FONT = 14;
/** JetBrains Mono advances 0.6em per glyph; plus 0.1em tracking. */
const CHAR = FONT * 0.6 + FONT * 0.1;
const PAD = 15;
const GAP = 6;

export function pillLayout(labels: readonly string[]) {
  const widths = labels.map((l) => l.length * CHAR + PAD * 2);
  const xs: number[] = [];
  let x = 0;
  for (const w of widths) {
    xs.push(x);
    x += w + GAP;
  }
  return { widths, xs, total: x - GAP };
}

/** Uppercase mono toggle row; `active` may be fractional while the indicator slides between items. */
export function Pills(props: { labels: readonly string[]; active: number; centerX: number; top: number; style?: CSSProperties }) {
  const { labels, active } = props;
  const { widths, xs, total } = pillLayout(labels);
  const i0 = Math.floor(clamp(active, 0, labels.length - 1));
  const i1 = Math.min(labels.length - 1, i0 + 1);
  const f = clamp(active - i0, 0, 1);
  const indicatorX = mix(xs[i0], xs[i1], f);
  const indicatorW = mix(widths[i0], widths[i1], f);
  return (
    <div
      style={{ position: 'absolute', left: props.centerX - total / 2, top: props.top, width: total, height: 34, ...props.style }}
    >
      <div
        style={{
          position: 'absolute',
          left: indicatorX,
          top: 0,
          width: indicatorW,
          height: 34,
          borderRadius: 17,
          background: '#18181b',
        }}
      />
      {labels.map((label, i) => {
        const on = clamp(1 - Math.abs(active - i));
        return (
          <div
            key={label}
            style={{
              position: 'absolute',
              left: xs[i],
              top: 0,
              width: widths[i],
              height: 34,
              lineHeight: '34px',
              textAlign: 'center',
              fontFamily: MONO,
              fontSize: FONT,
              letterSpacing: '0.1em',
              textIndent: '0.1em',
              color: mixColor('#8a8a8f', '#ffffff', on),
            }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

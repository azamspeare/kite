import type { CSSProperties } from 'react';
import { PINK } from './tokens';

export const MARK_SIZE = 160;

/** Three "clips on a timeline" inside a dark rounded square (coordinates in a 160 px mark). */
export const MARK_BARS = [
  { x: 34, y: 49, w: 64, h: 18, color: '#ffffff' },
  { x: 62, y: 71, w: 64, h: 18, color: PINK },
  { x: 46, y: 93, w: 80, h: 18, color: '#ffffff' },
] as const;

export const MARK_RADIUS = 42;

/** The teaser's mark (three clips on a timeline) with its top-left corner at (x, y). */
export function LogoMark(props: { x: number; y: number; barScale?: (i: number) => number; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: props.x,
        top: props.y,
        width: MARK_SIZE,
        height: MARK_SIZE,
        borderRadius: MARK_RADIUS,
        background: '#18181b',
        ...props.style,
      }}
    >
      {MARK_BARS.map((b, i) => {
        const s = props.barScale?.(i) ?? 1;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: b.x,
              top: b.y,
              width: b.w,
              height: b.h,
              borderRadius: b.h / 2,
              background: b.color,
              transform: s !== 1 ? `scaleX(${s})` : undefined,
              transformOrigin: 'left center',
            }}
          />
        );
      })}
    </div>
  );
}

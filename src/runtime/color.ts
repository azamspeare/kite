import { interpolate, type InterpolateOptions } from './animate';

type RGBA = [number, number, number, number];

const NAMED: Record<string, RGBA> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
};

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(). */
export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return [...NAMED[s]] as RGBA;
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    const num = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return [num(0), num(2), num(4), hex.length === 8 ? num(6) / 255 : 1];
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const channel = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha];
  }
  throw new Error(`Unsupported color "${input}" (use hex or rgb/rgba)`);
}

function format([r, g, b, a]: RGBA): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000})`;
}

/** Blend two colors (p = 0 → a, p = 1 → b). */
export function mixColor(a: string, b: string, p: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return format([0, 1, 2, 3].map((i) => ca[i] + (cb[i] - ca[i]) * p) as RGBA);
}

/** Like interpolate(), but the outputs are colors. */
export function interpolateColor(
  t: number,
  input: readonly number[],
  colors: readonly string[],
  options: InterpolateOptions = {},
): string {
  const parsed = colors.map(parseColor);
  return format(
    [0, 1, 2, 3].map((ch) =>
      interpolate(
        t,
        input,
        parsed.map((c) => c[ch]),
        options,
      ),
    ) as RGBA,
  );
}

/** Apply an alpha to a color. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b, a] = parseColor(color);
  return format([r, g, b, a * alpha]);
}

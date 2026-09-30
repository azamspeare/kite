import type { CSSProperties } from 'react';
import { mix, mixColor } from 'storyboard';
import { DISPLAY, MONO } from './tokens';

export const CARD_W = 680;
export const CARD_H = 340;

/** Everything that differs between card styles; interpolatable. */
export interface Look {
  surface: string;
  border: string;
  shadow: number;
  title: string;
  sub: string;
  chipBg: string;
  chipInk: string;
  insetBg: string;
  insetBorder: string;
  text: string;
  divider: string;
  hint: string;
  sendBg: string;
  sendInk: string;
  cancel: string;
  /** 1 = text sits inside an inset box, 0 = flush with the header. */
  inset: number;
}

export const VARIANTS = ['inset', 'flush', 'divided', 'dark', 'soft'] as const;
export type Variant = (typeof VARIANTS)[number];

const base: Look = {
  surface: '#ffffff',
  border: '#e6e6e9',
  shadow: 1,
  title: '#0a0a0a',
  sub: '#8a8a8f',
  chipBg: '#f4f4f5',
  chipInk: '#52525b',
  insetBg: '#fafafa',
  insetBorder: '#e7e7ea',
  text: '#3f3f46',
  divider: 'rgba(230, 230, 233, 0)',
  hint: '#a1a1aa',
  sendBg: '#18181b',
  sendInk: '#ffffff',
  cancel: '#52525b',
  inset: 1,
};

export const LOOKS: Record<Variant, Look> = {
  inset: base,
  flush: { ...base, insetBg: '#ffffff', insetBorder: 'rgba(231, 231, 234, 0)', inset: 0 },
  divided: {
    ...base,
    insetBg: '#ffffff',
    insetBorder: 'rgba(231, 231, 234, 0)',
    divider: '#e6e6e9',
    inset: 0,
  },
  dark: {
    surface: '#18181b',
    border: '#2a2a2f',
    shadow: 1.5,
    title: '#fafafa',
    sub: '#8a8a93',
    chipBg: '#27272a',
    chipInk: '#d4d4d8',
    insetBg: '#111113',
    insetBorder: '#2e2e33',
    text: '#e4e4e7',
    divider: 'rgba(46, 46, 51, 0)',
    hint: '#71717a',
    sendBg: '#fafafa',
    sendInk: '#0a0a0a',
    cancel: '#a1a1aa',
    inset: 1,
  },
  soft: {
    ...base,
    surface: '#f1f1f4',
    border: '#f1f1f4',
    shadow: 0.35,
    chipBg: '#ffffff',
    insetBg: '#ffffff',
    insetBorder: '#ffffff',
    sendBg: '#ff2e88',
  },
};

export function mixLook(a: Look, b: Look, p: number): Look {
  if (p <= 0) return a;
  if (p >= 1) return b;
  const out = {} as Record<keyof Look, string | number>;
  for (const key of Object.keys(a) as (keyof Look)[]) {
    const va = a[key];
    const vb = b[key];
    out[key] = typeof va === 'number' ? mix(va, vb as number, p) : mixColor(va, vb as string, p);
  }
  return out as unknown as Look;
}

export type LayerName = 'surface' | 'inset' | 'header' | 'text' | 'footer' | 'send';

export const PROMPT = 'Hold on the headline a full second longer, then slide the card in from the right.';

/**
 * The prompt card from the Storyboard editor, built from separate absolutely positioned layers so a
 * scene can pull them apart in 3D (`layer` adds per-layer styles such as translateZ).
 */
export function PromptCard(props: { look: Look; layer?: (name: LayerName) => CSSProperties | undefined; style?: CSSProperties }) {
  const { look, layer } = props;
  const l = (name: LayerName, style: CSSProperties): CSSProperties => ({ position: 'absolute', ...style, ...layer?.(name) });
  const textX = mix(48, 28, 1 - look.inset);
  return (
    <div
      style={{
        position: 'absolute',
        width: CARD_W,
        height: CARD_H,
        fontFamily: DISPLAY,
        ...props.style,
      }}
    >
      <div
        style={l('surface', {
          inset: 0,
          borderRadius: 22,
          background: look.surface,
          border: `1px solid ${look.border}`,
          boxShadow: `0 1px 2px rgba(0,0,0,${0.05 * look.shadow}), 0 24px 60px rgba(0,0,0,${0.08 * look.shadow})`,
        })}
      >
        <div style={{ position: 'absolute', left: 0, right: 0, top: 88, height: 1, background: look.divider }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 256, height: 1, background: look.divider }} />
      </div>
      <div
        style={l('inset', {
          left: 28,
          top: 104,
          width: CARD_W - 56,
          height: 136,
          borderRadius: 14,
          background: look.insetBg,
          border: `1px solid ${look.insetBorder}`,
        })}
      />
      <div style={l('header', { left: 28, top: 24, width: CARD_W - 56, height: 56 })}>
        <div style={{ fontSize: 23, fontWeight: 650, letterSpacing: '-0.012em', color: look.title, lineHeight: '30px' }}>
          Anatomy
        </div>
        <div style={{ fontSize: 15, color: look.sub, lineHeight: '22px' }}>Scene 2 of 5</div>
        <div
          style={{
            position: 'absolute',
            right: 40,
            top: 3,
            padding: '0 10px',
            height: 28,
            lineHeight: '28px',
            borderRadius: 8,
            background: look.chipBg,
            color: look.chipInk,
            fontFamily: MONO,
            fontSize: 14,
          }}
        >
          3.32s
        </div>
        <div style={{ position: 'absolute', right: 0, top: 15, display: 'flex', gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 5, height: 5, borderRadius: 3, background: look.sub }} />
          ))}
        </div>
      </div>
      <div
        style={l('text', {
          left: textX,
          top: 122,
          width: CARD_W - textX - 48,
          fontSize: 19.5,
          lineHeight: 1.55,
          color: look.text,
          letterSpacing: '-0.005em',
        })}
      >
        {PROMPT}
      </div>
      <div style={l('footer', { left: 28, top: 268, width: CARD_W - 56 - 98, height: 44 })}>
        <span style={{ position: 'absolute', left: 0, top: 0, lineHeight: '44px', fontSize: 15, color: look.hint }}>
          ⌘↵ to send
        </span>
        <span
          style={{
            position: 'absolute',
            right: 18,
            top: 0,
            lineHeight: '44px',
            fontSize: 15.5,
            fontWeight: 500,
            color: look.cancel,
          }}
        >
          Cancel
        </span>
      </div>
      <div
        style={l('send', {
          right: 28,
          top: 268,
          width: 88,
          height: 44,
          borderRadius: 12,
          background: look.sendBg,
          color: look.sendInk,
          fontSize: 15.5,
          fontWeight: 600,
          lineHeight: '44px',
          textAlign: 'center',
        })}
      >
        Send
      </div>
    </div>
  );
}

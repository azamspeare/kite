import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { SceneProps } from './types';

export const SceneContext = createContext<SceneProps | null>(null);

/** Scene props from anywhere inside a scene (for nested components). */
export function useScene(): SceneProps {
  const value = useContext(SceneContext);
  if (!value) throw new Error('useScene() must be used inside a Storyboard scene');
  return value;
}

/** Absolutely positioned layer covering the whole canvas. */
export function Fill(props: { children?: ReactNode; style?: CSSProperties; className?: string; center?: boolean }) {
  return (
    <div
      className={props.className}
      style={{
        position: 'absolute',
        inset: 0,
        ...(props.center ? { display: 'flex', alignItems: 'center', justifyContent: 'center' } : null),
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

type PieceStyle = (index: number, count: number, text: string) => CSSProperties | undefined;

/**
 * Text split into individually styleable pieces (characters or words) for kinetic type.
 * Spaces are kept as normal text so lines still wrap; indexes skip whitespace.
 *
 *   <SplitText text="Every part in its place" by="words"
 *     piece={(i) => { const p = progress(t, 0.1 + i * 0.06, 0.6 + i * 0.06, ease.outExpo);
 *                     return { opacity: p, transform: `translateY(${(1 - p) * 40}px)` }; }} />
 */
export function SplitText(props: {
  text: string;
  by?: 'chars' | 'words';
  piece?: PieceStyle;
  style?: CSSProperties;
  className?: string;
}) {
  const { text, by = 'chars', piece } = props;
  const tokens = text.split(/(\s+)/).filter((s) => s.length > 0);
  const words = tokens.filter((s) => !/^\s+$/.test(s));
  const count = by === 'words' ? words.length : words.reduce((n, w) => n + [...w].length, 0);
  let index = 0;
  const children = tokens.map((token, ti) => {
    if (/^\s+$/.test(token)) return token;
    if (by === 'words') {
      const i = index++;
      return (
        <span key={ti} style={{ display: 'inline-block', whiteSpace: 'pre', ...piece?.(i, count, token) }}>
          {token}
        </span>
      );
    }
    return (
      <span key={ti} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
        {[...token].map((ch, ci) => {
          const i = index++;
          return (
            <span key={ci} style={{ display: 'inline-block', whiteSpace: 'pre', ...piece?.(i, count, ch) }}>
              {ch}
            </span>
          );
        })}
      </span>
    );
  });
  return (
    <span className={props.className} style={props.style}>
      {children}
    </span>
  );
}

/** The first `progress × length` characters of text (typewriter effect). */
export function typed(text: string, progress: number): string {
  const chars = [...text];
  return chars.slice(0, Math.round(Math.max(0, Math.min(1, progress)) * chars.length)).join('');
}

let assetBase = '';

/** @internal Set by the frame runtime. */
export function setAssetBase(base: string) {
  assetBase = base;
}

/** URL of a file in this project's `assets/` folder: <img src={asset('logo.svg')} /> */
export function asset(path: string): string {
  return assetBase + path.split('/').map(encodeURIComponent).join('/');
}

import type { CSSProperties } from 'react';
import { ease, progress } from 'storyboard';
import { DISPLAY, HEADLINE_SIZE, HEADLINE_TOP, INK } from './tokens';

export interface WordState {
  text: string;
  /** Width 0 → 1 (collapsed → natural). Collapsing words let the line re-centre smoothly. */
  open: number;
  /** Vertical offset in em. */
  shift: number;
  fade: number;
}

function Word({ word, first }: { word: WordState; first: boolean }) {
  return (
    <span style={{ display: 'inline-grid', gridTemplateColumns: `minmax(0, ${word.open}fr)` }}>
      <span style={{ minWidth: 0, overflowX: 'clip', overflowY: 'visible', whiteSpace: 'pre' }}>
        <span
          style={{
            display: 'inline-block',
            transform: word.shift ? `translateY(${word.shift}em)` : undefined,
            opacity: word.fade,
          }}
        >
          {first ? word.text : ` ${word.text}`}
        </span>
      </span>
    </span>
  );
}

/** Centered headline at the shared top position. */
export function Headline({ words, style }: { words: WordState[]; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: HEADLINE_TOP,
        textAlign: 'center',
        fontFamily: DISPLAY,
        fontSize: HEADLINE_SIZE,
        fontWeight: 700,
        letterSpacing: '-0.045em',
        lineHeight: 1,
        color: INK,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {words.map((w, i) => (
        <Word key={`${i}:${w.text}`} word={w} first={i === 0} />
      ))}
    </div>
  );
}

export const still = (text: string): WordState => ({ text, open: 1, shift: 0, fade: 1 });

/**
 * "Every <from…>" → "Every <to…>": the old tail lifts away while the new one rises in,
 * and the line re-centres as widths change. p runs 0 → 1 over the whole swap.
 */
export function swapWords(lead: string, from: string[], to: string[], p: number): WordState[] {
  // Three beats: the old words lift away, the line re-centres (lead glides), the new words rise in.
  const width = progress(p, 0.14, 0.58, ease.smooth);
  const out: WordState[] = [still(lead)];
  from.forEach((text, i) => {
    const gone = progress(p, i * 0.03, 0.16 + i * 0.03, ease.outCubic);
    out.push({ text, open: 1 - width, shift: -0.28 * gone, fade: 1 - gone });
  });
  to.forEach((text, j) => {
    const start = 0.48 + j * 0.045;
    const arrive = progress(p, start, start + 0.38, ease.outExpo);
    out.push({ text, open: width, shift: 0.34 * (1 - arrive), fade: progress(p, start, start + 0.22) });
  });
  return out;
}

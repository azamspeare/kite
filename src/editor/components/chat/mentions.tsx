import type { ReactNode } from 'react';

/**
 * Text with each "@Scene N" of a scene that exists wrapped in a span with `className`. Used by the
 * composer's highlight layer and by sent messages, so both mark mentions the same way.
 */
export function withMentions(text: string, sceneCount: number, className: string): ReactNode[] {
  return text.split(/(@Scene \d+)/g).map((part, i) => {
    const n = /^@Scene (\d+)$/.exec(part)?.[1];
    return n && Number(n) >= 1 && Number(n) <= sceneCount ? (
      <span key={i} className={className}>
        {part}
      </span>
    ) : (
      part
    );
  });
}

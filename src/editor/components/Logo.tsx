/*
 * Kite's mark: a diamond kite, its sail split in four by the spars (drawn as gaps), flying a little to
 * the left on a curving tail. One flat colour, taken from the text colour. `public/favicon.svg` draws
 * the same shapes: change them together.
 */
const SAIL = 'M11.45 1.2V7.25H4.9ZM12.55 1.2V7.25h6.55ZM4.75 8.35h6.7v8.25ZM19.25 8.35h-6.7v8.25Z';
const TAIL = 'M12 16.9c1.2 1.6-1.9 2.5-.6 4.3.7.95 1.9 1 2.6 2.1';

/** The mark, inlined so it takes the text colour and needs no image request. */
export function KiteMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g transform="rotate(-18 12 12)">
        <path fill="currentColor" d={SAIL} />
        <path d={TAIL} fill="none" stroke="currentColor" strokeWidth={1.15} strokeLinecap="round" />
      </g>
    </svg>
  );
}

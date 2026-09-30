export interface TextStyle {
  fontSize: number;
  fontWeight?: number;
  fontFamily?: string;
  fontStyle?: 'normal' | 'italic';
  /** CSS letter-spacing: a number is px, or a string such as '-0.045em'. */
  letterSpacing?: number | string;
}

const cache = new Map<string, { width: number; height: number }>();
let probe: HTMLSpanElement | null = null;

/**
 * Size of a single line of text in canvas px, measured by the same layout engine that renders the
 * scene — use it to center, underline, or animate widths of text precisely.
 *   const { width } = measureText('Storyboard', { fontSize: 120, fontWeight: 700, letterSpacing: '-0.045em' })
 */
export function measureText(text: string, style: TextStyle): { width: number; height: number } {
  if (typeof document === 'undefined') return { width: 0, height: 0 };
  const key = JSON.stringify([text, style]);
  const hit = cache.get(key);
  if (hit) return hit;
  if (!probe) {
    probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-100000px;top:0;white-space:pre;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
  }
  probe.style.fontFamily = style.fontFamily ?? "'Inter Variable', system-ui, sans-serif";
  probe.style.fontSize = `${style.fontSize}px`;
  probe.style.fontWeight = String(style.fontWeight ?? 400);
  probe.style.fontStyle = style.fontStyle ?? 'normal';
  probe.style.letterSpacing =
    typeof style.letterSpacing === 'number' ? `${style.letterSpacing}px` : (style.letterSpacing ?? 'normal');
  probe.textContent = text;
  const rect = probe.getBoundingClientRect();
  const size = { width: rect.width, height: rect.height };
  // Only cache once web fonts are in, so a fallback-font measurement never sticks.
  if (document.fonts.status === 'loaded') cache.set(key, size);
  return size;
}

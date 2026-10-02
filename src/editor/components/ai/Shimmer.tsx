import { cn } from '@/lib/utils';

const SPREAD_PER_CHARACTER = 2;

/**
 * Text with a highlight sweeping across it, for work in progress ("Thinking…").
 * CSS only: a moving highlight window clipped to the glyphs over a flat base
 * layer. Under reduced motion the gradient stands still, which reads as plain
 * muted text.
 */
export function Shimmer({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        'animate-text-shimmer [background-image:var(--shimmer),linear-gradient(var(--color-muted-foreground),var(--color-muted-foreground))] bg-[length:250%_100%,auto] bg-clip-text [background-repeat:no-repeat,padding-box] text-transparent [--shimmer:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))]',
        className,
      )}
      style={{ '--spread': `${children.length * SPREAD_PER_CHARACTER}px` } as React.CSSProperties}
    >
      {children}
    </span>
  );
}

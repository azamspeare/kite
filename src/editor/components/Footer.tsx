import { HelpDialog } from './HelpDialog';
import { KiteMark } from './Logo';

const LINK_CLASSES = 'rounded-sm transition-colors hover:text-action-text';

/** The bar along the bottom of the screen: white, edge to edge, with a hairline on top. */
export function Footer() {
  return (
    <footer className="flex shrink-0 items-center justify-between gap-4 border-t bg-background px-4 py-2.5 text-sm text-muted-foreground">
      {/* The left padding lines the mark up with the navbar's, which sits inside a button. */}
      <p className="flex min-w-0 items-center gap-2 pl-2.5">
        <KiteMark className="size-4 shrink-0" />
        <span className="shrink-0 tabular-nums">Kite © {new Date().getFullYear()}</span>
        <span aria-hidden="true" className="max-sm:hidden">
          ·
        </span>
        <span className="truncate font-serif italic max-sm:hidden">Every frame is code.</span>
      </p>
      <nav aria-label="Footer" className="flex shrink-0 items-center gap-5 pr-2.5">
        {/* Looks like a link, but it opens a dialog, so it is a button. */}
        <HelpDialog trigger={<button type="button" aria-keyshortcuts="?" className={LINK_CLASSES} />}>Help</HelpDialog>
      </nav>
    </footer>
  );
}

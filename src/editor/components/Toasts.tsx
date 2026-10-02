import { ExclamationCircleIcon } from '@heroicons/react/16/solid';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEditor } from '../store';

/** Short notes from the app, stacked at the bottom centre as floating islands. Errors say so in red. */
export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-16 z-60 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex max-w-xl animate-bar-in items-center gap-3 rounded-xl bg-background py-2 pr-2 pl-3.5 text-sm shadow-island-stronger',
            t.tone === 'error' && 'text-destructive-foreground',
            !t.action && 'pr-3.5',
          )}
        >
          {t.tone === 'error' && <ExclamationCircleIcon aria-hidden="true" className="size-4 shrink-0" />}
          <span className="min-w-0 py-0.5 wrap-break-word">{t.text}</span>
          {t.action && (
            <Button variant="ghost" size="sm" onClick={t.action.run} className="shrink-0 text-action-text hover:bg-action/10">
              {t.action.label}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

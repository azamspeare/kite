import { PlayIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { previewAudio } from '../../audio';
import { toastError } from '../../store';
import { formatClock } from '../ui';

/**
 * A file attached to a message (Rika's attachment card): an image is a 64px thumbnail; audio is a small
 * card with a play button, its name and its length. In the composer it has a remove button, and a
 * spinner while it uploads.
 */
export function AttachmentCard(props: {
  name: string;
  kind: 'image' | 'audio';
  /** Where to load it from; null while an audio file is still uploading. */
  src: string | null;
  duration?: number;
  uploading?: boolean;
  onRemove?: () => void;
}) {
  const { name, kind, src, duration, uploading, onRemove } = props;
  return (
    <div className="group relative shrink-0" title={name}>
      {kind === 'image' ? (
        <div className="size-16 overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10">
          {src && <img src={src} alt={name} className="size-full object-cover" />}
        </div>
      ) : (
        <div className="flex h-16 w-44 items-center gap-2.5 rounded-xl bg-background px-2.5 ring-1 ring-foreground/10">
          <button
            type="button"
            disabled={!src || uploading}
            aria-label={`Play ${name}`}
            onClick={() => src && void previewAudio.play(src).catch(toastError)}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <PlayIcon className="ml-0.5 size-3.5" />
          </button>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-medium">{name}</span>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {duration !== undefined ? formatClock(duration) : 'Audio'}
            </span>
          </span>
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 grid place-items-center rounded-xl bg-background/70">
          <Spinner aria-label={`Uploading ${name}`} className="size-4 text-muted-foreground" />
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className={cn(
            'absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background ring-2 ring-background',
            // A larger hit area than the small disc shows.
            'before:absolute before:-inset-2',
          )}
        >
          <XMarkIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

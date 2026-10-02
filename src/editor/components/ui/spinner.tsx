import { Loading03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { cn } from 'cn';

// shadcn's spinner draws lucide's Loader2Icon; this project's icons come from Heroicons and Hugeicons.
function Spinner({ className, ...props }: Omit<React.ComponentProps<typeof HugeiconsIcon>, 'icon'>) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      strokeWidth={2}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };

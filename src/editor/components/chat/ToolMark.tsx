import { MusicalNoteIcon, PaintBrushIcon, SparklesIcon, SpeakerWaveIcon } from '@heroicons/react/16/solid';
import type { ComponentType, SVGProps } from 'react';
import { CHAT_TOOLS, type ChatToolId } from '../../../shared/chatOptions';
import { cn } from '@/lib/utils';

export const TOOL_ICONS: Record<ChatToolId, ComponentType<SVGProps<SVGSVGElement>>> = {
  animate: SparklesIcon,
  design: PaintBrushIcon,
  sound: SpeakerWaveIcon,
  music: MusicalNoteIcon,
};

/** The chosen "/" tool, at the start of a line: its icon and name in brand blue. */
export function ToolMark({ tool, className }: { tool: ChatToolId; className?: string }) {
  const Icon = TOOL_ICONS[tool];
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium whitespace-nowrap text-action-text', className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      {CHAT_TOOLS.find((t) => t.id === tool)?.name}
    </span>
  );
}

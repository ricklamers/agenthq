import {
  Group,
  Panel,
  type PanelProps,
  Separator,
  type GroupProps,
  type SeparatorProps,
} from 'react-resizable-panels';

import { cn } from '@/lib/utils';

const ResizablePanelGroup = ({
  className,
  ...props
}: GroupProps) => (
  <Group
    className={cn(
      'flex h-full min-h-0 w-full min-w-0 data-[panel-group-direction=vertical]:flex-col',
      className
    )}
    {...props}
  />
);

const ResizablePanel = ({
  className,
  ...props
}: PanelProps) => (
  <Panel
    className={cn('min-h-0 min-w-0 overflow-hidden', className)}
    {...props}
  />
);

const ResizableHandle = ({
  className,
  ...props
}: SeparatorProps) => (
  <Separator
    className={cn(
      // Base styles
      'relative bg-transparent outline-none',
      // Horizontal (vertical separator line)
      'data-[orientation=horizontal]:w-4 data-[orientation=horizontal]:-mx-2',
      'data-[orientation=horizontal]:after:absolute data-[orientation=horizontal]:after:inset-y-0 data-[orientation=horizontal]:after:left-1/2 data-[orientation=horizontal]:after:w-px data-[orientation=horizontal]:after:-translate-x-1/2',
      // Vertical (horizontal separator line)
      'data-[orientation=vertical]:h-4 data-[orientation=vertical]:-my-2',
      'data-[orientation=vertical]:after:absolute data-[orientation=vertical]:after:inset-x-0 data-[orientation=vertical]:after:top-1/2 data-[orientation=vertical]:after:h-px data-[orientation=vertical]:after:-translate-y-1/2',
      // Common line styles
      'after:bg-border after:transition-colors',
      'hover:after:bg-muted-foreground/50',
      className
    )}
    {...props}
  />
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };

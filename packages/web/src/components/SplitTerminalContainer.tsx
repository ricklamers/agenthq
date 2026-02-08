import { useCallback, useEffect, useState } from 'react';
import type { AgentType, Process, Worktree } from '@agenthq/shared';
import { TerminalPane } from './TerminalPane';
import { Button } from './ui/button';
import { Circle, Menu, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SplitTerminalContainerProps {
  worktree: Worktree | null;
  processes: Process[];
  autoSelectProcessId?: string | null;
  onAutoSelectComplete?: () => void;
  onInput: (processId: string, data: string) => void;
  onResize: (processId: string, cols: number, rows: number) => void;
  onPtyData: (processId: string, handler: (data: string) => void) => () => void;
  onNewProcess: () => void;
  onKillProcess: (processId: string) => void;
  onArchiveWorktree: () => void;
  onViewDiff: () => Promise<string | null>;
  onMerge: () => Promise<string | null>;
  onMergeWithAgent: (agent: AgentType) => Promise<string | null>;
  onOpenSidebar?: () => void;
}

const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

export function SplitTerminalContainer({
  worktree,
  processes,
  autoSelectProcessId,
  onAutoSelectComplete,
  onInput,
  onResize,
  onPtyData,
  onNewProcess,
  onKillProcess,
  onOpenSidebar,
}: SplitTerminalContainerProps) {
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (processes.length === 0) {
      if (selectedProcessId !== null) {
        setSelectedProcessId(null);
      }
      return;
    }

    if (selectedProcessId && processes.some((process) => process.id === selectedProcessId)) {
      return;
    }

    setSelectedProcessId(processes[0]?.id ?? null);
  }, [processes, selectedProcessId]);

  // Auto-select a newly spawned process when it appears in the list
  useEffect(() => {
    if (!autoSelectProcessId) return;
    if (processes.some((p) => p.id === autoSelectProcessId)) {
      setSelectedProcessId(autoSelectProcessId);
      onAutoSelectComplete?.();
    }
  }, [autoSelectProcessId, processes, onAutoSelectComplete]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'w' && selectedProcessId) {
        e.preventDefault();
        onKillProcess(selectedProcessId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProcessId, onKillProcess]);

  const selectedProcess = selectedProcessId
    ? processes.find((process) => process.id === selectedProcessId) ?? null
    : null;

  const handleFocusTerminal = useCallback(() => {
    if (!selectedProcessId && processes.length > 0) {
      setSelectedProcessId(processes[0]?.id ?? null);
    }
  }, [processes, selectedProcessId]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1">
        {isMobile && (
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full shadow"
            onClick={onOpenSidebar}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}

        {worktree && processes.map((process) => {
          const isSelected = process.id === selectedProcessId;

          return (
            <div
              key={process.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedProcessId(process.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedProcessId(process.id);
                }
              }}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors',
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              )}
            >
              <Circle
                className={cn(
                  'h-2 w-2',
                  process.status === 'running'
                    ? 'fill-green-500 text-green-500'
                    : process.status === 'pending'
                      ? 'fill-yellow-500 text-yellow-500'
                      : 'fill-muted-foreground text-muted-foreground'
                )}
              />
              <span>{process.agent}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onKillProcess(process.id);
                }}
                className="ml-1 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`Close ${process.agent} tab`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        {worktree ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-muted-foreground"
            onClick={onNewProcess}
          >
            <Plus className="h-3.5 w-3.5" />
            New Tab
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Select a worktree</span>
        )}
      </div>

      <div className="h-0 min-h-0 flex-1 overflow-hidden">
        {!worktree ? (
          <div className="flex h-full items-center justify-center bg-[#0a0a0a]">
            <span className="text-muted-foreground">Select a worktree to view processes</span>
          </div>
        ) : processes.length === 0 ? (
          <div className="flex h-full items-center justify-center bg-[#0a0a0a]">
            <span className="text-muted-foreground">Click "+ New Tab" to spawn a process</span>
          </div>
        ) : (
          <TerminalPane
            process={selectedProcess}
            onInput={onInput}
            onResize={onResize}
            onPtyData={onPtyData}
            onFocus={handleFocusTerminal}
          />
        )}
      </div>
    </div>
  );
}

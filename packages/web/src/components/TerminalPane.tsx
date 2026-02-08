import { useCallback, useEffect, useRef } from 'react';
import type { Process } from '@agenthq/shared';
import { useTerminal } from '@/hooks/useTerminal';
import { useTheme } from '@/hooks/useTheme';

interface TerminalPaneProps {
  process: Process | null;
  onInput: (processId: string, data: string) => void;
  onResize: (processId: string, cols: number, rows: number) => void;
  onPtyData: (processId: string, handler: (data: string) => void) => () => void;
  onFocus?: () => void;
}

export function TerminalPane({ process, onInput, onResize, onPtyData, onFocus }: TerminalPaneProps) {
  const { resolvedTheme } = useTheme();
  const processId = process?.id ?? null;

  const handleData = useCallback(
    (data: string) => {
      if (processId) {
        onInput(processId, data);
      }
    },
    [processId, onInput]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (processId) {
        onResize(processId, cols, rows);
      }
    },
    [processId, onResize]
  );

  const { terminalRef, write, fit, focus, clear, isReady } = useTerminal({
    onData: handleData,
    onResize: handleResize,
    resolvedTheme,
  });

  const focusPane = useCallback(() => {
    focus();
    onFocus?.();
  }, [focus, onFocus]);

  const writeRef = useRef(write);
  writeRef.current = write;

  const subscribedProcessIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isReady) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      subscribedProcessIdRef.current = null;
      return;
    }

    if (subscribedProcessIdRef.current === processId) {
      return;
    }

    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    subscribedProcessIdRef.current = processId;
    clear();

    if (!processId) {
      fit();
      return;
    }

    // Subscribe to PTY data first — this sends the 'attach' message so the
    // server-side PTY is prepared before we send resize dimensions.
    cleanupRef.current = onPtyData(processId, (data) => {
      writeRef.current(data);
    });
    fit();
  }, [isReady, processId, onPtyData, clear, fit]);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-terminal-bg" onClick={focusPane}>
      <div ref={terminalRef} className="h-full min-h-0 w-full overflow-hidden" />

      {!process && (
        <div className="absolute inset-0 flex items-center justify-center bg-terminal-bg/90">
          <span className="text-muted-foreground">Select a process tab</span>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import type { Process } from '@agenthq/shared';
import { useTerminal } from '@/hooks/useTerminal';

interface TerminalPaneProps {
  process: Process | null;
  onInput: (processId: string, data: string) => void;
  onResize: (processId: string, cols: number, rows: number) => void;
  onPtyData: (processId: string, handler: (data: string) => void) => () => void;
  isFocused?: boolean;
  onFocus?: () => void;
}

export interface TerminalPaneHandle {
  getDimensions: () => { cols: number; rows: number } | null;
  fit: () => void;
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane({ process, onInput, onResize, onPtyData, onFocus }, ref) {
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

    const { terminalRef, write, fit, focus, clear, getDimensions, isReady } = useTerminal({
      onData: handleData,
      onResize: handleResize,
    });

    const focusPane = useCallback(() => {
      focus();
      onFocus?.();
    }, [focus, onFocus]);

    const writeRef = useRef(write);
    writeRef.current = write;

    const subscribedProcessIdRef = useRef<string | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);

    useImperativeHandle(ref, () => ({ getDimensions, fit }), [getDimensions, fit]);

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
      fit();

      if (!processId) {
        return;
      }

      cleanupRef.current = onPtyData(processId, (data) => {
        writeRef.current(data);
      });

      const resizeTimeoutId = window.setTimeout(() => {
        fit();
      }, 50);

      return () => {
        window.clearTimeout(resizeTimeoutId);
      };
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
      <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0a0a0a]" onClick={focusPane}>
        <div ref={terminalRef} className="h-full min-h-0 w-full overflow-hidden" />

        {!process && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/90">
            <span className="text-muted-foreground">Select a process tab</span>
          </div>
        )}
      </div>
    );
  }
);

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
  onSizeChange?: (cols: number, rows: number) => void;
  emptyMessage?: string;
}

export function TerminalPane({
  process,
  onInput,
  onResize,
  onPtyData,
  onFocus,
  onSizeChange,
  emptyMessage,
}: TerminalPaneProps) {
  const { resolvedTheme } = useTheme();
  const processId = process?.id ?? null;
  const paneRef = useRef<HTMLDivElement | null>(null);

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
    onSizeChange,
    resolvedTheme,
  });

  const fitRafRef = useRef<number | null>(null);

  const scheduleFit = useCallback(() => {
    if (!isReady) return;
    if (fitRafRef.current !== null) return;
    fitRafRef.current = window.requestAnimationFrame(() => {
      fitRafRef.current = null;
      fit();
    });
  }, [fit, isReady]);

  const focusPane = useCallback(() => {
    focus();
    onFocus?.();
  }, [focus, onFocus]);

  const writeRef = useRef(write);
  writeRef.current = write;

  const subscribedProcessIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (fitRafRef.current !== null) {
        window.cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const pane = paneRef.current;
    if (!pane) return;

    const targets = [pane.parentElement, pane].filter((target): target is HTMLElement => Boolean(target));
    if (targets.length === 0) return;

    scheduleFit();

    const resizeObserver = new ResizeObserver(() => {
      scheduleFit();
    });
    for (const target of targets) {
      resizeObserver.observe(target);
    }

    const mutationObserver = new MutationObserver(() => {
      scheduleFit();
    });
    for (const target of targets) {
      mutationObserver.observe(target, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleFit();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('orientationchange', scheduleFit);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('orientationchange', scheduleFit);
    };
  }, [isReady, scheduleFit]);

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
      scheduleFit();
      return;
    }

    // Subscribe to PTY data first — this sends the 'attach' message so the
    // server-side PTY is prepared before we send resize dimensions.
    cleanupRef.current = onPtyData(processId, (data) => {
      writeRef.current(data);
    });
    scheduleFit();
  }, [isReady, processId, onPtyData, clear, scheduleFit]);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={paneRef} className="relative h-full min-h-0 w-full overflow-hidden bg-terminal-bg" onClick={focusPane}>
      <div ref={terminalRef} className="h-full min-h-0 w-full overflow-hidden" />

      {!process && (
        <div className="absolute inset-0 flex items-center justify-center bg-terminal-bg/90">
          <span className="text-muted-foreground">{emptyMessage ?? 'Select a process tab'}</span>
        </div>
      )}
    </div>
  );
}

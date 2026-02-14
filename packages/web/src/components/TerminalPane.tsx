import { useCallback, useEffect, useRef } from 'react';
import type { Process } from '@agenthq/shared';
import { useTerminal } from '@/hooks/useTerminal';
import { useTheme } from '@/hooks/useTheme';

const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

interface TerminalPaneProps {
  process: Process | null;
  onInput: (processId: string, data: string) => void;
  onResize: (processId: string, cols: number, rows: number) => void;
  onPtyData: (processId: string, handler: (data: string) => void) => () => void;
  onPtySize: (processId: string, handler: (cols: number, rows: number) => void) => () => void;
  onFocus?: () => void;
  onSizeChange?: (cols: number, rows: number) => void;
  emptyMessage?: string;
}

export function TerminalPane({
  process,
  onInput,
  onResize,
  onPtyData,
  onPtySize,
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

  const localTerminalSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const serverTerminalSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const lastCorrectionRef = useRef<{
    processId: string;
    localCols: number;
    localRows: number;
    serverCols: number;
    serverRows: number;
  } | null>(null);

  const reconcileServerSize = useCallback((currentProcessId: string) => {
    const local = localTerminalSizeRef.current;
    const server = serverTerminalSizeRef.current;
    if (!local || !server) return;
    if (local.cols <= 0 || local.rows <= 0 || server.cols <= 0 || server.rows <= 0) return;
    if (local.cols === server.cols && local.rows === server.rows) return;

    const last = lastCorrectionRef.current;
    if (
      last &&
      last.processId === currentProcessId &&
      last.localCols === local.cols &&
      last.localRows === local.rows &&
      last.serverCols === server.cols &&
      last.serverRows === server.rows
    ) {
      return;
    }

    lastCorrectionRef.current = {
      processId: currentProcessId,
      localCols: local.cols,
      localRows: local.rows,
      serverCols: server.cols,
      serverRows: server.rows,
    };
    onResize(currentProcessId, local.cols, local.rows);
  }, [onResize]);

  const handleSizeChange = useCallback(
    (cols: number, rows: number) => {
      localTerminalSizeRef.current = { cols, rows };
      onSizeChange?.(cols, rows);
      if (processId) {
        reconcileServerSize(processId);
      }
    },
    [onSizeChange, processId, reconcileServerSize]
  );

  const { terminalRef, write, fit, focus, clear, isReady } = useTerminal({
    onData: handleData,
    onResize: handleResize,
    onSizeChange: handleSizeChange,
    resolvedTheme,
  });

  const fitRafRef = useRef<number | null>(null);
  const lastPaneSizeRef = useRef<{ width: number; height: number } | null>(null);

  const scheduleFit = useCallback(() => {
    if (!isReady) return;
    if (fitRafRef.current !== null) return;
    fitRafRef.current = window.requestAnimationFrame(() => {
      fitRafRef.current = null;
      fit();
    });
  }, [fit, isReady]);

  const scheduleFitForPaneLayout = useCallback((force = false) => {
    const pane = paneRef.current;
    if (!pane) {
      if (force) {
        scheduleFit();
      }
      return;
    }

    const rect = pane.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const last = lastPaneSizeRef.current;
    const widthChanged = !last || width !== last.width;
    const heightChanged = !last || height !== last.height;
    lastPaneSizeRef.current = { width, height };

    if (!force && !widthChanged && !heightChanged) {
      return;
    }

    if (!force && widthChanged === false && heightChanged) {
      const isMobile = window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
      const activeElement = document.activeElement;
      const terminalInputFocused = Boolean(activeElement && pane.contains(activeElement));

      // Mobile soft-keyboard transitions can cause 1-row churn and push
      // visible lines into scrollback. Ignore height-only relayouts while
      // terminal input is focused.
      if (isMobile && terminalInputFocused) {
        return;
      }
    }

    scheduleFit();
  }, [scheduleFit]);

  const focusPane = useCallback(() => {
    focus();
    onFocus?.();
  }, [focus, onFocus]);

  const writeRef = useRef(write);
  writeRef.current = write;

  const subscribedProcessIdRef = useRef<string | null>(null);
  const ptyDataCleanupRef = useRef<(() => void) | null>(null);
  const ptySizeCleanupRef = useRef<(() => void) | null>(null);

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

    scheduleFitForPaneLayout(true);

    const resizeObserver = new ResizeObserver(() => {
      scheduleFitForPaneLayout();
    });
    for (const target of targets) {
      resizeObserver.observe(target);
    }

    const mutationObserver = new MutationObserver(() => {
      scheduleFitForPaneLayout();
    });
    for (const target of targets) {
      mutationObserver.observe(target, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleFitForPaneLayout(true);
      }
    };
    const handleOrientationChange = () => {
      scheduleFitForPaneLayout(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [isReady, scheduleFitForPaneLayout]);

  useEffect(() => {
    if (!isReady) {
      if (ptyDataCleanupRef.current) {
        ptyDataCleanupRef.current();
        ptyDataCleanupRef.current = null;
      }
      if (ptySizeCleanupRef.current) {
        ptySizeCleanupRef.current();
        ptySizeCleanupRef.current = null;
      }
      subscribedProcessIdRef.current = null;
      return;
    }

    if (subscribedProcessIdRef.current === processId) {
      return;
    }

    if (ptyDataCleanupRef.current) {
      ptyDataCleanupRef.current();
      ptyDataCleanupRef.current = null;
    }
    if (ptySizeCleanupRef.current) {
      ptySizeCleanupRef.current();
      ptySizeCleanupRef.current = null;
    }

    subscribedProcessIdRef.current = processId;
    serverTerminalSizeRef.current = null;
    lastCorrectionRef.current = null;
    clear();

    if (!processId) {
      scheduleFit();
      return;
    }

    // Subscribe to PTY data first — this sends the 'attach' message so the
    // server-side PTY is prepared before we send resize dimensions.
    ptyDataCleanupRef.current = onPtyData(processId, (data) => {
      writeRef.current(data);
    });
    ptySizeCleanupRef.current = onPtySize(processId, (cols, rows) => {
      serverTerminalSizeRef.current = { cols, rows };
      reconcileServerSize(processId);
    });
    scheduleFit();
  }, [isReady, processId, onPtyData, onPtySize, clear, scheduleFit, reconcileServerSize]);

  useEffect(() => {
    return () => {
      if (ptyDataCleanupRef.current) {
        ptyDataCleanupRef.current();
        ptyDataCleanupRef.current = null;
      }
      if (ptySizeCleanupRef.current) {
        ptySizeCleanupRef.current();
        ptySizeCleanupRef.current = null;
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

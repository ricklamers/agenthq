// Single terminal pane that can display one process

import { useEffect, useCallback, useRef, forwardRef, useImperativeHandle, useState, type TouchEvent } from 'react';
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
  function TerminalPane({ process, onInput, onResize, onPtyData, isFocused, onFocus }, ref) {
    const paneRef = useRef<HTMLDivElement | null>(null);
    const touchScrollStateRef = useRef<{
      active: boolean;
      startY: number;
      startScrollTop: number;
    }>({
      active: false,
      startY: 0,
      startScrollTop: 0,
    });
    const [isMobile, setIsMobile] = useState(() => {
      if (typeof window === 'undefined') return false;
      return window.matchMedia('(max-width: 767px)').matches;
    });

    useEffect(() => {
      if (typeof window === 'undefined') return;
      const mediaQuery = window.matchMedia('(max-width: 767px)');
      const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
      setIsMobile(mediaQuery.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const handleData = useCallback(
      (data: string) => {
        if (process) {
          onInput(process.id, data);
        }
      },
      [process, onInput]
    );

    const handleResize = useCallback(
      (cols: number, rows: number) => {
        if (process) {
          onResize(process.id, cols, rows);
        }
      },
      [process, onResize]
    );

    const { terminalRef, write, fit, clear, getDimensions, isReady } = useTerminal({
      onData: handleData,
      onResize: handleResize,
    });

    const attachTerminalRef = useCallback((node: HTMLDivElement | null) => {
      terminalRef(node);
    }, [terminalRef]);

    // Expose getDimensions and fit to parent via ref
    useImperativeHandle(ref, () => ({
      getDimensions,
      fit,
    }), [getDimensions, fit]);

    // Keep write function in ref to avoid effect re-runs
    const writeRef = useRef(write);
    writeRef.current = write;

    // Track subscription state to avoid unnecessary resubscribes
    const subscribedProcessIdRef = useRef<string | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);

    // Subscribe to PTY data - only when terminal is ready AND process changes
    useEffect(() => {
      // Don't subscribe until terminal is fully initialized
      if (!isReady) {
        // Terminal not ready - clean up any existing subscription and reset state
        if (cleanupRef.current) {
          cleanupRef.current();
          cleanupRef.current = null;
        }
        subscribedProcessIdRef.current = null;
        return;
      }
      
      const currentProcessId = process?.id ?? null;
      const previousProcessId = subscribedProcessIdRef.current;
      
      // Only act if process actually changed
      if (previousProcessId === currentProcessId) {
        return; // Already subscribed to this process (or both null)
      }
      
      // Clean up previous subscription if any
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      
      subscribedProcessIdRef.current = currentProcessId;
      
      if (!process) {
        clear();
        return;
      }

      // Clear terminal and let buffer replay
      clear();
      fit();

      // Subscribe to PTY data - buffer will be replayed from server
      cleanupRef.current = onPtyData(process.id, (data) => {
        writeRef.current(data);
      });
      
      // After buffer replay, force resize to trigger CLI to redraw
      // Send resize with slightly different size, then correct size
      // This forces TUI apps (Claude Code, Codex) to recalculate layout
      // and reposition their cursor correctly
      const resizeTimeoutId = setTimeout(() => {
        fit();
        const dims = getDimensions();
        if (dims && dims.rows > 1) {
          // Shrink by 1 row, then restore - forces full redraw
          onResize(process.id, dims.cols, dims.rows - 1);
          setTimeout(() => {
            onResize(process.id, dims.cols, dims.rows);
          }, 50);
        }
      }, 200);

      return () => {
        clearTimeout(resizeTimeoutId);
      };
    }, [isReady, process?.id, onPtyData, fit, clear, getDimensions, onResize]);
    
    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (cleanupRef.current) {
          cleanupRef.current();
          cleanupRef.current = null;
        }
      };
    }, []);

    const getViewportElement = useCallback((): HTMLElement | null => {
      return paneRef.current?.querySelector('.xterm-viewport') ?? null;
    }, []);

    const handleLeftTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
      const viewport = getViewportElement();
      if (!viewport) return;
      touchScrollStateRef.current.active = true;
      touchScrollStateRef.current.startY = e.touches[0]?.clientY ?? 0;
      touchScrollStateRef.current.startScrollTop = viewport.scrollTop;
    }, [getViewportElement]);

    const handleLeftTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
      if (!touchScrollStateRef.current.active) return;
      const viewport = getViewportElement();
      if (!viewport) return;

      const currentY = e.touches[0]?.clientY ?? touchScrollStateRef.current.startY;
      const delta = currentY - touchScrollStateRef.current.startY;
      viewport.scrollTop = touchScrollStateRef.current.startScrollTop - delta;
      e.preventDefault();
    }, [getViewportElement]);

    const handleLeftTouchEnd = useCallback(() => {
      touchScrollStateRef.current.active = false;
    }, []);

    return (
      <div 
        ref={paneRef}
        className="relative h-full w-full overflow-hidden bg-[#0a0a0a]"
        onClick={onFocus}
      >
        <div ref={attachTerminalRef} className="h-full w-full" />

        {isMobile && process && (
          <>
            {/* Left half: custom touch-to-scroll for xterm buffer */}
            <div
              className="absolute inset-y-0 left-0 z-10 w-1/2 touch-none"
              onTouchStart={handleLeftTouchStart}
              onTouchMove={handleLeftTouchMove}
              onTouchEnd={handleLeftTouchEnd}
              onTouchCancel={handleLeftTouchEnd}
            />
            {/* Right half: preserve default browser/page touch behavior */}
            <div
              className="absolute inset-y-0 right-0 z-10 w-1/2 touch-pan-y"
              onClick={onFocus}
            />
          </>
        )}
        
        {/* Overlay when no process selected */}
        {!process && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/90">
            <span className="text-muted-foreground">Drop a tab here or select a process</span>
          </div>
        )}
      </div>
    );
  }
);

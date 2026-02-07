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
    const keyboardOffsetDragRef = useRef<{
      active: boolean;
      startY: number;
      startOffsetPx: number;
    }>({
      active: false,
      startY: 0,
      startOffsetPx: 0,
    });
    const touchScrollStateRef = useRef<{
      active: boolean;
      lastY: number;
      pixelRemainder: number;
    }>({
      active: false,
      lastY: 0,
      pixelRemainder: 0,
    });
    const [isMobile, setIsMobile] = useState(() => {
      if (typeof window === 'undefined') return false;
      return window.matchMedia('(max-width: 767px)').matches;
    });
    const [manualKeyboardOffsetPx, setManualKeyboardOffsetPx] = useState(0);

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

    const { terminalRef, write, fit, focus, scrollLines, keyboardInsetPx, clear, getDimensions, isReady } = useTerminal({
      onData: handleData,
      onResize: handleResize,
    });
    const keyboardOpen = isMobile && keyboardInsetPx > 0;

    const focusPane = useCallback(() => {
      focus();
      onFocus?.();
    }, [focus, onFocus]);

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
      focusPane();
      touchScrollStateRef.current.active = true;
      touchScrollStateRef.current.lastY = e.touches[0]?.clientY ?? 0;
      touchScrollStateRef.current.pixelRemainder = 0;
    }, [focusPane]);

    const handleLeftTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
      const state = touchScrollStateRef.current;
      if (!state.active) return;

      const currentY = e.touches[0]?.clientY ?? state.lastY;
      const deltaY = currentY - state.lastY;
      state.lastY = currentY;

      // Prefer direct viewport scrolling; fallback to xterm API when needed.
      const viewport = getViewportElement();
      let didViewportScroll = false;
      if (viewport) {
        const before = viewport.scrollTop;
        viewport.scrollTop -= deltaY;
        didViewportScroll = viewport.scrollTop !== before;
      }

      // Convert touch movement into terminal line scrolling (fallback).
      state.pixelRemainder += -deltaY;
      const lineHeightPx = 18;
      const lines = Math.trunc(state.pixelRemainder / lineHeightPx);
      if (!didViewportScroll && lines !== 0) {
        const before = viewport?.scrollTop;
        scrollLines(lines);
        const after = viewport?.scrollTop;
        // If direction produced no movement, try the opposite direction.
        if (before !== undefined && after !== undefined && before === after) {
          scrollLines(-lines);
        }
        state.pixelRemainder -= lines * lineHeightPx;
      }

      e.preventDefault();
    }, [getViewportElement, scrollLines]);

    const handleLeftTouchEnd = useCallback(() => {
      touchScrollStateRef.current.active = false;
    }, []);

    const clampKeyboardOffset = useCallback((offsetPx: number) => {
      const range = Math.max(140, keyboardInsetPx * 2.25);
      return Math.max(-range, Math.min(range, offsetPx));
    }, [keyboardInsetPx]);

    const handleOffsetTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
      if (!keyboardOpen) {
        focusPane();
        return;
      }
      focusPane();
      keyboardOffsetDragRef.current.active = true;
      keyboardOffsetDragRef.current.startY = e.touches[0]?.clientY ?? 0;
      keyboardOffsetDragRef.current.startOffsetPx = manualKeyboardOffsetPx;
    }, [focusPane, keyboardOpen, manualKeyboardOffsetPx]);

    const handleOffsetTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
      if (!keyboardOpen || !keyboardOffsetDragRef.current.active) return;
      const currentY = e.touches[0]?.clientY ?? keyboardOffsetDragRef.current.startY;
      const deltaY = currentY - keyboardOffsetDragRef.current.startY;
      setManualKeyboardOffsetPx(clampKeyboardOffset(keyboardOffsetDragRef.current.startOffsetPx + deltaY));
      e.preventDefault();
    }, [clampKeyboardOffset, keyboardOpen]);

    const handleOffsetTouchEnd = useCallback(() => {
      keyboardOffsetDragRef.current.active = false;
    }, []);

    useEffect(() => {
      if (!keyboardOpen && manualKeyboardOffsetPx !== 0) {
        setManualKeyboardOffsetPx(0);
      }
      if (!keyboardOpen) {
        keyboardOffsetDragRef.current.active = false;
      }
    }, [keyboardOpen, manualKeyboardOffsetPx]);

    return (
      <div 
        ref={paneRef}
        className="relative h-full w-full overflow-hidden bg-[#0a0a0a]"
        onClick={focusPane}
      >
        <div
          className="h-full w-full transition-transform duration-150 ease-out"
          style={
            keyboardOpen && manualKeyboardOffsetPx !== 0
              ? { transform: `translateY(${manualKeyboardOffsetPx}px)` }
              : undefined
          }
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
                className={`absolute inset-y-0 right-0 z-10 w-1/2 ${keyboardOpen ? 'touch-none' : 'touch-pan-y'}`}
                onTouchStart={handleOffsetTouchStart}
                onTouchMove={handleOffsetTouchMove}
                onTouchEnd={handleOffsetTouchEnd}
                onTouchCancel={handleOffsetTouchEnd}
                onClick={focusPane}
              />
            </>
          )}
        </div>
        
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

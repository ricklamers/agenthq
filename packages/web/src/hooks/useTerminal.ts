// xterm.js terminal hook

import { useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';

interface UseTerminalOptions {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

interface UseTerminalReturn {
  terminalRef: (node: HTMLDivElement | null) => void;
  write: (data: string) => void;
  fit: () => void;
  clear: () => void;
  getDimensions: () => { cols: number; rows: number } | null;
  serialize: () => string | null;
  restore: (data: string) => void;
  isReady: boolean;
}

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalReturn {
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const visualViewportCleanupRef = useRef<(() => void) | null>(null);
  const onDataRef = useRef(options.onData);
  const onResizeRef = useRef(options.onResize);
  const lastResizeSentRef = useRef<{ cols: number; rows: number } | null>(null);
  const viewportStateRef = useRef({
    isMobile: false,
    keyboardLikelyOpen: false,
    maxViewportHeight: 0,
    suppressResizeUntil: 0,
  });
  
  // Track when terminal is fully initialized and ready to receive data
  const [isReady, setIsReady] = useState(false);

  // Keep refs updated
  onDataRef.current = options.onData;
  onResizeRef.current = options.onResize;

  // Use callback ref to initialize terminal when DOM element is available
  const terminalRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous terminal if container changes
    if (containerRef.current && containerRef.current !== node) {
      resizeObserverRef.current?.disconnect();
      visualViewportCleanupRef.current?.();
      visualViewportCleanupRef.current = null;
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      setIsReady(false);
    }

    containerRef.current = node;

    if (!node || xtermRef.current) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#fafafa',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Load serialize addon for saving/restoring terminal state
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);
    serializeAddonRef.current = serializeAddon;

    // Load Unicode11 addon for proper character width calculation
    // Required for rendering Unicode box-drawing/block characters correctly
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    // Try to load WebGL addon for better performance
    try {
      const webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
    } catch (e) {
      console.warn('WebGL addon not supported:', e);
    }

    terminal.open(node);
    fitAddon.fit();

    if (typeof window !== 'undefined') {
      const isMobile = window.matchMedia('(max-width: 767px)').matches;
      viewportStateRef.current.isMobile = isMobile;

      const visualViewport = window.visualViewport;
      if (isMobile && visualViewport) {
        const updateKeyboardState = () => {
          const state = viewportStateRef.current;
          if (visualViewport.height > state.maxViewportHeight) {
            state.maxViewportHeight = visualViewport.height;
          }

          const previous = state.keyboardLikelyOpen;
          const keyboardLikelyOpen = state.maxViewportHeight > 0
            ? visualViewport.height < state.maxViewportHeight - 120
            : false;

          state.keyboardLikelyOpen = keyboardLikelyOpen;
          if (keyboardLikelyOpen !== previous) {
            // Ignore transient mobile keyboard viewport changes.
            state.suppressResizeUntil = Date.now() + 700;
          }
        };

        updateKeyboardState();
        visualViewport.addEventListener('resize', updateKeyboardState);
        visualViewport.addEventListener('scroll', updateKeyboardState);
        visualViewportCleanupRef.current = () => {
          visualViewport.removeEventListener('resize', updateKeyboardState);
          visualViewport.removeEventListener('scroll', updateKeyboardState);
        };
      }
    }

    // Handle user input via ref to avoid re-subscribing
    terminal.onData((data) => {
      onDataRef.current?.(data);
    });

    // Handle resize via ref
    terminal.onResize(({ cols, rows }) => {
      const viewportState = viewportStateRef.current;
      const shouldSuppressForMobileKeyboard = viewportState.isMobile
        && (viewportState.keyboardLikelyOpen || Date.now() < viewportState.suppressResizeUntil);
      if (shouldSuppressForMobileKeyboard) {
        return;
      }

      const last = lastResizeSentRef.current;
      if (last && last.cols === cols && last.rows === rows) {
        return;
      }
      lastResizeSentRef.current = { cols, rows };
      onResizeRef.current?.(cols, rows);
    });

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(node);
    resizeObserverRef.current = resizeObserver;
    
    // Mark terminal as ready after a short delay to ensure layout is stable
    // This prevents subscribing to PTY data before the terminal can render it
    setTimeout(() => {
      // Double-check terminal still exists (might have been cleaned up)
      if (xtermRef.current) {
        fitAddon.fit();
        setIsReady(true);
      }
    }, 50);
  }, []);

  const write = useCallback((data: string) => {
    const term = xtermRef.current;
    if (term) {
      term.write(data);
    }
  }, []);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const clear = useCallback(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;
    // Clear screen and scrollback without full reset
    // This preserves cursor visibility state (important for TUI apps that hide cursor)
    // ESC[2J = clear entire screen, ESC[3J = clear scrollback, ESC[H = cursor to home
    terminal.write('\x1b[2J\x1b[3J\x1b[H');
  }, []);

  const getDimensions = useCallback((): { cols: number; rows: number } | null => {
    const terminal = xtermRef.current;
    if (!terminal) return null;
    return { cols: terminal.cols, rows: terminal.rows };
  }, []);

  // Serialize terminal state (content + cursor position)
  const serialize = useCallback((): string | null => {
    const addon = serializeAddonRef.current;
    if (!addon) return null;
    return addon.serialize();
  }, []);

  // Restore terminal state from serialized data
  const restore = useCallback((data: string) => {
    const terminal = xtermRef.current;
    if (!terminal) return;
    terminal.reset();
    terminal.write(data);
  }, []);

  return { terminalRef, write, fit, clear, getDimensions, serialize, restore, isReady };
}

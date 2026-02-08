// xterm.js terminal hook

import { useRef, useCallback, useState, useEffect } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

import type { ResolvedTheme } from './useTheme';

const darkTerminalTheme = {
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
};

const lightTerminalTheme = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  cursorAccent: '#ffffff',
  selectionBackground: '#b4d5fe',
  black: '#1a1a1a',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#e5e5e5',
  brightBlack: '#737373',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
};

function getTerminalTheme(resolvedTheme: ResolvedTheme) {
  return resolvedTheme === 'dark' ? darkTerminalTheme : lightTerminalTheme;
}

interface UseTerminalOptions {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  resolvedTheme?: ResolvedTheme;
}

interface UseTerminalReturn {
  terminalRef: (node: HTMLDivElement | null) => void;
  write: (data: string) => void;
  fit: () => void;
  focus: () => void;
  clear: () => void;
  getDimensions: () => { cols: number; rows: number } | null;
  isReady: boolean;
}

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalReturn {
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fitRafRef = useRef<number | null>(null);
  const fitTimeoutRef = useRef<number | null>(null);
  const windowResizeListenerRef = useRef<(() => void) | null>(null);
  const fontLoadingDoneListenerRef = useRef<(() => void) | null>(null);
  const lastContainerSizeRef = useRef<{ width: number; height: number } | null>(null);
  const onDataRef = useRef(options.onData);
  const onResizeRef = useRef(options.onResize);
  const lastResizeSentRef = useRef<{ cols: number; rows: number } | null>(null);
  const [isReady, setIsReady] = useState(false);

  onDataRef.current = options.onData;
  onResizeRef.current = options.onResize;

  const cleanupTerminal = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (fitRafRef.current !== null) {
      window.cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = null;
    }
    if (fitTimeoutRef.current !== null) {
      window.clearTimeout(fitTimeoutRef.current);
      fitTimeoutRef.current = null;
    }
    if (windowResizeListenerRef.current) {
      window.removeEventListener('resize', windowResizeListenerRef.current);
      windowResizeListenerRef.current = null;
    }
    if (fontLoadingDoneListenerRef.current && 'fonts' in document) {
      document.fonts.removeEventListener('loadingdone', fontLoadingDoneListenerRef.current);
      fontLoadingDoneListenerRef.current = null;
    }
    xtermRef.current?.dispose();
    xtermRef.current = null;
    fitAddonRef.current = null;
    lastResizeSentRef.current = null;
    lastContainerSizeRef.current = null;
    setIsReady(false);
  }, []);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const scheduleFit = useCallback(() => {
    if (!fitAddonRef.current) return;
    if (fitRafRef.current !== null) {
      window.cancelAnimationFrame(fitRafRef.current);
    }
    fitRafRef.current = window.requestAnimationFrame(() => {
      fitRafRef.current = null;
      fitAddonRef.current?.fit();
    });
  }, []);

  const scheduleSettledFit = useCallback(() => {
    if (!fitAddonRef.current) return;
    if (fitTimeoutRef.current !== null) {
      window.clearTimeout(fitTimeoutRef.current);
    }
    fitTimeoutRef.current = window.setTimeout(() => {
      fitTimeoutRef.current = null;
      fitAddonRef.current?.fit();
    }, 120);
  }, []);

  const terminalRef = useCallback((node: HTMLDivElement | null) => {
    if (containerRef.current && containerRef.current !== node) {
      cleanupTerminal();
    }

    containerRef.current = node;
    if (!node || xtermRef.current) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      theme: getTerminalTheme(options.resolvedTheme ?? 'dark'),
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

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
    fitAddonRef.current = fitAddon;
    fitAddon.fit();

    terminal.onData((data) => {
      onDataRef.current?.(data);
    });

    terminal.onResize(({ cols, rows }) => {
      const last = lastResizeSentRef.current;
      if (last && last.cols === cols && last.rows === rows) {
        return;
      }
      lastResizeSentRef.current = { cols, rows };
      onResizeRef.current?.(cols, rows);
    });

    xtermRef.current = terminal;

    // Run an additional fit pass after layout settles.
    scheduleFit();
    scheduleSettledFit();

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      const last = lastContainerSizeRef.current;
      if (last && last.width === width && last.height === height) {
        return;
      }

      lastContainerSizeRef.current = { width, height };
      scheduleFit();
      scheduleSettledFit();
    });
    resizeObserver.observe(node);
    resizeObserverRef.current = resizeObserver;

    const handleWindowResize = () => {
      scheduleFit();
      scheduleSettledFit();
    };
    window.addEventListener('resize', handleWindowResize);
    windowResizeListenerRef.current = handleWindowResize;

    if ('fonts' in document) {
      const handleFontLoadingDone = () => {
        scheduleFit();
        scheduleSettledFit();
      };
      document.fonts.addEventListener('loadingdone', handleFontLoadingDone);
      document.fonts.ready.then(() => {
        scheduleFit();
        scheduleSettledFit();
      });
      fontLoadingDoneListenerRef.current = handleFontLoadingDone;
    }

    setIsReady(true);
  }, [cleanupTerminal, scheduleFit, scheduleSettledFit]);

  const write = useCallback((data: string) => {
    xtermRef.current?.write(data);
  }, []);

  const focus = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  const clear = useCallback(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;
    terminal.write('\x1b[2J\x1b[3J\x1b[H');
  }, []);

  const getDimensions = useCallback((): { cols: number; rows: number } | null => {
    const terminal = xtermRef.current;
    if (!terminal) return null;
    return { cols: terminal.cols, rows: terminal.rows };
  }, []);

  // Update terminal theme when resolvedTheme changes
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;
    terminal.options.theme = getTerminalTheme(options.resolvedTheme ?? 'dark');
  }, [options.resolvedTheme]);

  return { terminalRef, write, fit, focus, clear, getDimensions, isReady };
}

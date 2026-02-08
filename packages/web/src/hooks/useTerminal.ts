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
  isReady: boolean;
}

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalReturn {
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitRafRef = useRef<number | null>(null);
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);
  const touchCleanupRef = useRef<(() => void) | null>(null);
  const onDataRef = useRef(options.onData);
  const onResizeRef = useRef(options.onResize);
  const [isReady, setIsReady] = useState(false);

  onDataRef.current = options.onData;
  onResizeRef.current = options.onResize;

  const cleanupTerminal = useCallback(() => {
    if (fitRafRef.current !== null) {
      window.cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = null;
    }
    if (wheelHandlerRef.current && containerRef.current) {
      containerRef.current.removeEventListener('wheel', wheelHandlerRef.current);
      wheelHandlerRef.current = null;
    }
    touchCleanupRef.current?.();
    touchCleanupRef.current = null;
    xtermRef.current?.dispose();
    xtermRef.current = null;
    fitAddonRef.current = null;
    setIsReady(false);
  }, []);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
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

    const webglAddon = new WebglAddon();
    terminal.loadAddon(webglAddon);
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
    });

    terminal.open(node);
    fitAddonRef.current = fitAddon;
    xtermRef.current = terminal;

    // WebGL canvas eats wheel/touch events — manually scroll the buffer
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const lines = Math.round(e.deltaY / 20);
      terminal.scrollLines(lines);
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    wheelHandlerRef.current = handleWheel;

    // Touch drag to scroll
    let touchStartY: number | null = null;
    let accumDelta = 0;
    const lineHeight = Math.ceil((terminal.options.fontSize ?? 14) * 1.2);

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (e.touches.length === 1 && touch) {
        touchStartY = touch.clientY;
        accumDelta = 0;
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touchStartY === null || e.touches.length !== 1 || !touch) return;
      e.preventDefault();
      const currentY = touch.clientY;
      const deltaY = touchStartY - currentY;
      touchStartY = currentY;
      accumDelta += deltaY;
      const lines = Math.trunc(accumDelta / lineHeight);
      if (lines !== 0) {
        accumDelta -= lines * lineHeight;
        terminal.scrollLines(lines);
      }
    };
    const handleTouchEnd = () => {
      touchStartY = null;
      accumDelta = 0;
    };

    node.addEventListener('touchstart', handleTouchStart, { passive: true });
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('touchend', handleTouchEnd, { passive: true });
    touchCleanupRef.current = () => {
      node.removeEventListener('touchstart', handleTouchStart);
      node.removeEventListener('touchmove', handleTouchMove);
      node.removeEventListener('touchend', handleTouchEnd);
    };

    terminal.onData((data) => {
      onDataRef.current?.(data);
    });

    terminal.onResize(({ cols, rows }) => {
      onResizeRef.current?.(cols, rows);
    });

    fitAddon.fit();
    fitRafRef.current = window.requestAnimationFrame(() => {
      fitRafRef.current = null;
      fitAddon.fit();
    });

    setIsReady(true);
  }, [cleanupTerminal]);

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

  // Update terminal theme when resolvedTheme changes
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;
    terminal.options.theme = getTerminalTheme(options.resolvedTheme ?? 'dark');
  }, [options.resolvedTheme]);

  return { terminalRef, write, fit, focus, clear, isReady };
}

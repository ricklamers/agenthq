// WebSocket connection hook

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BrowserToServerMessage,
  ServerToBrowserMessage,
  Environment,
  Process,
  Worktree,
} from '@agenthq/shared';
import { WS_BROWSER_PATH } from '@agenthq/shared';

const RECONNECT_DELAY_MS = 2000;

interface UseWebSocketReturn {
  connected: boolean;
  environments: Environment[];
  worktrees: Map<string, Worktree>;
  processes: Map<string, Process>;
  send: (message: BrowserToServerMessage) => void;
  onPtyData: (processId: string, handler: (data: string) => void, skipBuffer?: boolean) => () => void;
  onPtySize: (processId: string, handler: (cols: number, rows: number) => void) => () => void;
}

export function useWebSocket(enabled = true): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const hasConnectedOnceRef = useRef(false);
  const enabledRef = useRef(enabled);
  const ptyHandlersRef = useRef(new Map<string, Set<(data: string) => void>>());
  const ptyAttachOptionsRef = useRef(new Map<string, { skipBuffer?: boolean }>());
  const ptySizeHandlersRef = useRef(new Map<string, Set<(cols: number, rows: number) => void>>());
  const pendingMessagesRef = useRef<BrowserToServerMessage[]>([]);

  const [connected, setConnected] = useState(false);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [worktrees, setWorktrees] = useState<Map<string, Worktree>>(new Map());
  const [processes, setProcesses] = useState<Map<string, Process>>(new Map());

  const handleMessage = useCallback((message: ServerToBrowserMessage) => {
    switch (message.type) {
      case 'env-update':
        setEnvironments(message.environments);
        break;

      case 'worktree-update':
        setWorktrees((prev) => {
          const next = new Map(prev);
          next.set(message.worktree.id, message.worktree);
          return next;
        });
        break;

      case 'worktree-removed':
        setWorktrees((prev) => {
          const next = new Map(prev);
          next.delete(message.worktreeId);
          return next;
        });
        break;

      case 'process-update':
        setProcesses((prev) => {
          const next = new Map(prev);
          next.set(message.process.id, message.process);
          return next;
        });
        break;

      case 'process-removed':
        setProcesses((prev) => {
          const next = new Map(prev);
          next.delete(message.processId);
          return next;
        });
        break;

      case 'pty-data': {
        const handlers = ptyHandlersRef.current.get(message.processId);
        if (handlers) {
          for (const handler of handlers) {
            handler(message.data);
          }
        }
        break;
      }

      case 'pty-size': {
        const handlers = ptySizeHandlersRef.current.get(message.processId);
        if (handlers) {
          for (const handler of handlers) {
            handler(message.cols, message.rows);
          }
        }
        break;
      }

      case 'error':
        console.error('Server error:', message.message);
        break;
    }
  }, []);

  const isSocketActive = useCallback((ws: WebSocket | null) => {
    return ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING;
  }, []);

  const connect = useCallback(() => {
    if (!enabledRef.current) {
      return;
    }
    if (isSocketActive(wsRef.current)) {
      return;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}${WS_BROWSER_PATH}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);

      const isReconnect = hasConnectedOnceRef.current;
      hasConnectedOnceRef.current = true;

      if (isReconnect) {
        for (const processId of ptyHandlersRef.current.keys()) {
          const attachOptions = ptyAttachOptionsRef.current.get(processId);
          const attachMessage: BrowserToServerMessage =
            attachOptions?.skipBuffer === undefined
              ? { type: 'attach', processId }
              : { type: 'attach', processId, skipBuffer: attachOptions.skipBuffer };
          ws.send(JSON.stringify(attachMessage));
        }
      }

      // Flush any messages that were queued before connection.
      const pending = pendingMessagesRef.current;
      pendingMessagesRef.current = [];
      for (const msg of pending) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerToBrowserMessage;
        handleMessage(message);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      if (!enabledRef.current) {
        return;
      }

      // Reconnect after delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = undefined;
        connect();
      }, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }, [handleMessage, isSocketActive]);

  useEffect(() => {
    enabledRef.current = enabled;

    if (!enabled) {
      setConnected(false);
      wsRef.current?.close();
      wsRef.current = null;
      pendingMessagesRef.current = [];
      ptyHandlersRef.current.clear();
      ptyAttachOptionsRef.current.clear();
      ptySizeHandlersRef.current.clear();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
      return;
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
      wsRef.current?.close();
    };
  }, [connect, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const reconnectIfNeeded = () => {
      if (!enabledRef.current || isSocketActive(wsRef.current)) {
        return;
      }
      connect();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconnectIfNeeded();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', reconnectIfNeeded);
    window.addEventListener('online', reconnectIfNeeded);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', reconnectIfNeeded);
      window.removeEventListener('online', reconnectIfNeeded);
    };
  }, [connect, enabled, isSocketActive]);

  const send = useCallback((message: BrowserToServerMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      // Never queue resize: send live only, no caching/filtering.
      if (message.type === 'resize') {
        return;
      }

      // Queue non-resize messages to send when WebSocket connects.
      pendingMessagesRef.current.push(message);
    }
  }, []);

  const onPtyData = useCallback(
    (processId: string, handler: (data: string) => void, skipBuffer?: boolean) => {
      const isFirstHandler = !ptyHandlersRef.current.has(processId) || 
                             ptyHandlersRef.current.get(processId)!.size === 0;
      
      if (!ptyHandlersRef.current.has(processId)) {
        ptyHandlersRef.current.set(processId, new Set());
      }
      ptyHandlersRef.current.get(processId)!.add(handler);

      // Only send attach on first handler registration
      if (isFirstHandler) {
        ptyAttachOptionsRef.current.set(processId, { skipBuffer });
        send({ type: 'attach', processId, skipBuffer });
      }

      // Return cleanup function
      return () => {
        ptyHandlersRef.current.get(processId)?.delete(handler);
        if (ptyHandlersRef.current.get(processId)?.size === 0) {
          ptyHandlersRef.current.delete(processId);
          ptyAttachOptionsRef.current.delete(processId);
          send({ type: 'detach', processId });
        }
      };
    },
    [send]
  );

  const onPtySize = useCallback((processId: string, handler: (cols: number, rows: number) => void) => {
    if (!ptySizeHandlersRef.current.has(processId)) {
      ptySizeHandlersRef.current.set(processId, new Set());
    }
    ptySizeHandlersRef.current.get(processId)!.add(handler);

    return () => {
      ptySizeHandlersRef.current.get(processId)?.delete(handler);
      if (ptySizeHandlersRef.current.get(processId)?.size === 0) {
        ptySizeHandlersRef.current.delete(processId);
      }
    };
  }, []);

  return { connected, environments, worktrees, processes, send, onPtyData, onPtySize };
}

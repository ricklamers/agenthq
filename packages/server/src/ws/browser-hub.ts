// WebSocket hub for browser connections

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { BrowserToServerMessage, ServerToBrowserMessage, Process, Worktree } from '@agenthq/shared';
import { WS_BROWSER_PATH } from '@agenthq/shared';
import { envStore, processStore, worktreeStore } from '../state/index.js';
import { daemonHub } from './daemon-hub.js';

// Helper to encode string to base64
function encodeBase64(data: string): string {
  return Buffer.from(data, 'utf-8').toString('base64');
}

interface BrowserConnection {
  ws: WebSocket;
  attachedProcesses: Set<string>;
}

class BrowserHub {
  private connections = new Set<BrowserConnection>();
  private processSubscribers = new Map<string, Set<BrowserConnection>>();

  add(ws: WebSocket): BrowserConnection {
    const conn: BrowserConnection = { ws, attachedProcesses: new Set() };
    this.connections.add(conn);
    return conn;
  }

  remove(conn: BrowserConnection): void {
    // Unsubscribe from all processes
    for (const processId of conn.attachedProcesses) {
      this.processSubscribers.get(processId)?.delete(conn);
    }
    this.connections.delete(conn);
  }

  handleMessage(conn: BrowserConnection, data: string): void {
    let message: BrowserToServerMessage;
    try {
      message = JSON.parse(data);
    } catch {
      console.error('Invalid JSON from browser:', data);
      return;
    }

    switch (message.type) {
      case 'attach': {
        // Subscribe to process updates
        conn.attachedProcesses.add(message.processId);
        if (!this.processSubscribers.has(message.processId)) {
          this.processSubscribers.set(message.processId, new Set());
        }
        this.processSubscribers.get(message.processId)!.add(conn);

        // Send existing buffer unless skipBuffer is set
        // skipBuffer is used when restoring from cached terminal state
        if (!message.skipBuffer) {
          const buffer = processStore.getBuffer(message.processId);
          if (buffer) {
            this.send(conn, {
              type: 'pty-data',
              processId: message.processId,
              data: buffer,
            });
          }
        }

        // Send current process state
        const process = processStore.get(message.processId);
        if (process) {
          this.send(conn, { type: 'process-update', process });
        }
        break;
      }

      case 'detach': {
        conn.attachedProcesses.delete(message.processId);
        this.processSubscribers.get(message.processId)?.delete(conn);
        break;
      }

      case 'input': {
        // Forward to daemon (encode as base64)
        const process = processStore.get(message.processId);
        if (process) {
          daemonHub.sendToEnv(process.envId, {
            type: 'pty-input',
            processId: message.processId,
            data: encodeBase64(message.data),
          });
        }
        break;
      }

      case 'resize': {
        // Forward to daemon
        const process = processStore.get(message.processId);
        if (process) {
          daemonHub.sendToEnv(process.envId, {
            type: 'resize',
            processId: message.processId,
            cols: message.cols,
            rows: message.rows,
          });
        }
        break;
      }
    }
  }

  send(conn: BrowserConnection, message: ServerToBrowserMessage): void {
    if (conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify(message));
    }
  }

  sendToProcess(processId: string, message: ServerToBrowserMessage): void {
    const subscribers = this.processSubscribers.get(processId);
    if (subscribers) {
      for (const conn of subscribers) {
        this.send(conn, message);
      }
    }
  }

  broadcast(message: ServerToBrowserMessage): void {
    for (const conn of this.connections) {
      this.send(conn, message);
    }
  }

  broadcastEnvUpdate(): void {
    this.broadcast({
      type: 'env-update',
      environments: envStore.getAll(),
    });
  }

  broadcastProcessUpdate(process: Process): void {
    this.broadcast({ type: 'process-update', process });
  }

  broadcastProcessRemoved(processId: string): void {
    this.broadcast({ type: 'process-removed', processId });
  }

  broadcastWorktreeUpdate(worktree: Worktree): void {
    this.broadcast({ type: 'worktree-update', worktree });
  }

  broadcastWorktreeRemoved(worktreeId: string): void {
    this.broadcast({ type: 'worktree-removed', worktreeId });
  }
}

export const browserHub = new BrowserHub();

export function registerBrowserWs(app: FastifyInstance): void {
  app.register(async (fastify) => {
    fastify.get(WS_BROWSER_PATH, { websocket: true }, (socket) => {
      console.log('Browser WebSocket connected');
      const conn = browserHub.add(socket);

      // Send initial state - environments
      browserHub.send(conn, {
        type: 'env-update',
        environments: envStore.getAll(),
      });

      // Send initial state - all worktrees
      for (const worktree of worktreeStore.getAll()) {
        browserHub.send(conn, { type: 'worktree-update', worktree });
      }

      // Send initial state - all processes
      for (const process of processStore.getAll()) {
        browserHub.send(conn, { type: 'process-update', process });
      }

      socket.on('message', (data) => {
        browserHub.handleMessage(conn, data.toString());
      });

      socket.on('close', () => {
        browserHub.remove(conn);
        console.log('Browser WebSocket disconnected');
      });

      socket.on('error', (err) => {
        console.error('Browser WebSocket error:', err);
        browserHub.remove(conn);
      });
    });
  });
}

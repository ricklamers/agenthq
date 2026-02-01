// WebSocket hub for daemon connections

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { DaemonToServerMessage, ServerToDaemonMessage } from '@agenthq/shared';
import { WS_DAEMON_PATH } from '@agenthq/shared';
import { envStore, processStore, worktreeStore } from '../state/index.js';
import { browserHub } from './browser-hub.js';

// Helper to decode base64 to string
function decodeBase64(data: string): string {
  return Buffer.from(data, 'base64').toString('utf-8');
}

class DaemonHub {
  sendToEnv(envId: string, message: ServerToDaemonMessage): boolean {
    const ws = envStore.getSocket(envId);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  handleMessage(ws: WebSocket, envId: string | null, data: string): string | null {
    let message: DaemonToServerMessage;
    try {
      message = JSON.parse(data);
    } catch {
      console.error('Invalid JSON from daemon:', data);
      return envId;
    }

    switch (message.type) {
      case 'register': {
        envId = message.envId;
        envStore.register({
          id: message.envId,
          name: message.envName,
          capabilities: message.capabilities,
          ws,
        });
        console.log(`Daemon registered: ${message.envName} (${message.envId})`);
        browserHub.broadcastEnvUpdate();
        break;
      }

      case 'heartbeat': {
        if (envId) {
          envStore.heartbeat(envId);
        }
        break;
      }

      case 'pty-data': {
        const process = processStore.get(message.processId);
        if (process) {
          // Decode base64 data from daemon
          const decodedData = decodeBase64(message.data);
          // Store in buffer
          processStore.appendBuffer(message.processId, decodedData);
          // Update status if pending
          if (process.status === 'pending') {
            processStore.updateStatus(message.processId, 'running');
          }
          // Forward to browsers (as plain string)
          browserHub.sendToProcess(message.processId, {
            type: 'pty-data',
            processId: message.processId,
            data: decodedData,
          });
        }
        break;
      }

      case 'process-started': {
        const updated = processStore.updateStatus(message.processId, 'running');
        if (updated) {
          browserHub.broadcastProcessUpdate(updated);
        }
        console.log(`Process ${message.processId} started`);
        break;
      }

      case 'process-exit': {
        const updated = processStore.updateStatus(message.processId, 'stopped', message.exitCode);
        if (updated) {
          browserHub.broadcastProcessUpdate(updated);
        }
        console.log(`Process ${message.processId} exited with code ${message.exitCode}`);
        break;
      }

      case 'worktree-ready': {
        const worktree = worktreeStore.get(message.worktreeId);
        if (worktree) {
          worktreeStore.updatePath(message.worktreeId, message.path);
          worktreeStore.updateBranch(message.worktreeId, message.branch);
          const updated = worktreeStore.get(message.worktreeId);
          if (updated) {
            browserHub.broadcastWorktreeUpdate(updated);
          }
        }
        console.log(`Worktree ${message.worktreeId} ready at ${message.path}`);
        break;
      }

      case 'branch-changed': {
        const updated = worktreeStore.updateBranch(message.worktreeId, message.branch);
        if (updated) {
          browserHub.broadcastWorktreeUpdate(updated);
        }
        break;
      }
    }

    return envId;
  }

  handleClose(envId: string | null): void {
    if (envId) {
      // Mark all processes from this env as stopped
      const processes = processStore.getByEnv(envId);
      for (const process of processes) {
        if (process.status === 'running' || process.status === 'pending') {
          const updated = processStore.updateStatus(process.id, 'stopped');
          if (updated) {
            browserHub.broadcastProcessUpdate(updated);
          }
        }
      }
      envStore.unregister(envId);
      console.log(`Daemon disconnected: ${envId}`);
      browserHub.broadcastEnvUpdate();
    }
  }
}

export const daemonHub = new DaemonHub();

export function registerDaemonWs(app: FastifyInstance): void {
  app.register(async (fastify) => {
    fastify.get(WS_DAEMON_PATH, { websocket: true }, (socket) => {
      console.log('Daemon WebSocket connected');
      let envId: string | null = null;

      socket.on('message', (data) => {
        envId = daemonHub.handleMessage(socket, envId, data.toString());
      });

      socket.on('close', () => {
        daemonHub.handleClose(envId);
      });

      socket.on('error', (err) => {
        console.error('Daemon WebSocket error:', err);
        daemonHub.handleClose(envId);
      });
    });
  });
}

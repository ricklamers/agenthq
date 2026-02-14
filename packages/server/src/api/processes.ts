// Process API routes

import type { FastifyInstance } from 'fastify';
import type { AgentType } from '@agenthq/shared';
import { processStore, envStore, worktreeStore } from '../state/index.js';
import { daemonHub } from '../ws/daemon-hub.js';
import { browserHub } from '../ws/browser-hub.js';

interface CreateProcessBody {
  agent: AgentType;
  task?: string;
  envId: string;
  cols?: number;
  rows?: number;
  yoloMode?: boolean;
}

// Minimum usable terminal dimensions.  Sub-20-col sizes are almost
// certainly transient measurements from the frontend during initial layout.
const MIN_COLS = 20;
const MIN_ROWS = 5;

function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
  return (
    typeof cols === 'number' &&
    typeof rows === 'number' &&
    Number.isFinite(cols) &&
    Number.isFinite(rows) &&
    cols >= MIN_COLS &&
    rows >= MIN_ROWS
  );
}

export async function registerProcessRoutes(app: FastifyInstance): Promise<void> {
  // List all processes
  app.get('/api/processes', async () => {
    return processStore.getAll();
  });

  // Get process details
  app.get<{ Params: { id: string } }>('/api/processes/:id', async (request, reply) => {
    const process = processStore.get(request.params.id);
    if (!process) {
      return reply.status(404).send({ error: 'Process not found' });
    }
    return process;
  });

  // Spawn process in worktree
  app.post<{ Params: { id: string }; Body: CreateProcessBody }>(
    '/api/worktrees/:id/processes',
    async (request, reply) => {
      const { id: worktreeId } = request.params;
      const { agent, task, envId, cols, rows, yoloMode } = request.body;

      if (!isValidTerminalSize(cols, rows)) {
        return reply.status(400).send({
          error: 'Invalid terminal size: cols and rows must be positive numbers measured by the frontend',
        });
      }

      // Validate environment
      const env = envStore.get(envId);
      if (!env) {
        return reply.status(400).send({ error: 'Environment not connected' });
      }

      // Validate worktree
      const worktree = worktreeStore.get(worktreeId);
      if (!worktree) {
        return reply.status(400).send({ error: 'Worktree not found' });
      }

      // Worktree must have a path (set when daemon confirms worktree creation)
      if (!worktree.path) {
        return reply.status(400).send({ error: 'Worktree not ready - path not yet set by daemon' });
      }

      // Create process
      const process = processStore.create({
        worktreeId,
        agent,
        envId,
      });

      // Send spawn command to daemon
      const sent = daemonHub.sendToEnv(envId, {
        type: 'spawn',
        processId: process.id,
        worktreeId,
        worktreePath: worktree.path,
        agent,
        args: [],
        task,
        cols,
        rows,
        yoloMode: yoloMode || false,
      });

      if (!sent) {
        processStore.delete(process.id);
        return reply.status(500).send({ error: 'Failed to send spawn command' });
      }

      // Broadcast to browsers
      browserHub.broadcastProcessUpdate(process);

      return process;
    }
  );

  // Kill or remove process
  // - Without ?remove=true: sends kill signal to daemon (for running processes)
  // - With ?remove=true: removes process from store entirely (for stopped processes)
  app.delete<{ Params: { id: string }; Querystring: { remove?: string } }>(
    '/api/processes/:id',
    async (request, reply) => {
      const process = processStore.get(request.params.id);
      if (!process) {
        return reply.status(404).send({ error: 'Process not found' });
      }

      const shouldRemove = request.query.remove === 'true';

      if (shouldRemove) {
        // Remove from store entirely
        processStore.delete(process.id);
        // Broadcast removal to browsers
        browserHub.broadcastProcessRemoved(process.id);
        return { success: true, removed: true };
      }

      // Send kill command to daemon
      daemonHub.sendToEnv(process.envId, {
        type: 'kill',
        processId: process.id,
      });

      return { success: true };
    }
  );
}

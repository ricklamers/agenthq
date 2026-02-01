// Session API routes

import type { FastifyInstance } from 'fastify';
import type { AgentType } from '@agenthq/shared';
import { sessionStore, envStore, repoStore } from '../state/index.js';
import { daemonHub } from '../ws/daemon-hub.js';
import { browserHub } from '../ws/browser-hub.js';

interface CreateSessionBody {
  repoName: string;
  agent: AgentType;
  task?: string;
  envId: string;
  cols?: number;  // Initial terminal width
  rows?: number;  // Initial terminal height
}

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  // List all sessions
  app.get('/api/sessions', async () => {
    return sessionStore.getAll();
  });

  // Get session details
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = sessionStore.get(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session;
  });

  // Create new session
  app.post<{ Body: CreateSessionBody }>('/api/sessions', async (request, reply) => {
    const { repoName, agent, task, envId, cols, rows } = request.body;

    // Validate environment
    const env = envStore.get(envId);
    if (!env) {
      return reply.status(400).send({ error: 'Environment not connected' });
    }

    // Validate repo
    const repo = repoStore.get(repoName);
    if (!repo) {
      return reply.status(400).send({ error: 'Repo not found' });
    }

    // Create session
    const session = sessionStore.create({
      repoName,
      agent,
      envId,
      worktreePath: repo.path, // Will be updated when worktree is created
      branch: `agent/${sessionStore.generateId()}`,
    });

    // Send spawn command to daemon
    const sent = daemonHub.sendToEnv(envId, {
      type: 'spawn',
      sessionId: session.id,
      agent,
      args: [],
      repoName,
      worktreePath: repo.path,
      task,
      cols: cols || 120,  // Default to reasonable size if not provided
      rows: rows || 30,
    });

    if (!sent) {
      sessionStore.delete(session.id);
      return reply.status(500).send({ error: 'Failed to send spawn command' });
    }

    // Broadcast to browsers
    browserHub.broadcastSessionUpdate(session);

    return session;
  });

  // Kill session
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = sessionStore.get(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // Send kill command to daemon
    daemonHub.sendToEnv(session.envId, {
      type: 'kill',
      sessionId: session.id,
    });

    return { success: true };
  });

  // Run diff command
  app.post<{ Params: { id: string } }>('/api/sessions/:id/diff', async (request, reply) => {
    const session = sessionStore.get(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // Send command to daemon
    daemonHub.sendToEnv(session.envId, {
      type: 'run-command',
      sessionId: session.id,
      command: 'git diff main | delta',
    });

    return { success: true };
  });

  // Merge session branch
  app.post<{ Params: { id: string } }>('/api/sessions/:id/merge', async (request, reply) => {
    const session = sessionStore.get(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // TODO: Implement merge logic
    return reply.status(501).send({ error: 'Not implemented yet' });
  });

  // Archive session (remove worktree)
  app.post<{ Params: { id: string } }>('/api/sessions/:id/archive', async (request, reply) => {
    const session = sessionStore.get(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // TODO: Implement archive logic
    return reply.status(501).send({ error: 'Not implemented yet' });
  });
}

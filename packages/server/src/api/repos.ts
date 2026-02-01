// Repository API routes

import type { FastifyInstance } from 'fastify';
import { repoStore, worktreeStore } from '../state/index.js';
import { browserHub } from '../ws/index.js';

export async function registerRepoRoutes(app: FastifyInstance): Promise<void> {
  // List repos - optionally filtered by environment
  app.get<{ Querystring: { envId?: string } }>('/api/repos', async (request) => {
    const { envId } = request.query;
    
    // Get repos for specific environment or all
    const repos = envId ? repoStore.getByEnv(envId) : repoStore.getAll();

    // Register main worktrees for each repo (if not already registered)
    for (const repo of repos) {
      const mainWorktree = worktreeStore.registerMain(
        repo.name, 
        repo.path, 
        repo.defaultBranch,
        repo.envId
      );
      // Broadcast to browsers so they have the main worktree in their map
      browserHub.broadcastWorktreeUpdate(mainWorktree);
    }

    return repos;
  });

  // Get single repo details
  app.get<{ Params: { name: string }; Querystring: { envId?: string } }>('/api/repos/:name', async (request, reply) => {
    const { envId } = request.query;
    const repo = envId 
      ? repoStore.getInEnv(envId, request.params.name)
      : repoStore.get(request.params.name);
    if (!repo) {
      return reply.status(404).send({ error: 'Repo not found' });
    }
    return repo;
  });

  // Clone a repo (stub for now)
  app.post<{ Body: { url: string } }>('/api/repos', async (request, reply) => {
    const { url } = request.body;
    if (!url) {
      return reply.status(400).send({ error: 'URL required' });
    }

    // TODO: Implement git clone via daemon
    // For now, just return a placeholder
    return reply.status(501).send({ error: 'Not implemented yet' });
  });

  // Delete a repo (stub for now)
  app.delete<{ Params: { name: string } }>('/api/repos/:name', async (request, reply) => {
    const repo = repoStore.get(request.params.name);
    if (!repo) {
      return reply.status(404).send({ error: 'Repo not found' });
    }

    // TODO: Implement repo deletion
    return reply.status(501).send({ error: 'Not implemented yet' });
  });
}

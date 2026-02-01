// Repository API routes

import type { FastifyInstance } from 'fastify';
import { repoStore, worktreeStore } from '../state/index.js';
import { browserHub } from '../ws/index.js';

export async function registerRepoRoutes(app: FastifyInstance): Promise<void> {
  // List all repos in workspace
  app.get('/api/repos', async () => {
    const repos = repoStore.getAll();

    // Register main worktrees for each repo (if not already registered)
    for (const repo of repos) {
      const mainWorktree = worktreeStore.registerMain(repo.name, repo.path, repo.defaultBranch);
      // Broadcast to browsers so they have the main worktree in their map
      browserHub.broadcastWorktreeUpdate(mainWorktree);
    }

    return repos;
  });

  // Get single repo details
  app.get<{ Params: { name: string } }>('/api/repos/:name', async (request, reply) => {
    const repo = repoStore.get(request.params.name);
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

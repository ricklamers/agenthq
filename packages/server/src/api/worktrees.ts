// Worktree API routes

import type { FastifyInstance } from 'fastify';
import { worktreeStore, envStore, repoStore, processStore } from '../state/index.js';
import { daemonHub } from '../ws/daemon-hub.js';
import { browserHub } from '../ws/browser-hub.js';

interface CreateWorktreeBody {
  envId: string;
}

export async function registerWorktreeRoutes(app: FastifyInstance): Promise<void> {
  // List all worktrees
  app.get('/api/worktrees', async () => {
    return worktreeStore.getAll();
  });

  // Get worktree details with processes
  app.get<{ Params: { id: string } }>('/api/worktrees/:id', async (request, reply) => {
    const worktree = worktreeStore.get(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }
    const processes = processStore.getByWorktree(worktree.id);
    return { ...worktree, processes };
  });

  // Create worktree for a repo
  app.post<{ Params: { name: string }; Body: CreateWorktreeBody }>(
    '/api/repos/:name/worktrees',
    async (request, reply) => {
      const { name } = request.params;
      const { envId } = request.body;

      // Validate environment
      const env = envStore.get(envId);
      if (!env) {
        return reply.status(400).send({ error: 'Environment not connected' });
      }

      // Validate repo
      const repo = repoStore.get(name);
      if (!repo) {
        return reply.status(400).send({ error: 'Repo not found' });
      }

      // Create worktree record (path will be updated when daemon confirms)
      const worktree = worktreeStore.create({
        repoName: name,
        path: '', // Will be set by daemon
        branch: `agent/${worktreeStore.generateId()}`,
        isMain: false,
        envId,
      });

      // Send create-worktree command to daemon
      const sent = daemonHub.sendToEnv(envId, {
        type: 'create-worktree',
        worktreeId: worktree.id,
        repoName: name,
        repoPath: repo.path,
      });

      if (!sent) {
        worktreeStore.delete(worktree.id);
        return reply.status(500).send({ error: 'Failed to send create-worktree command' });
      }

      // Broadcast to browsers
      browserHub.broadcastWorktreeUpdate(worktree);

      return worktree;
    }
  );

  // Archive worktree (kill processes, remove worktree)
  app.delete<{ Params: { id: string } }>('/api/worktrees/:id', async (request, reply) => {
    const worktree = worktreeStore.get(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    if (worktree.isMain) {
      return reply.status(400).send({ error: 'Cannot delete main worktree' });
    }

    // Kill all processes in this worktree
    const processes = processStore.getByWorktree(worktree.id);
    for (const process of processes) {
      if (process.status === 'running' || process.status === 'pending') {
        daemonHub.sendToEnv(process.envId, {
          type: 'kill',
          processId: process.id,
        });
      }
    }

    // Send remove-worktree command to daemon
    if (worktree.envId) {
      daemonHub.sendToEnv(worktree.envId, {
        type: 'remove-worktree',
        worktreeId: worktree.id,
        worktreePath: worktree.path,
      });
    }

    // Delete from store
    worktreeStore.delete(worktree.id);
    browserHub.broadcastWorktreeRemoved(worktree.id);

    return { success: true };
  });

  // Run diff command on worktree
  app.post<{ Params: { id: string } }>('/api/worktrees/:id/diff', async (request, reply) => {
    const worktree = worktreeStore.get(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    if (!worktree.envId) {
      return reply.status(400).send({ error: 'Worktree has no environment' });
    }

    // Spawn a diff process in the worktree
    const process = processStore.create({
      worktreeId: worktree.id,
      agent: 'shell',
      envId: worktree.envId,
    });

    const sent = daemonHub.sendToEnv(worktree.envId, {
      type: 'spawn',
      processId: process.id,
      worktreeId: worktree.id,
      worktreePath: worktree.path,
      agent: 'shell',
      args: [],
      task: 'git diff main --stat && echo "---" && git diff main',
      cols: 120,
      rows: 30,
      yoloMode: false,
    });

    if (!sent) {
      processStore.delete(process.id);
      return reply.status(500).send({ error: 'Failed to spawn diff process' });
    }

    browserHub.broadcastProcessUpdate(process);
    return { success: true, processId: process.id };
  });

  // Merge worktree branch into main
  app.post<{ Params: { id: string } }>('/api/worktrees/:id/merge', async (request, reply) => {
    const worktree = worktreeStore.get(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    if (!worktree.envId) {
      return reply.status(400).send({ error: 'Worktree has no environment' });
    }

    // Find the main worktree for this repo
    const mainWorktree = worktreeStore.getByRepoName(worktree.repoName).find(w => w.isMain);
    if (!mainWorktree) {
      return reply.status(400).send({ error: 'Main worktree not found for this repo' });
    }

    // Spawn a merge process - runs in main worktree directory
    const process = processStore.create({
      worktreeId: worktree.id,
      agent: 'shell',
      envId: worktree.envId,
    });

    // Try merge in main worktree. If conflicts, abort and spawn agent.
    // The script:
    // 1. Attempt merge with --no-commit to check for conflicts
    // 2. If conflicts (unmerged files exist), abort and print CONFLICT marker
    // 3. If no conflicts, commit the merge
    const mergeScript = `
branch="${worktree.branch}"
echo "Merging $branch into main..."

# Try merge without committing
if git merge --no-commit --no-ff "$branch" 2>/dev/null; then
  # Check for unmerged files (conflicts)
  if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
    echo "MERGE_CONFLICT: Conflicts detected"
    git merge --abort
    exit 1
  else
    # No conflicts - commit the merge
    git commit -m "Merge $branch into main"
    echo "Merge successful!"
  fi
else
  # Merge command itself failed (likely conflicts)
  echo "MERGE_CONFLICT: Merge failed with conflicts"
  git merge --abort 2>/dev/null || true
  exit 1
fi
`.trim();

    const sent = daemonHub.sendToEnv(worktree.envId, {
      type: 'spawn',
      processId: process.id,
      worktreeId: worktree.id,
      worktreePath: mainWorktree.path, // Run in main worktree!
      agent: 'shell',
      args: [],
      task: mergeScript,
      cols: 120,
      rows: 30,
      yoloMode: false,
    });

    if (!sent) {
      processStore.delete(process.id);
      return reply.status(500).send({ error: 'Failed to spawn merge process' });
    }

    browserHub.broadcastProcessUpdate(process);
    return { success: true, processId: process.id, branchWorktreeId: worktree.id, mainWorktreePath: mainWorktree.path };
  });

  // Merge with agent assistance (for conflicts)
  app.post<{ Params: { id: string } }>('/api/worktrees/:id/merge-with-agent', async (request, reply) => {
    const worktree = worktreeStore.get(request.params.id);
    if (!worktree) {
      return reply.status(404).send({ error: 'Worktree not found' });
    }

    if (!worktree.envId) {
      return reply.status(400).send({ error: 'Worktree has no environment' });
    }

    // Find the main worktree for this repo
    const mainWorktree = worktreeStore.getByRepoName(worktree.repoName).find(w => w.isMain);
    if (!mainWorktree) {
      return reply.status(400).send({ error: 'Main worktree not found for this repo' });
    }

    // Spawn an agent process - associate with branch worktree for UI, but runs in main worktree
    const process = processStore.create({
      worktreeId: worktree.id, // Associate with branch worktree so tab appears there
      agent: 'claude-code',
      envId: worktree.envId,
    });

    const mergePrompt = `Merge the branch "${worktree.branch}" into main.

This merge has conflicts that need to be resolved. Please:
1. Run: git merge ${worktree.branch}
2. Identify and resolve any merge conflicts
3. Make sensible decisions about how to combine conflicting changes
4. Commit the merge when done

The branch worktree is at: ${worktree.path}
You are currently in the main worktree at: ${mainWorktree.path}`;

    const sent = daemonHub.sendToEnv(worktree.envId, {
      type: 'spawn',
      processId: process.id,
      worktreeId: worktree.id, // Track under branch worktree
      worktreePath: mainWorktree.path, // But run in main worktree where merge happens
      agent: 'claude-code',
      args: [],
      task: mergePrompt,
      cols: 120,
      rows: 30,
      yoloMode: true, // Allow agent to make changes
    });

    if (!sent) {
      processStore.delete(process.id);
      return reply.status(500).send({ error: 'Failed to spawn merge agent' });
    }

    browserHub.broadcastProcessUpdate(process);
    return { success: true, processId: process.id };
  });
}

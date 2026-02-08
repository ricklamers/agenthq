// Repository API routes

import { mkdirSync, existsSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { repoStore, worktreeStore, processStore } from '../state/index.js';
import { browserHub } from '../ws/index.js';
import { daemonHub } from '../ws/daemon-hub.js';

const execFileAsync = promisify(execFile);

interface ParsedGitRepo {
  owner: string;
  repo: string;
  cloneUrl: string;
  protocol: 'https' | 'ssh';
}

const SSH_URL_RE = /^git@([^:]+):([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/;

function parseGitUrl(rawUrl: string): ParsedGitRepo | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Try SSH format: git@github.com:owner/repo.git
  const sshMatch = SSH_URL_RE.exec(trimmed);
  if (sshMatch) {
    const [, , owner, repo] = sshMatch;
    if (!owner || !repo) return null;
    return {
      owner,
      repo,
      cloneUrl: `git@github.com:${owner}/${repo}.git`,
      protocol: 'ssh',
    };
  }

  // Try HTTPS format
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null;

  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, repoRaw] = parts;
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/, '');

  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    protocol: 'https',
  };
}

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

  // Clone a public GitHub repo into local workspace
  app.post<{ Body: { url: string; envId?: string } }>('/api/repos', async (request, reply) => {
    const { url, envId = 'local' } = request.body;
    if (!url) {
      return reply.status(400).send({ error: 'URL required' });
    }

    if (envId !== 'local') {
      return reply.status(400).send({ error: 'Adding repos is currently supported for local environment only' });
    }

    const parsed = parseGitUrl(url);
    if (!parsed) {
      return reply.status(400).send({
        error: 'Please provide a valid GitHub URL (e.g. https://github.com/owner/repo or git@github.com:owner/repo.git)',
      });
    }

    const workspace = repoStore.getWorkspace();
    if (!workspace) {
      return reply.status(500).send({ error: 'Local workspace is not configured' });
    }

    mkdirSync(workspace, { recursive: true });

    const targetPath = join(workspace, parsed.repo);
    if (existsSync(targetPath)) {
      return reply.status(409).send({ error: `Repository directory already exists: ${parsed.repo}` });
    }

    try {
      const cloneEnv: Record<string, string> = { ...process.env as Record<string, string> };
      if (parsed.protocol === 'ssh') {
        cloneEnv.GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=accept-new';
      }
      await execFileAsync('git', ['clone', '--', parsed.cloneUrl, targetPath], {
        cwd: workspace,
        timeout: 120_000,
        env: cloneEnv,
      });
    } catch (err: unknown) {
      const stderr = err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr?: unknown }).stderr ?? '') : '';
      const stdout = err && typeof err === 'object' && 'stdout' in err ? String((err as { stdout?: unknown }).stdout ?? '') : '';
      const detail = (stderr || stdout || 'git clone failed').trim();
      return reply.status(502).send({ error: `Failed to clone repository: ${detail}` });
    }

    repoStore.saveRepoMeta(parsed.repo, parsed.cloneUrl);

    const repo = repoStore.get(parsed.repo);
    if (!repo) {
      return reply.status(500).send({ error: 'Repository cloned but could not be indexed' });
    }

    const mainWorktree = worktreeStore.registerMain(repo.name, repo.path, repo.defaultBranch, repo.envId);
    browserHub.broadcastWorktreeUpdate(mainWorktree);

    return reply.status(201).send(repo);
  });

  // Delete a repo (local environment only for now)
  app.delete<{ Params: { name: string }; Querystring: { envId?: string } }>('/api/repos/:name', async (request, reply) => {
    const { envId = 'local' } = request.query;
    if (envId !== 'local') {
      return reply.status(400).send({ error: 'Removing repos is currently supported for local environment only' });
    }

    const repo = repoStore.getInEnv(envId, request.params.name);
    if (!repo) {
      return reply.status(404).send({ error: 'Repo not found' });
    }

    // Safety check: only allow deleting directories under workspace
    const workspace = repoStore.getWorkspace();
    if (!workspace) {
      return reply.status(500).send({ error: 'Local workspace is not configured' });
    }

    const resolvedWorkspace = resolve(workspace);
    const resolvedRepoPath = resolve(repo.path);
    const allowedPrefix = `${resolvedWorkspace}${sep}`;
    if (resolvedRepoPath !== resolvedWorkspace && !resolvedRepoPath.startsWith(allowedPrefix)) {
      return reply.status(400).send({ error: 'Refusing to delete path outside workspace' });
    }

    try {
      rmSync(resolvedRepoPath, { recursive: true, force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown filesystem error';
      return reply.status(500).send({ error: `Failed to remove repository directory: ${message}` });
    }

    // Remove related worktrees/processes from in-memory state and daemon
    const repoWorktrees = worktreeStore.getByRepoNameAndEnv(repo.name, repo.envId);
    for (const worktree of repoWorktrees) {
      const worktreeProcesses = processStore.getByWorktree(worktree.id);

      for (const process of worktreeProcesses) {
        if (process.status === 'running' || process.status === 'pending') {
          daemonHub.sendToEnv(process.envId, {
            type: 'kill',
            processId: process.id,
          });
        }
        processStore.delete(process.id);
        browserHub.broadcastProcessRemoved(process.id);
      }

      if (!worktree.isMain && worktree.envId) {
        daemonHub.sendToEnv(worktree.envId, {
          type: 'remove-worktree',
          worktreeId: worktree.id,
          worktreePath: worktree.path,
        });
      }

      worktreeStore.delete(worktree.id);
      browserHub.broadcastWorktreeRemoved(worktree.id);
    }

    repoStore.removeRepoMeta(repo.name);
    return { success: true };
  });
}

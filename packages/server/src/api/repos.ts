// Repository API routes

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { repoStore, worktreeStore } from '../state/index.js';
import { browserHub } from '../ws/index.js';

const execFileAsync = promisify(execFile);

interface ParsedGithubRepo {
  owner: string;
  repo: string;
  cloneUrl: string;
}

function parsePublicGithubUrl(rawUrl: string): ParsedGithubRepo | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

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

    const parsed = parsePublicGithubUrl(url);
    if (!parsed) {
      return reply.status(400).send({
        error: 'Only public GitHub HTTPS URLs are supported for now (e.g. https://github.com/owner/repo)',
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
      await execFileAsync('git', ['clone', '--', parsed.cloneUrl, targetPath], {
        cwd: workspace,
        timeout: 120_000,
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

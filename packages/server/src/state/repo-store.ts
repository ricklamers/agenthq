// Repository management - environment-aware

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo } from '@agenthq/shared';

const META_DIR = '.agenthq-meta';
const REPOS_FILE = 'repos.json';

// Repo data as received from daemon
interface DaemonRepo {
  name: string;
  path: string;
  defaultBranch: string;
}

class RepoStore {
  // Local workspace path
  private workspace: string;
  // Repos by environment ID (for remote environments)
  private envRepos = new Map<string, Repo[]>();

  constructor() {
    this.workspace = process.env.AGENTHQ_WORKSPACE ?? '';
  }

  setWorkspace(path: string): void {
    this.workspace = path;
  }

  getWorkspace(): string {
    return this.workspace;
  }

  private getMetaPath(): string {
    return join(this.workspace, META_DIR);
  }

  private getReposFilePath(): string {
    return join(this.getMetaPath(), REPOS_FILE);
  }

  private ensureMetaDir(): void {
    const metaPath = this.getMetaPath();
    if (!existsSync(metaPath)) {
      mkdirSync(metaPath, { recursive: true });
    }
  }

  /**
   * Set repos for an environment (received from daemon)
   */
  setEnvRepos(envId: string, repos: DaemonRepo[]): void {
    this.envRepos.set(envId, repos.map((r) => ({
      name: r.name,
      path: r.path,
      defaultBranch: r.defaultBranch,
      envId,
    })));
  }

  /**
   * Clear repos for an environment (when daemon disconnects)
   */
  clearEnvRepos(envId: string): void {
    this.envRepos.delete(envId);
  }

  /**
   * Get repos for a specific environment
   * For local environment, scans filesystem
   * For remote environments, returns cached repos from daemon
   */
  getByEnv(envId: string): Repo[] {
    // For local environment, scan the local workspace
    if (envId === 'local') {
      return this.scanLocalWorkspace();
    }

    // For remote environments, return cached repos
    return this.envRepos.get(envId) ?? [];
  }

  /**
   * Scan local workspace for git repos
   */
  private scanLocalWorkspace(): Repo[] {
    if (!this.workspace || !existsSync(this.workspace)) {
      return [];
    }

    const repos: Repo[] = [];

    try {
      const entries = readdirSync(this.workspace);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;

        const entryPath = join(this.workspace, entry);
        const stat = statSync(entryPath);

        if (stat.isDirectory()) {
          const gitPath = join(entryPath, '.git');
          if (existsSync(gitPath)) {
            repos.push({
              name: entry,
              path: entryPath,
              defaultBranch: this.getDefaultBranch(entryPath),
              envId: 'local',
            });
          }
        }
      }
    } catch (err) {
      console.error('Error scanning workspace:', err);
    }

    return repos;
  }

  /**
   * Get all repos (all environments) - for backwards compatibility
   */
  getAll(): Repo[] {
    const all: Repo[] = [];
    
    // Local repos
    all.push(...this.scanLocalWorkspace());
    
    // Remote repos
    for (const repos of Array.from(this.envRepos.values())) {
      all.push(...repos);
    }

    return all;
  }

  /**
   * Get a specific repo by name (in local environment)
   */
  get(name: string): Repo | undefined {
    const repoPath = join(this.workspace, name);
    if (!existsSync(repoPath) || !existsSync(join(repoPath, '.git'))) {
      return undefined;
    }

    return {
      name,
      path: repoPath,
      defaultBranch: this.getDefaultBranch(repoPath),
      envId: 'local',
    };
  }

  /**
   * Get a specific repo by name in a specific environment
   */
  getInEnv(envId: string, name: string): Repo | undefined {
    const repos = this.getByEnv(envId);
    return repos.find((r) => r.name === name);
  }

  private getDefaultBranch(repoPath: string): string {
    try {
      const headPath = join(repoPath, '.git', 'HEAD');
      if (existsSync(headPath)) {
        const content = readFileSync(headPath, 'utf-8').trim();
        const match = content.match(/ref: refs\/heads\/(.+)/);
        if (match?.[1]) return match[1];
      }
    } catch {
      // Ignore errors
    }
    return 'main';
  }

  /**
   * Save repo metadata (for cloned repos tracking)
   */
  saveRepoMeta(name: string, url?: string): void {
    this.ensureMetaDir();
    const reposPath = this.getReposFilePath();

    let repos: Record<string, { url?: string; addedAt: number }> = {};
    if (existsSync(reposPath)) {
      try {
        repos = JSON.parse(readFileSync(reposPath, 'utf-8'));
      } catch {
        // Ignore parse errors
      }
    }

    repos[name] = { url, addedAt: Date.now() };
    writeFileSync(reposPath, JSON.stringify(repos, null, 2));
  }
}

export const repoStore = new RepoStore();

// Repository management - reads from workspace

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo } from '@agenthq/shared';

const META_DIR = '.agenthq-meta';
const REPOS_FILE = 'repos.json';

class RepoStore {
  private workspace: string;

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
   * Scan workspace for git repos and return them
   */
  getAll(): Repo[] {
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
            });
          }
        }
      }
    } catch (err) {
      console.error('Error scanning workspace:', err);
    }

    return repos;
  }

  get(name: string): Repo | undefined {
    const repoPath = join(this.workspace, name);
    if (!existsSync(repoPath) || !existsSync(join(repoPath, '.git'))) {
      return undefined;
    }

    return {
      name,
      path: repoPath,
      defaultBranch: this.getDefaultBranch(repoPath),
    };
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

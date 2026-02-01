// In-memory store for worktrees

import type { Worktree } from '@agenthq/shared';
import { WORKTREE_ID_LENGTH } from '@agenthq/shared';
import { nanoid } from 'nanoid';

class WorktreeStore {
  private worktrees = new Map<string, Worktree>();

  generateId(): string {
    return nanoid(WORKTREE_ID_LENGTH);
  }

  create(worktree: Omit<Worktree, 'id' | 'createdAt'>): Worktree {
    const id = this.generateId();
    const newWorktree: Worktree = {
      ...worktree,
      id,
      createdAt: Date.now(),
    };
    this.worktrees.set(id, newWorktree);
    return newWorktree;
  }

  /**
   * Register main worktree for a repo (doesn't create git worktree)
   */
  registerMain(repoName: string, repoPath: string, branch: string, envId?: string): Worktree {
    // Include envId in the key to allow same repo name in different environments
    const id = envId && envId !== 'local' ? `main-${envId}-${repoName}` : `main-${repoName}`;
    
    // Check if main worktree already exists
    const existing = this.worktrees.get(id);
    if (existing) {
      return existing;
    }

    const worktree: Worktree = {
      id,
      repoName,
      path: repoPath,
      branch,
      isMain: true,
      envId,
      createdAt: Date.now(),
    };
    this.worktrees.set(id, worktree);
    return worktree;
  }

  get(worktreeId: string): Worktree | undefined {
    return this.worktrees.get(worktreeId);
  }

  getAll(): Worktree[] {
    return Array.from(this.worktrees.values());
  }

  getByRepoName(repoName: string): Worktree[] {
    return Array.from(this.worktrees.values()).filter((w) => w.repoName === repoName);
  }

  getByEnv(envId: string): Worktree[] {
    return Array.from(this.worktrees.values()).filter((w) => w.envId === envId);
  }

  getByRepoNameAndEnv(repoName: string, envId?: string): Worktree[] {
    return Array.from(this.worktrees.values()).filter((w) => 
      w.repoName === repoName && w.envId === envId
    );
  }

  updatePath(worktreeId: string, path: string): Worktree | undefined {
    const worktree = this.worktrees.get(worktreeId);
    if (worktree) {
      worktree.path = path;
      return worktree;
    }
    return undefined;
  }

  updateBranch(worktreeId: string, branch: string): Worktree | undefined {
    const worktree = this.worktrees.get(worktreeId);
    if (worktree) {
      worktree.branch = branch;
      return worktree;
    }
    return undefined;
  }

  delete(worktreeId: string): boolean {
    return this.worktrees.delete(worktreeId);
  }
}

export const worktreeStore = new WorktreeStore();

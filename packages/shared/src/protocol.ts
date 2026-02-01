// Protocol messages between daemon, server, and browser

import type { AgentType, Environment, Process, Worktree } from './types.js';

// ============================================
// Daemon -> Server messages
// ============================================

export type DaemonToServerMessage =
  | { type: 'register'; envId: string; envName: string; capabilities: string[] }
  | { type: 'heartbeat' }
  | { type: 'pty-data'; processId: string; data: string }
  | { type: 'buffer-clear'; processId: string }
  | { type: 'process-started'; processId: string }
  | { type: 'process-exit'; processId: string; exitCode: number }
  | { type: 'worktree-ready'; worktreeId: string; path: string; branch: string }
  | { type: 'branch-changed'; worktreeId: string; branch: string };

// ============================================
// Server -> Daemon messages
// ============================================

export type ServerToDaemonMessage =
  | {
      type: 'create-worktree';
      worktreeId: string;
      repoName: string;
      repoPath: string;
    }
  | {
      type: 'spawn';
      processId: string;
      worktreeId: string;
      worktreePath: string;
      agent: AgentType;
      args: string[];
      task?: string;
      cols?: number;
      rows?: number;
      yoloMode?: boolean;
    }
  | { type: 'pty-input'; processId: string; data: string }
  | { type: 'resize'; processId: string; cols: number; rows: number }
  | { type: 'kill'; processId: string }
  | { type: 'remove-worktree'; worktreeId: string; worktreePath: string };

// ============================================
// Browser -> Server messages
// ============================================

export type BrowserToServerMessage =
  | { type: 'attach'; processId: string; skipBuffer?: boolean }
  | { type: 'detach'; processId: string }
  | { type: 'input'; processId: string; data: string }
  | { type: 'resize'; processId: string; cols: number; rows: number };

// ============================================
// Server -> Browser messages
// ============================================

export type ServerToBrowserMessage =
  | { type: 'pty-data'; processId: string; data: string }
  | { type: 'process-update'; process: Process }
  | { type: 'process-removed'; processId: string }
  | { type: 'worktree-update'; worktree: Worktree }
  | { type: 'worktree-removed'; worktreeId: string }
  | { type: 'env-update'; environments: Environment[] }
  | { type: 'error'; message: string };

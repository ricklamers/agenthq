// Core domain types

export type AgentType = 'claude-code' | 'codex-cli' | 'cursor-agent' | 'kimi-cli' | 'droid-cli' | 'bash' | 'shell';

export type ProcessStatus = 'pending' | 'running' | 'stopped' | 'error';

export type EnvironmentType = 'local' | 'exe';

export type EnvironmentStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Process {
  id: string;
  worktreeId: string;
  agent: AgentType;
  status: ProcessStatus;
  envId: string;
  createdAt: number;
  exitCode?: number;
}

export interface Worktree {
  id: string;
  repoName: string;
  path: string;
  branch: string;
  isMain: boolean;
  envId?: string; // Environment where worktree was created
  createdAt: number;
}

// Configuration for an environment (persisted)
export interface EnvironmentConfig {
  id: string;
  name: string;
  type: EnvironmentType;
  // For exe type:
  vmName?: string;
  vmSshDest?: string;
  workspace?: string; // path within the environment
}

// Runtime environment state (includes connection info)
export interface Environment {
  id: string;
  name: string;
  type: EnvironmentType;
  status: EnvironmentStatus;
  capabilities: string[];
  // Connection info (when connected)
  connectedAt?: number;
  lastHeartbeat?: number;
  // exe.dev-specific
  vmName?: string;
  vmSshDest?: string;
  workspace?: string;
}

export interface Repo {
  name: string;
  path: string;
  defaultBranch: string;
  envId?: string; // Environment this repo belongs to
}

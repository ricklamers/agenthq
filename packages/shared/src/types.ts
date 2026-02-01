// Core domain types

export type AgentType = 'claude-code' | 'codex-cli' | 'cursor-agent' | 'kimi-cli' | 'bash' | 'shell';

export type ProcessStatus = 'pending' | 'running' | 'stopped' | 'error';

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

export interface Environment {
  id: string;
  name: string;
  capabilities: string[];
  connectedAt: number;
  lastHeartbeat: number;
}

export interface Repo {
  name: string;
  path: string;
  defaultBranch: string;
}

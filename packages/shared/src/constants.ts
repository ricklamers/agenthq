// Default configuration values

export const DEFAULT_PORT = 3000;
export const WORKTREE_ID_LENGTH = 12;
export const PROCESS_ID_LENGTH = 12;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 90_000;

// WebSocket paths
export const WS_DAEMON_PATH = '/ws/daemon';
export const WS_BROWSER_PATH = '/ws/browser';

// Agent CLI commands (should match daemon/internal/protocol/messages.go AgentCommands)
export const AGENT_COMMANDS: Record<string, string> = {
  'claude-code': 'claude',
  'codex-cli': 'codex',
  'cursor-agent': 'cursor-agent',
  'kimi-cli': 'kimi',
  'droid-cli': 'droid',
  bash: 'bash',
  shell: 'bash',
};

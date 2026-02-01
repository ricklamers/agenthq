// Package protocol defines WebSocket message types for daemon-server communication.
package protocol

// AgentType represents the type of agent to spawn.
type AgentType string

const (
	AgentBash        AgentType = "bash"
	AgentShell       AgentType = "shell"
	AgentClaudeCode  AgentType = "claude-code"
	AgentCodexCLI    AgentType = "codex-cli"
	AgentCursorAgent AgentType = "cursor-agent"
	AgentKimiCLI     AgentType = "kimi-cli"
	AgentDroidCLI    AgentType = "droid-cli"
	AgentInkTest     AgentType = "ink-test"
)

// RepoInfo represents a git repository
type RepoInfo struct {
	Name          string `json:"name"`
	Path          string `json:"path"`
	DefaultBranch string `json:"defaultBranch"`
}

// DaemonMessage is sent from daemon to server.
type DaemonMessage struct {
	Type         string     `json:"type"`
	EnvID        string     `json:"envId,omitempty"`
	EnvName      string     `json:"envName,omitempty"`
	Capabilities []string   `json:"capabilities,omitempty"`
	Workspace    string     `json:"workspace,omitempty"`
	ProcessID    string     `json:"processId,omitempty"`
	WorktreeID   string     `json:"worktreeId,omitempty"`
	Data         string     `json:"data,omitempty"`
	ExitCode     int        `json:"exitCode,omitempty"`
	Branch       string     `json:"branch,omitempty"`
	Path         string     `json:"path,omitempty"`
	Repos        []RepoInfo `json:"repos,omitempty"`
}

// ServerMessage is received from server by daemon.
type ServerMessage struct {
	Type         string    `json:"type"`
	ProcessID    string    `json:"processId,omitempty"`
	WorktreeID   string    `json:"worktreeId,omitempty"`
	Agent        AgentType `json:"agent,omitempty"`
	Args         []string  `json:"args,omitempty"`
	RepoName     string    `json:"repoName,omitempty"`
	RepoPath     string    `json:"repoPath,omitempty"`
	WorktreePath string    `json:"worktreePath,omitempty"`
	Task         string    `json:"task,omitempty"`
	Data         string    `json:"data,omitempty"`
	Cols         int       `json:"cols,omitempty"`
	Rows         int       `json:"rows,omitempty"`
	Command      string    `json:"command,omitempty"`
	YoloMode     bool      `json:"yoloMode,omitempty"`
}

// Message types from daemon to server
const (
	MsgTypeRegister       = "register"
	MsgTypeHeartbeat      = "heartbeat"
	MsgTypePtyData        = "pty-data"
	MsgTypeProcessStarted = "process-started"
	MsgTypeProcessExit    = "process-exit"
	MsgTypeWorktreeReady  = "worktree-ready"
	MsgTypeBranchChanged  = "branch-changed"
	MsgTypeReposList      = "repos-list"
)

// Message types from server to daemon
const (
	MsgTypeCreateWorktree = "create-worktree"
	MsgTypeSpawn          = "spawn"
	MsgTypePtyInput       = "pty-input"
	MsgTypeResize         = "resize"
	MsgTypeKill           = "kill"
	MsgTypeRemoveWorktree = "remove-worktree"
	MsgTypeListRepos      = "list-repos"
)

// Agent command mappings
var AgentCommands = map[AgentType]string{
	AgentBash:        "bash",
	AgentShell:       "bash", // shell uses bash but with a one-shot task command
	AgentClaudeCode:  "claude",
	AgentCodexCLI:    "codex",
	AgentCursorAgent: "cursor-agent",
	AgentKimiCLI:     "kimi",
	AgentDroidCLI:    "droid",
	AgentInkTest:     "node /tmp/ink-test/test.js",
}

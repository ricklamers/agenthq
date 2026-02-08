// Package session manages active agent sessions.
package session

import (
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/agenthq/daemon/internal/protocol"
	"github.com/agenthq/daemon/internal/pty"
)

// Session represents an active agent session.
type Session struct {
	ID           string
	Agent        protocol.AgentType
	WorktreePath string
	Process      *pty.Process
}

// Manager manages all active sessions (processes).
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	onData   func(processID string, data []byte)
	onExit   func(processID string, exitCode int)
}

// NewManager creates a new session manager.
func NewManager(
	onData func(processID string, data []byte),
	onExit func(processID string, exitCode int),
) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		onData:   onData,
		onExit:   onExit,
	}
}

// Yolo mode flags for each agent CLI
var agentYoloFlags = map[protocol.AgentType]string{
	protocol.AgentClaudeCode:  "--dangerously-skip-permissions",
	protocol.AgentCodexCLI:    "--full-auto",
	protocol.AgentCursorAgent: "--force",
	protocol.AgentKimiCLI:     "--yolo",
}

// Spawn creates a new session (process) and starts the agent.
func (m *Manager) Spawn(processID string, agent protocol.AgentType, worktreePath string, task string, cols, rows int, yoloMode bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[processID]; exists {
		return fmt.Errorf("process %s already exists", processID)
	}

	// Get the command for this agent
	agentCmd, ok := protocol.AgentCommands[agent]
	if !ok {
		return fmt.Errorf("unknown agent type: %s", agent)
	}

	// Add yolo mode flag if enabled and agent supports it
	if yoloMode {
		if yoloFlag, hasYolo := agentYoloFlags[agent]; hasYolo {
			agentCmd = agentCmd + " " + yoloFlag
		}
	}

	// Build command and args
	var command string
	var args []string
	
	if agent == protocol.AgentBash {
		// For bash, run an interactive login shell directly
		command = agentCmd
		args = []string{"-l"}
	} else if agent == protocol.AgentShell {
		// For shell, run the task as a one-shot command
		// If no task provided, fall back to interactive shell
		if task != "" {
			command = "bash"
			args = []string{"-l", "-c", task}
		} else {
			command = "bash"
			args = []string{"-l"}
		}
	} else {
		// For TUI agents (claude-code, codex-cli, cursor-agent, etc.)
		// Run via an interactive login shell so agent resolution matches what users
		// get in a normal terminal tab (.bashrc/.profile-driven PATH, aliases, etc).
		// Keep terminal alive after agent exits by replacing with another shell.
		command = "bash"
		
		// If task is provided, pass it as initial prompt to the agent (interactive mode)
		fullCmd := agentCmd
		if task != "" {
			// Escape single quotes in task and wrap in single quotes
			escapedTask := strings.ReplaceAll(task, "'", "'\\''")
			// Different agents have different prompt flags
			if agent == protocol.AgentKimiCLI {
				// kimi uses -p or --prompt for initial prompt
				fullCmd = agentCmd + " -p '" + escapedTask + "'"
			} else {
				// claude, codex, cursor-agent accept prompt as positional arg
				fullCmd = agentCmd + " '" + escapedTask + "'"
			}
		}
		
		args = []string{"-i", "-l", "-c", fullCmd + "; exec bash -il"}
	}

	// Use defaults if not provided
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}

	// Spawn the process with initial terminal size
	proc, err := pty.Spawn(command, args, worktreePath, nil, cols, rows)
	if err != nil {
		return fmt.Errorf("failed to spawn process: %w", err)
	}

	session := &Session{
		ID:           processID,
		Agent:        agent,
		WorktreePath: worktreePath,
		Process:      proc,
	}

	m.sessions[processID] = session

	// Start reading PTY output
	// Note: We don't clear the buffer on clear screen sequences anymore.
	// The clear sequences stay in the buffer and execute on replay, preserving
	// terminal state (cursor visibility, colors, etc.) that was set before the clear.
	proc.StartReadLoop(func(data []byte) {
		m.onData(processID, data)
	})

	// Wait for process exit in background
	go func() {
		exitCode, err := proc.Wait()
		if err != nil {
			log.Printf("Process %s wait error: %v", processID, err)
		}
		proc.Close()
		m.onExit(processID, exitCode)
		m.remove(processID)
	}()

	log.Printf("Spawned process %s: %s in %s", processID, command, worktreePath)
	return nil
}

// Input sends input to a process's PTY.
func (m *Manager) Input(processID string, data []byte) error {
	m.mu.RLock()
	session, ok := m.sessions[processID]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("process %s not found", processID)
	}

	_, err := session.Process.Write(data)
	return err
}

// Resize resizes a process's PTY.
func (m *Manager) Resize(processID string, cols, rows int) error {
	m.mu.RLock()
	session, ok := m.sessions[processID]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("process %s not found", processID)
	}

	return session.Process.Resize(uint16(cols), uint16(rows))
}

// Kill terminates a process.
func (m *Manager) Kill(processID string) error {
	m.mu.RLock()
	session, ok := m.sessions[processID]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("process %s not found", processID)
	}

	return session.Process.Kill()
}

// remove removes a process from the manager.
func (m *Manager) remove(processID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, processID)
}

// KillAll terminates all sessions.
func (m *Manager) KillAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, session := range m.sessions {
		session.Process.Kill()
		session.Process.Close()
	}
	m.sessions = make(map[string]*Session)
}

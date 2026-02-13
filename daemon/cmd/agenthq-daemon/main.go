// Agent HQ Daemon - PTY manager and worktree handler
package main

import (
	"encoding/base64"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/agenthq/daemon/internal/client"
	"github.com/agenthq/daemon/internal/protocol"
	"github.com/agenthq/daemon/internal/session"
)

var version = "dev"

// Global workspace path
var workspace string

func main() {
	// Parse command line flags
	flag.StringVar(&workspace, "workspace", "", "Workspace directory containing repositories")
	flag.Parse()

	// Get server URL from environment
	serverURL := os.Getenv("AGENTHQ_SERVER_URL")
	if serverURL == "" {
		serverURL = "ws://localhost:3000/ws/daemon"
	}

	// Get auth token for remote connections
	authToken := os.Getenv("AGENTHQ_AUTH_TOKEN")

	// Get environment ID from environment variable or generate one
	hostname, _ := os.Hostname()
	envID := os.Getenv("AGENTHQ_ENV_ID")
	if envID == "" {
		envID = fmt.Sprintf("daemon-%s-%d", hostname, time.Now().Unix())
	}
	envName := hostname

	log.Printf("Agent HQ Daemon %s", version)
	log.Printf("Environment: %s (%s)", envName, envID)
	log.Printf("Connecting to: %s", serverURL)
	if authToken != "" {
		log.Printf("Auth token: configured")
	}
	if workspace != "" {
		log.Printf("Workspace: %s", workspace)
	}

	var wsClient *client.Client
	var sessionMgr *session.Manager

	// Create session manager with callbacks
	sessionMgr = session.NewManager(
		// onData callback - send PTY output to server
		func(processID string, data []byte) {
			// Encode as base64 to safely transmit binary data
			encoded := base64.StdEncoding.EncodeToString(data)
			wsClient.Send(protocol.DaemonMessage{
				Type:      protocol.MsgTypePtyData,
				ProcessID: processID,
				Data:      encoded,
			})
		},
		// onExit callback - notify server of process exit
		func(processID string, exitCode int) {
			wsClient.Send(protocol.DaemonMessage{
				Type:      protocol.MsgTypeProcessExit,
				ProcessID: processID,
				ExitCode:  exitCode,
			})
		},
	)

	// Channel to signal reconnection needed
	reconnectChan := make(chan struct{}, 1)

	// Create WebSocket client with reconnect callback
	wsClient = client.New(serverURL, authToken, envID, envName, workspace,
		func(msg protocol.ServerMessage) {
			handleServerMessage(wsClient, sessionMgr, msg)
		},
		func() {
			// Signal reconnection needed (non-blocking)
			select {
			case reconnectChan <- struct{}{}:
			default:
			}
		},
	)

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Connection loop with auto-reconnect
	go func() {
		for {
			// Connect with retry
			for {
				if err := wsClient.Connect(); err != nil {
					log.Printf("Failed to connect: %v. Retrying in 5s...", err)
					time.Sleep(5 * time.Second)
					continue
				}
				log.Printf("Connected to server")
				break
			}

			// Wait for disconnection or shutdown
			select {
			case <-reconnectChan:
				log.Printf("Disconnected. Reconnecting in 2s...")
				time.Sleep(2 * time.Second)
				// For sprites environments, keep the same ID
				// For local, generate new one if not explicitly set
				if os.Getenv("AGENTHQ_ENV_ID") == "" {
					envID = fmt.Sprintf("daemon-%s-%d", hostname, time.Now().Unix())
				}
				wsClient = client.New(serverURL, authToken, envID, envName, workspace,
					func(msg protocol.ServerMessage) {
						handleServerMessage(wsClient, sessionMgr, msg)
					},
					func() {
						select {
						case reconnectChan <- struct{}{}:
						default:
						}
					},
				)
			case <-sigChan:
				return
			}
		}
	}()

	<-sigChan
	log.Println("Shutting down...")

	// Clean up
	sessionMgr.KillAll()
	wsClient.Close()
}

func handleServerMessage(wsClient *client.Client, mgr *session.Manager, msg protocol.ServerMessage) {
	switch msg.Type {
	case protocol.MsgTypeCreateWorktree:
		log.Printf("Create worktree request: worktreeId=%s repoName=%s", msg.WorktreeID, msg.RepoName)
		go createWorktree(wsClient, msg.WorktreeID, msg.RepoName, msg.RepoPath)

	case protocol.MsgTypeSpawn:
		log.Printf("Spawn request: processId=%s agent=%s cols=%d rows=%d yoloMode=%v", msg.ProcessID, msg.Agent, msg.Cols, msg.Rows, msg.YoloMode)
		if err := mgr.Spawn(msg.ProcessID, msg.Agent, msg.WorktreePath, msg.Task, msg.Cols, msg.Rows, msg.YoloMode); err != nil {
			log.Printf("Failed to spawn process: %v", err)
		} else {
			// Notify server that process started successfully
			wsClient.Send(protocol.DaemonMessage{
				Type:      protocol.MsgTypeProcessStarted,
				ProcessID: msg.ProcessID,
			})
			sendPtySize(wsClient, mgr, msg.ProcessID)
		}

	case protocol.MsgTypePtyInput:
		// Decode base64 input
		data, err := base64.StdEncoding.DecodeString(msg.Data)
		if err != nil {
			log.Printf("Failed to decode input: %v", err)
			return
		}
		if err := mgr.Input(msg.ProcessID, data); err != nil {
			log.Printf("Failed to send input: %v", err)
		}

	case protocol.MsgTypeResize:
		if err := mgr.Resize(msg.ProcessID, msg.Cols, msg.Rows); err != nil {
			log.Printf("Failed to resize: %v", err)
		} else {
			sendPtySize(wsClient, mgr, msg.ProcessID)
		}

	case protocol.MsgTypeQueryPtySize:
		sendPtySize(wsClient, mgr, msg.ProcessID)

	case protocol.MsgTypeKill:
		log.Printf("Kill request: processId=%s", msg.ProcessID)
		if err := mgr.Kill(msg.ProcessID); err != nil {
			log.Printf("Failed to kill process: %v", err)
		}

	case protocol.MsgTypeRemoveWorktree:
		log.Printf("Remove worktree request: worktreeId=%s path=%s", msg.WorktreeID, msg.WorktreePath)
		go removeWorktree(msg.WorktreePath)

	case protocol.MsgTypeListRepos:
		log.Printf("List repos request")
		repos := scanWorkspace()
		wsClient.Send(protocol.DaemonMessage{
			Type:  protocol.MsgTypeReposList,
			Repos: repos,
		})

	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

func sendPtySize(wsClient *client.Client, mgr *session.Manager, processID string) {
	cols, rows, err := mgr.Size(processID)
	if err != nil {
		log.Printf("Failed to get PTY size for process %s: %v", processID, err)
		return
	}

	wsClient.Send(protocol.DaemonMessage{
		Type:      protocol.MsgTypePtySize,
		ProcessID: processID,
		Cols:      cols,
		Rows:      rows,
	})
}

// createWorktree creates a new git worktree
func createWorktree(wsClient *client.Client, worktreeID, repoName, repoPath string) {
	worktreesDir := filepath.Join(repoPath, ".agenthq-worktrees")
	worktreePath := filepath.Join(worktreesDir, worktreeID)
	branch := fmt.Sprintf("agent/%s", worktreeID)

	// Create the worktrees directory if it doesn't exist
	if err := os.MkdirAll(worktreesDir, 0755); err != nil {
		log.Printf("Failed to create worktrees directory: %v", err)
		return
	}

	// Create the git worktree
	cmd := exec.Command("git", "worktree", "add", worktreePath, "-b", branch)
	cmd.Dir = repoPath
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to create worktree: %v\n%s", err, output)
		return
	}

	log.Printf("Created worktree %s at %s", worktreeID, worktreePath)

	// Notify server that worktree is ready
	wsClient.Send(protocol.DaemonMessage{
		Type:       protocol.MsgTypeWorktreeReady,
		WorktreeID: worktreeID,
		Path:       worktreePath,
		Branch:     branch,
	})
}

// removeWorktree removes a git worktree
func removeWorktree(worktreePath string) {
	if worktreePath == "" {
		log.Printf("Cannot remove worktree: empty path")
		return
	}

	// Get the parent repo path (two levels up from .agenthq-worktrees/<id>)
	repoPath := filepath.Dir(filepath.Dir(worktreePath))

	cmd := exec.Command("git", "worktree", "remove", "--force", worktreePath)
	cmd.Dir = repoPath
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to remove worktree: %v\n%s", err, output)
		return
	}

	log.Printf("Removed worktree at %s", worktreePath)
}

// scanWorkspace scans the workspace directory for git repositories
func scanWorkspace() []protocol.RepoInfo {
	var repos []protocol.RepoInfo

	if workspace == "" {
		log.Printf("No workspace configured, returning empty repos list")
		return repos
	}

	entries, err := os.ReadDir(workspace)
	if err != nil {
		log.Printf("Failed to read workspace directory: %v", err)
		return repos
	}

	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		repoPath := filepath.Join(workspace, entry.Name())
		gitPath := filepath.Join(repoPath, ".git")

		// Check if it's a git repo
		if info, err := os.Stat(gitPath); err == nil && info.IsDir() {
			defaultBranch := getDefaultBranch(repoPath)
			repos = append(repos, protocol.RepoInfo{
				Name:          entry.Name(),
				Path:          repoPath,
				DefaultBranch: defaultBranch,
			})
		}
	}

	log.Printf("Found %d repositories in workspace", len(repos))
	return repos
}

// getDefaultBranch reads the default branch from .git/HEAD
func getDefaultBranch(repoPath string) string {
	headPath := filepath.Join(repoPath, ".git", "HEAD")
	content, err := os.ReadFile(headPath)
	if err != nil {
		return "main"
	}

	line := strings.TrimSpace(string(content))
	if strings.HasPrefix(line, "ref: refs/heads/") {
		return strings.TrimPrefix(line, "ref: refs/heads/")
	}

	return "main"
}

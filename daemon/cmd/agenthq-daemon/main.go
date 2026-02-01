// Agent HQ Daemon - PTY manager and worktree handler
package main

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/agenthq/daemon/internal/client"
	"github.com/agenthq/daemon/internal/protocol"
	"github.com/agenthq/daemon/internal/session"
)

var version = "dev"

func main() {
	// Get server URL from environment
	serverURL := os.Getenv("AGENTHQ_SERVER_URL")
	if serverURL == "" {
		serverURL = "ws://localhost:3000/ws/daemon"
	}

	// Generate environment ID and name
	hostname, _ := os.Hostname()
	envID := fmt.Sprintf("daemon-%s-%d", hostname, time.Now().Unix())
	envName := hostname

	log.Printf("Agent HQ Daemon %s", version)
	log.Printf("Environment: %s (%s)", envName, envID)
	log.Printf("Connecting to: %s", serverURL)

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
	wsClient = client.New(serverURL, envID, envName,
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
				// Generate new env ID for reconnection
				envID = fmt.Sprintf("daemon-%s-%d", hostname, time.Now().Unix())
				wsClient = client.New(serverURL, envID, envName,
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
		}

	case protocol.MsgTypeKill:
		log.Printf("Kill request: processId=%s", msg.ProcessID)
		if err := mgr.Kill(msg.ProcessID); err != nil {
			log.Printf("Failed to kill process: %v", err)
		}

	case protocol.MsgTypeRemoveWorktree:
		log.Printf("Remove worktree request: worktreeId=%s path=%s", msg.WorktreeID, msg.WorktreePath)
		go removeWorktree(msg.WorktreePath)

	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
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

	// Run setup.sh if it exists
	setupScript := filepath.Join(repoPath, ".agenthq", "setup.sh")
	if _, err := os.Stat(setupScript); err == nil {
		log.Printf("Running setup script for worktree %s", worktreeID)
		cmd := exec.Command("bash", setupScript)
		cmd.Dir = worktreePath
		if output, err := cmd.CombinedOutput(); err != nil {
			log.Printf("Setup script error: %v\n%s", err, output)
		}
	}

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

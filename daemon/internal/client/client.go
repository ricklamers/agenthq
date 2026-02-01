// Package client provides WebSocket client for connecting to the server.
package client

import (
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/agenthq/daemon/internal/protocol"
	"github.com/gorilla/websocket"
)

// Client manages the WebSocket connection to the server.
type Client struct {
	url          string
	authToken    string
	envID        string
	envName      string
	workspace    string
	conn         *websocket.Conn
	mu           sync.Mutex
	done         chan struct{}
	onMessage    func(protocol.ServerMessage)
	onDisconnect func()
}

// New creates a new client.
func New(url, authToken, envID, envName, workspace string, onMessage func(protocol.ServerMessage), onDisconnect func()) *Client {
	return &Client{
		url:          url,
		authToken:    authToken,
		envID:        envID,
		envName:      envName,
		workspace:    workspace,
		done:         make(chan struct{}),
		onMessage:    onMessage,
		onDisconnect: onDisconnect,
	}
}

// Connect establishes connection to the server.
func (c *Client) Connect() error {
	// Add auth token as query parameter if provided
	url := c.url
	if c.authToken != "" {
		if strings.Contains(url, "?") {
			url += "&token=" + c.authToken
		} else {
			url += "?token=" + c.authToken
		}
	}

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	// Send registration message
	c.Send(protocol.DaemonMessage{
		Type:         protocol.MsgTypeRegister,
		EnvID:        c.envID,
		EnvName:      c.envName,
		Workspace:    c.workspace,
		Capabilities: []string{"bash", "claude-code", "codex-cli", "cursor-agent"},
	})

	// Start message reader
	go c.readLoop()

	// Start heartbeat
	go c.heartbeatLoop()

	return nil
}

// Send sends a message to the server.
func (c *Client) Send(msg protocol.DaemonMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	return c.conn.WriteMessage(websocket.TextMessage, data)
}

// Close closes the connection.
func (c *Client) Close() {
	close(c.done)

	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.mu.Unlock()
}

func (c *Client) readLoop() {
	defer func() {
		c.mu.Lock()
		if c.conn != nil {
			c.conn.Close()
			c.conn = nil
		}
		c.mu.Unlock()

		// Notify about disconnection (for reconnect logic)
		if c.onDisconnect != nil {
			c.onDisconnect()
		}
	}()

	for {
		select {
		case <-c.done:
			return
		default:
		}

		c.mu.Lock()
		conn := c.conn
		c.mu.Unlock()

		if conn == nil {
			return
		}

		_, data, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Read error: %v", err)
			return
		}

		var msg protocol.ServerMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("Failed to parse message: %v", err)
			continue
		}

		c.onMessage(msg)
	}
}

func (c *Client) heartbeatLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			c.Send(protocol.DaemonMessage{
				Type: protocol.MsgTypeHeartbeat,
			})
		}
	}
}

// Reconnect attempts to reconnect to the server.
func (c *Client) Reconnect() error {
	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.mu.Unlock()

	return c.Connect()
}

// Package pty provides PTY management for spawning processes.
package pty

import (
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/creack/pty"
)

// Process represents a running PTY process.
type Process struct {
	cmd  *exec.Cmd
	pty  *os.File
	done chan struct{}
	mu   sync.Mutex
}

// setEnv sets or overrides an environment variable in the slice.
// It removes any existing value for the key before adding the new one.
func setEnv(env []string, key, value string) []string {
	prefix := key + "="
	// Filter out existing values for this key
	filtered := make([]string, 0, len(env))
	for _, e := range env {
		if !strings.HasPrefix(e, prefix) {
			filtered = append(filtered, e)
		}
	}
	return append(filtered, key+"="+value)
}

// removeEnv removes an environment variable from the slice.
func removeEnv(env []string, key string) []string {
	prefix := key + "="
	filtered := make([]string, 0, len(env))
	for _, e := range env {
		if !strings.HasPrefix(e, prefix) {
			filtered = append(filtered, e)
		}
	}
	return filtered
}


// Spawn starts a new process with a PTY.
func Spawn(command string, args []string, dir string, env []string, cols, rows int) (*Process, error) {
	cmd := exec.Command(command, args...)
	cmd.Dir = dir

	// Start with base environment
	baseEnv := os.Environ()

	// Override terminal and color settings (filter duplicates first)
	baseEnv = setEnv(baseEnv, "TERM", "xterm-256color")
	baseEnv = setEnv(baseEnv, "CLICOLOR", "1")           // BSD ls colors (macOS)
	baseEnv = setEnv(baseEnv, "CLICOLOR_FORCE", "1")     // Force BSD colors
	baseEnv = setEnv(baseEnv, "COLORTERM", "truecolor")  // 24-bit color support
	baseEnv = removeEnv(baseEnv, "NO_COLOR")             // Remove NO_COLOR to allow colors
	baseEnv = setEnv(baseEnv, "FORCE_COLOR", "3")        // Force colors for Node.js CLI tools (level 3 = 256 colors)

	// Disable CI detection for TUI apps like Ink
	// Many CLI frameworks (Ink, inquirer, etc) check for CI env vars and disable
	// interactive rendering when they think they're in CI. Setting CI=false
	// is sufficient as is-in-ci checks this value first before other conditions.
	baseEnv = setEnv(baseEnv, "CI", "false")

	// Add any additional env vars
	cmd.Env = append(baseEnv, env...)

	// Set initial terminal size
	winSize := &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	}

	ptmx, err := pty.StartWithSize(cmd, winSize)
	if err != nil {
		return nil, err
	}

	return &Process{
		cmd:  cmd,
		pty:  ptmx,
		done: make(chan struct{}),
	}, nil
}

// Read reads from the PTY.
func (p *Process) Read(buf []byte) (int, error) {
	return p.pty.Read(buf)
}

// Write writes to the PTY.
func (p *Process) Write(data []byte) (int, error) {
	return p.pty.Write(data)
}

// Resize resizes the PTY window.
func (p *Process) Resize(cols, rows uint16) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	return pty.Setsize(p.pty, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
}

// Wait waits for the process to exit and returns the exit code.
func (p *Process) Wait() (int, error) {
	err := p.cmd.Wait()
	close(p.done)

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode(), nil
		}
		return -1, err
	}
	return 0, nil
}

// Kill terminates the process.
func (p *Process) Kill() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.cmd.Process != nil {
		return p.cmd.Process.Kill()
	}
	return nil
}

// Close closes the PTY file descriptor.
func (p *Process) Close() error {
	return p.pty.Close()
}

// Done returns a channel that is closed when the process exits.
func (p *Process) Done() <-chan struct{} {
	return p.done
}

// incompleteUTF8Len returns the number of bytes at the end of data that form
// an incomplete UTF-8 sequence. Returns 0 if the data ends on a complete character.
func incompleteUTF8Len(data []byte) int {
	if len(data) == 0 {
		return 0
	}

	// Check last 1-3 bytes for incomplete multi-byte sequences
	for i := 1; i <= 3 && i <= len(data); i++ {
		b := data[len(data)-i]
		// Check if this byte is a UTF-8 leading byte
		if b&0x80 == 0 {
			// ASCII byte - sequence is complete
			return 0
		} else if b&0xC0 == 0x80 {
			// Continuation byte - keep looking for leading byte
			continue
		} else if b&0xE0 == 0xC0 {
			// 2-byte sequence start - need 2 bytes total
			if i < 2 {
				return i
			}
			return 0
		} else if b&0xF0 == 0xE0 {
			// 3-byte sequence start - need 3 bytes total
			if i < 3 {
				return i
			}
			return 0
		} else if b&0xF8 == 0xF0 {
			// 4-byte sequence start - need 4 bytes total
			if i < 4 {
				return i
			}
			return 0
		}
	}

	// Check if we have a 4-byte sequence that started within last 3 bytes
	// by checking if there's a 4-byte leader in positions -4 to -1
	if len(data) >= 4 {
		for i := 1; i <= 3; i++ {
			b := data[len(data)-i]
			if b&0xF8 == 0xF0 {
				// 4-byte sequence needs 4 bytes
				if i < 4 {
					return i
				}
			}
		}
	}

	return 0
}

// StartReadLoop starts a goroutine that reads from PTY and sends data via callback.
// It handles UTF-8 boundaries to prevent multi-byte characters from being split.
func (p *Process) StartReadLoop(onData func([]byte)) {
	go func() {
		buf := make([]byte, 4096)
		var pending []byte // Buffer for incomplete UTF-8 sequences

		for {
			n, err := p.Read(buf)
			if n > 0 {
				// Prepend any pending bytes from previous read
				var data []byte
				if len(pending) > 0 {
					data = make([]byte, len(pending)+n)
					copy(data, pending)
					copy(data[len(pending):], buf[:n])
					pending = nil
				} else {
					data = make([]byte, n)
					copy(data, buf[:n])
				}

				// Check for incomplete UTF-8 at the end
				incomplete := incompleteUTF8Len(data)
				if incomplete > 0 {
					// Save incomplete bytes for next iteration
					pending = make([]byte, incomplete)
					copy(pending, data[len(data)-incomplete:])
					data = data[:len(data)-incomplete]
				}

				if len(data) > 0 {
					onData(data)
				}
			}
			if err != nil {
				// Send any remaining pending bytes before exiting
				if len(pending) > 0 {
					onData(pending)
				}
				if err != io.EOF {
					// Log error but don't crash
				}
				return
			}
		}
	}()
}

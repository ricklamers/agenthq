# Agent HQ

Browser-based control plane for managing coding agents (Claude Code, Codex CLI, Cursor Agent, etc.) across multiple environments.

<img width="3451" height="1990" alt="image" src="https://github.com/user-attachments/assets/8a917cbb-2fc0-49b8-8a0f-71a63710bde6" />

\> [check video demo](https://x.com/RickLamers/status/2018084764285382851)

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Go 1.23+

### Setup

```bash
# Install dependencies
pnpm install

# Build shared package
pnpm --filter @agenthq/shared build

# Build daemon
cd daemon && make build && cd ..
```

### Development (Recommended)

Use the Makefile for managing all services:

```bash
# Create test workspace
mkdir -p /tmp/agenthq-test
cd /tmp/agenthq-test
git init --initial-branch=main my-project
cd my-project && echo "# Test" > README.md && git add . && git commit -m "init"
cd ../..

# Start all services
make start WORKSPACE=/tmp/agenthq-test

# Check status
make status

# View logs
make tail-logs

# Restart individual services
make restart-daemon  # Rebuilds Go binary and restarts
make restart-server  # Restarts Node server
make restart-web     # Restarts Vite dev server

# Stop everything
make stop
```

Open http://localhost:5173 in your browser.

### Manual Development

If you prefer manual control:

```bash
# Terminal 1: Start server
AGENTHQ_WORKSPACE=/tmp/agenthq-test pnpm --filter @agenthq/server dev

# Terminal 2: Start web client
pnpm --filter @agenthq/web dev

# Terminal 3: Start daemon
AGENTHQ_SERVER_URL=ws://localhost:3000/ws/daemon ./daemon/agenthq-daemon
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser Client                               │
│           React + Vite + shadcn + xterm.js                          │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ WebSocket
                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          agenthq-server                             │
│                    Node + Fastify + TypeScript                      │
└───────────────────┬─────────────────────────────────────────────────┘
                    │ WebSocket
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          agenthq-daemon                              │
│                               Go                                     │
│                     PTY spawning, worktree mgmt                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
agenthq/
├── packages/
│   ├── server/         # @agenthq/server - Fastify API + WebSocket
│   ├── web/            # @agenthq/web - React UI
│   └── shared/         # @agenthq/shared - Protocol types
├── daemon/             # Go daemon binary
├── package.json        # Root workspace config
└── pnpm-workspace.yaml
```

## Environment Variables

### Server

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTHQ_WORKSPACE` | Yes | Path to workspace folder containing repos |
| `AGENTHQ_PORT` | No | Server port (default: 3000) |

### Daemon

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTHQ_SERVER_URL` | Yes | WebSocket URL to connect to |
| `AGENTHQ_ENV_ID` | No | Environment ID (auto-generated if not set) |
| `AGENTHQ_AUTH_TOKEN` | No | Auth token for remote connections |

The daemon also accepts a `--workspace` flag for remote deployments:

```bash
./agenthq-daemon --workspace /path/to/workspace
```

## Supported Agents

| Agent | Command | Description |
|-------|---------|-------------|
| Claude Code | `claude` | Anthropic coding agent |
| Codex CLI | `codex` | OpenAI coding agent |
| Cursor Agent | `cursor-agent` | Cursor coding agent |
| Kimi CLI | `kimi` | Moonshot coding agent |
| Droid CLI | `droid` | Factory AI coding agent |
| Terminal | `bash` | Plain shell |

## License

MIT

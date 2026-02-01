# Agent HQ

Browser-based control plane for managing coding agents (Claude Code, Codex CLI, etc.) across multiple environments.

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

### Development

Create a test workspace directory:

```bash
mkdir -p /tmp/agenthq-test
cd /tmp/agenthq-test
git clone https://github.com/some/repo  # clone a test repo
```

Start the server and web client:

```bash
# Terminal 1: Start server
AGENTHQ_WORKSPACE=/tmp/agenthq-test pnpm --filter @agenthq/server dev

# Terminal 2: Start web client
pnpm --filter @agenthq/web dev

# Terminal 3: Start daemon
AGENTHQ_SERVER_URL=ws://localhost:3000/ws/daemon ./daemon/agenthq-daemon
```

Open http://localhost:5173 in your browser.

### Combined Dev Mode

```bash
# Start server and web together
AGENTHQ_WORKSPACE=/tmp/agenthq-test pnpm dev
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

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTHQ_WORKSPACE` | Yes | Path to workspace folder containing repos |
| `AGENTHQ_PORT` | No | Server port (default: 3000) |
| `AGENTHQ_SERVER_URL` | Yes (daemon) | WebSocket URL daemon connects to |

## License

MIT

# Agent HQ - Agent Instructions

## Development Workflow

### Using the Makefile

The project includes a Makefile for managing all services. Run from the project root:

```bash
# Show all commands
make help

# Start/stop/restart all services
make start              # Start server, web, and daemon
make stop               # Stop all services
make restart            # Restart all services
make status             # Show what's running

# Individual services
make restart-daemon     # Rebuild and restart daemon (use after Go changes)
make restart-server     # Restart the API server
make restart-web        # Restart the web frontend

# View logs (output goes to logs/ folder)
make logs               # Show log file locations
make logs-server        # Tail server logs
make logs-daemon        # Tail daemon logs
make tail-logs          # Tail all logs

# With custom workspace
make start WORKSPACE=/path/to/workspace
```

### Hot Reload Behavior

| Component | Hot Reload? | Restart Required? |
|-----------|-------------|-------------------|
| **Server** (`packages/server`) | Yes (`tsx watch`) | No - auto-reloads |
| **Web** (`packages/web`) | Yes (Vite HMR) | No - auto-reloads |
| **Daemon** (`daemon/`) | No | Yes - use `make restart-daemon` |

### Manual Commands (if needed)

```bash
# Server (has hot reload)
cd packages/server && pnpm dev

# Web (has hot reload)  
cd packages/web && pnpm dev

# Daemon (no hot reload)
cd daemon && go build ./cmd/agenthq-daemon && ./agenthq-daemon
```

## Current Live Dev Setup (This Host)

### Canonical Checkout

- Active checkout for live development:
  - `/tmp/agenthq-test/test-repo/agenthq-clone`
- Do not run the app from `/home/rick/workspace/agenthq` anymore.

### Runtime Process Manager

Agent HQ now runs under **user-level systemd** services (not ad-hoc shell background jobs):

- `agenthq-server.service`
- `agenthq-web.service`
- `agenthq-daemon.service`

Unit files:

- `/home/rick/.config/systemd/user/agenthq-server.service`
- `/home/rick/.config/systemd/user/agenthq-web.service`
- `/home/rick/.config/systemd/user/agenthq-daemon.service`

Linger is enabled for user `rick` (`loginctl show-user rick -p Linger` -> `yes`) so services survive logout.

### Service Commands

```bash
# status
systemctl --user status agenthq-server agenthq-web agenthq-daemon

# restart
systemctl --user restart agenthq-server agenthq-web agenthq-daemon

# logs
journalctl --user -u agenthq-server -u agenthq-web -u agenthq-daemon -f
```

### Runtime Topology

- Workspace: `/tmp/agenthq-test`
- Server: `http://127.0.0.1:3000` (`pnpm --filter @agenthq/server dev`)
- Web (Vite dev server): `http://127.0.0.1:5173` (`pnpm --filter @agenthq/web dev -- --host 127.0.0.1 --port 5173`)
- Daemon connects to: `ws://127.0.0.1:3000/ws/daemon`
- Nginx domain: `agenthq.omba.nl`
  - `80 -> 301 https`
  - `443` is basic-auth protected and reverse proxies to Vite/API/WS

### Quick Health Checks

```bash
curl -sS -o /dev/null -w 'vite:%{http_code}\n' http://127.0.0.1:5173/
curl -sS -o /dev/null -w 'api:%{http_code}\n' 'http://127.0.0.1:3000/api/repos?envId=local'
curl -sS http://127.0.0.1:3000/api/environments | jq .
ss -ltnp | grep -E ':(3000|5173)\b'
```

Expected:

- Vite `200`
- API `200`
- `local` environment status `connected`

### Current Product Behaviors Added in Live Dev

- Mobile: sidebar is collapsible overlay.
- Mobile: split panes disabled; tabs-only terminal behavior.
- Repos:
  - "Add repo" UI is a native app dialog (no `window.prompt`).
  - Backend supports adding repos via public GitHub HTTPS URL for local env (`POST /api/repos`).

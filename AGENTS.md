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

### Restart Behavior

| Component | Auto-Reload? | Restart Required? |
|-----------|-------------|-------------------|
| **Server** (`packages/server`) | No | Yes - use `make restart-server` |
| **Web** (`packages/web`) | No (uses `vite preview`) | Yes - rebuild and restart |
| **Daemon** (`daemon/`) | No | Yes - use `make restart-daemon` |

### Manual Commands (if needed)

```bash
# Server (no auto-reload)
cd packages/server && pnpm dev

# Web (no auto-reload, serves built assets)
cd packages/web && pnpm preview

# Daemon (no auto-reload)
cd daemon && go build ./cmd/agenthq-daemon && ./agenthq-daemon
```

## Current Live Dev Setup (This Host)

### Canonical Checkout

- **The only checkout is `/tmp/agenthq-test/agenthq`.**
- All development, editing, committing, and running happens here.
- There is no secondary workspace. Do not create or use other clones.

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

### Daemon Auth Token

The daemon must authenticate to the server via `AGENTHQ_AUTH_TOKEN`. The token is stored in:
- **Server side:** `/tmp/agenthq-test/.agenthq-meta/config.json` (`daemonAuthToken` field)
- **Daemon side:** `AGENTHQ_AUTH_TOKEN` env var in `agenthq-daemon.service`

If the server rejects the daemon with `Invalid auth token`, verify these match.

### Runtime Topology

- Workspace: `/tmp/agenthq-test`
- Server: `http://127.0.0.1:3000` (no auto-reload, `tsx src/index.ts`)
- Web (Vite preview, built assets): `http://127.0.0.1:5173`
- Daemon connects to: `ws://127.0.0.1:3000/ws/daemon` with auth token
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

- Web `200`
- API `200`
- `local` environment status `connected`

### Frontend Update Flow (Current)

- The live web service is **not** running HMR anymore.
- Frontend code changes require rebuilding before they appear in the browser:

```bash
cd /tmp/agenthq-test/agenthq
pnpm --filter @agenthq/web build
```

- After build completes, a manual browser reload picks up the new client bundle.

### Deploy/Apply Change Checklist (Explicit)

Use this to decide what to run after code changes in `/tmp/agenthq-test/agenthq`:

| Change Type | Required Step(s) |
|-------------|------------------|
| **Frontend only** (`packages/web/**`) | Run `pnpm --filter @agenthq/web build` **only**. |
| **Server only** (`packages/server/**`) | Restart server: `systemctl --user restart agenthq-server` |
| **Daemon only** (`daemon/**`) | Rebuild/restart daemon: `make restart-daemon` or `systemctl --user restart agenthq-daemon` after rebuild workflow |
| **Frontend + Server** | Run web build and restart server |
| **Frontend + Daemon** | Run web build and restart daemon |
| **Server + Daemon** | Restart server, then restart daemon |
| **All three** | Run web build, restart server, restart daemon |

Rule of thumb: **If changes are only about the frontend, only run the frontend build.**

### Current Product Behaviors Added in Live Dev

- Mobile: sidebar is collapsible overlay.
- Mobile: split panes disabled; tabs-only terminal behavior.
- Repos:
  - "Add repo" UI is a native app dialog (no `window.prompt`).
  - Backend supports adding repos via public GitHub HTTPS URL for local env (`POST /api/repos`).

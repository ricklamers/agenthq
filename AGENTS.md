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

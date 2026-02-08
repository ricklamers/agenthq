# Agent HQ — Design Document

Browser-based control plane for managing coding agents (Claude Code, Codex CLI, etc.) across multiple environments. Single-user, local-first, git worktree-based isolation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser Client                               │
│           React + Vite + shadcn (Mira) + xterm.js                   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ WebSocket
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          agenthq-server                             │
│                    Node + Fastify + TypeScript                      │
│  • HTTP API (repos, worktrees, processes)                           │
│  • WebSocket hub (browser clients, daemons)                         │
│  • Terminal buffer store                                            │
│  • Worktree/process state                                           │
└───────────────────┬─────────────────────────────────────────────────┘
                    │ WebSocket (outbound from daemon)
        ┌───────────┴───────────┐
        ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│  agenthq-daemon  │    │  agenthq-daemon  │
│  (server-local)  │    │  (MacBook)       │
│       Go         │    │       Go         │
│  • PTY manager   │    │  • PTY manager   │
│  • Worktree mgmt │    │  • Worktree mgmt │
│  • Cmd runner    │    │  • Cmd runner    │
└──────────────────┘    └──────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Server** | Node.js + Fastify + TypeScript |
| **Daemon** | Go (cross-compiled for macOS, Linux) |
| **Web Client** | React + Vite + TypeScript + shadcn/ui (Mira style) + xterm.js |
| **Monorepo** | pnpm workspaces |

### xterm.js Requirements

Must support **DEC private mode 2026** (synchronized output) for smooth rendering of high-bandwidth agent output:

| Sequence | Name | Purpose |
|----------|------|---------|
| `CSI ? 2026 h` | BSU | Begin Synchronized Update — defer rendering |
| `CSI ? 2026 l` | ESU | End Synchronized Update — flush buffer atomically |
| `CSI ? 2026 $ p` | DECRQM | Query mode support |

This prevents screen tearing during rapid output from coding agents. Requires **xterm.js 6.0.0+** (released Dec 22, 2025). Include 1s safety timeout for auto-flush if ESU not received.

## Components

| Component | Responsibilities |
|-----------|------------------|
| **server** | HTTP API, WebSocket hub, state management, serves built web assets when available |
| **daemon** | PTY spawning, worktree operations, command execution, connects to server |
| **web** | UI, terminal display, repo/worktree/process management |

## Configuration

### Server Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTHQ_WORKSPACE` | Yes | Path to workspace folder containing repos. Exit if not set. |
| `AGENTHQ_PORT` | No | Server port (default: 3000) |

### Daemon Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTHQ_SERVER_URL` | No | WebSocket URL to connect to (default: `ws://localhost:3000/ws/daemon`) |
| `AGENTHQ_ENV_ID` | No | Environment ID (auto-generated if not set) |
| `AGENTHQ_AUTH_TOKEN` | No | Optional daemon auth token (sent as `?token=...`; enforced for non-local daemon connections) |

### Daemon CLI Flags

| Flag | Description |
|------|-------------|
| `--workspace` | Path to workspace folder. Optional; when omitted, repo listing returns empty. |

## Data Model

```
Repo (1:N) → Worktree (1:N) → Process
```

| Entity | Description |
|--------|-------------|
| **Repo** | Git repository in workspace |
| **Worktree** | Git worktree (main or `.agenthq-worktrees/<id>/`). First-class sidebar item. |
| **Process** | Running PTY in a worktree. Displayed as tab in main area. Multiple per worktree. |

- A worktree can have multiple processes (e.g., claude + bash + codex all in same worktree)
- Processes share the filesystem — git coordination left to agent CLIs
- Main worktree (`main` branch) is valid for running processes

## Workspace Structure

```
$AGENTHQ_WORKSPACE/
├── project-a/
│   ├── .git/
│   ├── .agenthq-worktrees/
│   │   └── <worktree-id>/       # Worktree (can have multiple processes)
│   ├── .agenthq/
│   │   └── setup.sh             # Optional per-repo setup script
│   └── <repo files>
├── project-b/
└── .agenthq-meta/
    └── repos.json               # Repo registry
```

## Daemon

### Supported Platforms

| Platform | Architecture | Binary |
|----------|--------------|--------|
| macOS | arm64 | `agenthq-daemon-darwin-arm64` |
| macOS | amd64 | `agenthq-daemon-darwin-amd64` |
| Linux | arm64 | `agenthq-daemon-linux-arm64` |
| Linux | amd64 | `agenthq-daemon-linux-amd64` |

### Runtime Requirements

Daemon does not install dependencies. Required CLIs must already be available on `PATH`.

Core requirement:
- `git`

Agent CLIs used by spawn commands:
- `claude` (`claude-code`)
- `codex` (`codex-cli`)
- `cursor-agent` (`cursor-agent`)
- `kimi` (`kimi-cli`)
- `droid` (`droid-cli`)
- `bash` (`bash`/`shell`)

Daemon currently advertises capabilities: `bash`, `claude-code`, `codex-cli`, `cursor-agent`.

### Worktree Management

Worktrees are created explicitly by the user (not automatically per process):

```
git worktree add .agenthq-worktrees/<worktree-id> -b agent/<worktree-id>
```

Branch naming:
- Initial: `agent/<worktree-id>`
- Agent renames to meaningful name (e.g., `feature/add-dark-mode`)
- Server creates a temporary placeholder branch value until daemon sends `worktree-ready` with final branch.

Main worktree (the repo root) is always available — no need to create a worktree to run processes.

## Worktree & Process Lifecycle

```
[User: clicks "+ New Worktree" on project-a]
        │
        ▼
[Server: POST /api/repos/:name/worktrees]
        │
        ▼
[Daemon: git worktree add .agenthq-worktrees/<id> -b agent/<id>]
        │
        ▼
[Daemon: run .agenthq/setup.sh if exists]
        │
        ▼
[User: clicks "+ New Tab" → Claude Code in that worktree]
        │
        ▼
[Server: POST /api/worktrees/:id/processes]
        │
        ▼
[Daemon: spawn claude-code in worktree PTY]
        │
        ▼
[Agent works, streams output → daemon → server → browser]
        │
        ▼
[User: clicks "+ New Tab" → bash (second process in same worktree)]
        │
        ▼
[Daemon: spawn bash in same worktree PTY]
        │
        ▼
[User: triggers diff]
        │
        ▼
[Server: instructs daemon to spawn shell in worktree running "git diff main --stat && echo '---' && git diff main"]
        │
        ▼
[User: triggers merge]
        │
        ▼
[Server: instructs daemon to spawn shell in main worktree to run merge]
        │
        ▼
[User: clicks "Archive Worktree"]
        │
        ▼
[Daemon: kill all processes, git worktree remove]
```

## Protocol

### Daemon ↔ Server (WebSocket)

| Direction | Type | Payload |
|-----------|------|---------|
| D→S | `register` | `{ envId, envName, capabilities[], workspace? }` |
| D→S | `heartbeat` | `{}` |
| D→S | `pty-data` | `{ processId, data }` (`data` is base64-encoded PTY bytes) |
| D→S | `process-started` | `{ processId }` |
| D→S | `process-exit` | `{ processId, exitCode }` |
| D→S | `branch-changed` | `{ worktreeId, branch }` (reserved; not currently emitted) |
| D→S | `worktree-ready` | `{ worktreeId, path, branch }` |
| D→S | `repos-list` | `{ repos: [{ name, path, defaultBranch }] }` |
| S→D | `create-worktree` | `{ worktreeId, repoName, repoPath }` |
| S→D | `spawn` | `{ processId, worktreeId, worktreePath, agent, args[], task?, cols?, rows?, yoloMode? }` (`args[]` currently ignored by daemon) |
| S→D | `pty-input` | `{ processId, data }` (`data` is base64-encoded input bytes) |
| S→D | `resize` | `{ processId, cols, rows }` |
| S→D | `kill` | `{ processId }` |
| S→D | `remove-worktree` | `{ worktreeId, worktreePath }` |
| S→D | `list-repos` | `{}` |

### Browser ↔ Server (WebSocket)

| Direction | Type | Payload |
|-----------|------|---------|
| B→S | `attach` | `{ processId, skipBuffer? }` |
| B→S | `detach` | `{ processId }` |
| B→S | `input` | `{ processId, data }` |
| B→S | `resize` | `{ processId, cols, rows }` |
| S→B | `pty-data` | `{ processId, data }` |
| S→B | `process-update` | `{ process }` |
| S→B | `process-removed` | `{ processId }` |
| S→B | `worktree-update` | `{ worktree }` |
| S→B | `worktree-removed` | `{ worktreeId }` |
| S→B | `env-update` | `{ environments }` |
| S→B | `error` | `{ message }` |

Notes:
- Daemon ↔ server PTY payloads use base64 strings; server decodes to plain text for browser clients and encodes browser input before forwarding to daemon.
- On daemon register, server reconciles `envId`/`envName` against configured environments and may remap to a configured environment ID.
- For `local`, repo discovery is server-side from `AGENTHQ_WORKSPACE`; daemon `repos-list` is used for non-local environments.

## HTTP API

### Repos

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/repos?envId=` | List repos (optionally filtered by env) |
| POST | `/api/repos` | Clone public GitHub repo into local workspace. Body: `{ url, envId? }` (defaults to `local`; only local supported). Returns `201` Repo. |
| GET | `/api/repos/:name?envId=` | Repo details |
| DELETE | `/api/repos/:name?envId=` | Remove repo (local only). Deletes repo dir, removes related worktrees/processes, notifies daemon. Returns `{ success: true }`. |

### Worktrees

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/worktrees` | List all worktrees |
| GET | `/api/worktrees/:id` | Worktree details + processes |
| POST | `/api/repos/:name/worktrees` | Create worktree `{ envId }` |
| DELETE | `/api/worktrees/:id` | Archive worktree (kills processes, removes) |
| POST | `/api/worktrees/:id/diff` | Run diff command (spawns shell process) |
| POST | `/api/worktrees/:id/merge` | Merge into main branch |
| POST | `/api/worktrees/:id/merge-with-agent` | Merge with agent conflict resolution `{ agent? }` |

### Processes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/processes` | List all processes |
| GET | `/api/processes/:id` | Process details |
| POST | `/api/worktrees/:id/processes` | Spawn process `{ agent, task?, envId, cols?, rows?, yoloMode? }` |
| DELETE | `/api/processes/:id?remove=` | Kill process (or remove if `?remove=true`) |

### Environments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/environments` | List all environments |
| GET | `/api/environments/:envId` | Get environment |
| POST | `/api/environments` | Create exe.dev environment `{ name, vmName }` |
| DELETE | `/api/environments/:envId` | Local: disconnect daemon but keep config. Exe: stop processes, close WS, destroy VM (if present), remove config. |
| POST | `/api/environments/:envId/provision` | Exe only. Requires server public URL. Uploads daemon, creates `/workspace`, disables exe.dev banner, creates a test repo, starts daemon. |
| POST | `/api/environments/:envId/update-daemon` | Update daemon on exe.dev environment |
| POST | `/api/environments/:envId/restart` | Restart daemon |

### Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Get config (tokens masked) |
| POST | `/api/config/sprites-token` | Set sprites token `{ token }` |
| POST | `/api/config/server-url` | Set server public URL `{ url }` |
| POST | `/api/config/daemon-auth-token` | Set daemon auth token `{ token }` |

## Supported Agents

| Agent | CLI Command | Yolo Mode | Status |
|-------|-------------|-----------|--------|
| Claude Code | `claude` | Yes | Supported |
| Codex CLI | `codex` | Yes | Supported |
| Cursor Agent | `cursor-agent` | Yes | Supported |
| Kimi CLI | `kimi` | Yes | Supported |
| Droid CLI | `droid` | No | Supported |
| Terminal | `bash` / `shell` | No | Supported |

Tasks are passed via the `task` field in the spawn message. For shell agents, the task is executed as a command. For coding agents, it's passed as the initial prompt. (Current UI spawn dialog does not expose a free-form prompt field.)

## UI/UX

### Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [claude] [bash] [codex]                                        [New Tab]  │
├─────────────────┬──────────────────────────────────────────────────────────┤
│ Environment: ▼  │                                                          │
│ ● Connected     │  ┌────────────────────────────────────────────────────┐  │
│                 │  │                                                    │  │
│ REPOS        [+]│  │                    Terminal                        │  │
│ ▼ project-a     │  │                                                    │  │
│   ├ main        │  └────────────────────────────────────────────────────┘  │
│   └ agent/abc   │                                                          │
│   [+ Worktree]  │  [Agent Merge] [Archive Worktree] (non-main only)       │
└─────────────────┴──────────────────────────────────────────────────────────┘
```

### Mobile

- Sidebar is hidden by default on mobile (`max-width: 767px`).
- A menu button in the tab bar opens the sidebar as a slide-in overlay.
- A dimmed backdrop closes the sidebar.

### Left Sidebar

Hierarchical tree: Repo → Worktree

```
REPOS
▼ project-a              ← Repo (collapsible)
  ├ main                 ← Main worktree (always present)
  ├ agent/abc123         ← Worktree (branch name)
  └ feature/dark-mode    ← Worktree (renamed branch)
  [+ New Worktree]       ← Creates new worktree
▼ project-b
  ├ main
  └ fix/login-bug
▶ project-c              ← Collapsed repo
```

- **Repos**: Top-level groups, collapsible
- **Worktrees**: Nested under each repo, includes main + additional worktrees
- **[+ New Worktree]**: Button under each repo to create worktree
- **[+ Add Repo]**: Icon button in the REPOS section header
- **Environment selector**: Dropdown in sidebar header; repo/worktree list is scoped to selected environment
- **Connection status**: Connected/Disconnected indicator for selected environment
- Selecting a worktree shows its processes as tabs in main area
- Visual indicators: process count badge, branch name
- Add/Remove Repo actions are currently local-environment only
- Add Repo uses a modal dialog (no browser prompt) and accepts GitHub HTTPS/SSH URLs

### Main Area

When a worktree is selected:

- **Tab bar**: Each tab is a process (agent or shell) in the selected worktree
- **[New Tab]**: Opens spawn dialog for current worktree
- **Terminal**: xterm.js rendering the selected process's PTY output
- **Action bar**: Agent Merge and Archive Worktree buttons (shown only for non-main worktrees)

### Spawn Agent Dialog

Spawn dialog shows agent tiles plus Yolo Mode toggle:

- Terminal (bash)
- Claude Code
- Codex CLI
- Cursor Agent
- Droid CLI
- Kimi CLI
- Yolo Mode toggle (skip permission prompts)

### Interactions

| Action | Result |
|--------|--------|
| Click worktree in sidebar | Main area shows tabs (processes) for that worktree |
| Click tab | Switch to that process's terminal |
| Click "New Tab" | Opens spawn dialog for the selected worktree |
| Select agent in spawn dialog | Spawns process in current worktree |
| Click "+ New Worktree" | Creates worktree, selects it, then auto-opens spawn dialog when ready |
| Click empty worktree | Auto-opens spawn dialog |
| Click "Agent Merge" | Runs merge-with-agent flow for selected worktree |
| Click "Archive Worktree" | Kills all processes, removes worktree |

## Build Phases

| # | Phase | Deliverable |
|---|-------|-------------|
| 1 | Server scaffold | Fastify + WS + static serving, basic API stubs |
| 2 | Web scaffold | Vite + React + shadcn + routing, mock data |
| 3 | Daemon MVP | Go binary, connects to server, spawns process, streams PTY |
| 4 | End-to-end basic | Spawn bash from UI, interactive terminal works |
| 5 | Repo management | Clone from URL, list repos, workspace UI |
| 6 | Agent spawning | Spawn claude-code/codex-cli, agent selection UI |
| 7 | Worktree integration | Create worktree per session, branch tracking |
| 8 | Diff/merge flow | Terminal diff task + merge / merge-with-agent flows |
| 9 | Multi-environment | Daemon registration, environment selection |
| 10 | Polish | Reconnection, buffer persistence, compression |

## Monorepo Organization

### Why Monorepo

- **Shared types**: Protocol messages shared between server and web
- **Atomic changes**: Update server API and web client in one commit
- **Simplified dev**: `pnpm dev` starts server + web; daemon runs separately
- **Easier refactoring**: Move code between packages without repo juggling

### Package Structure

| Package | Language | Purpose |
|---------|----------|---------|
| `@agenthq/server` | TypeScript | Fastify server, WebSocket hubs, API |
| `@agenthq/web` | TypeScript | React SPA, xterm.js, UI |
| `@agenthq/shared` | TypeScript | Protocol types, constants, utilities |
| `daemon/` | Go | Standalone binary, not an npm package |

### pnpm Workspace Setup

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'daemon'  # Listed but not managed by pnpm (Go)
```

### Root Scripts

```json
// package.json (root)
{
  "scripts": {
    "dev": "concurrently -n server,web -c blue,green \"pnpm --filter @agenthq/server dev\" \"pnpm --filter @agenthq/web dev\"",
    "build": "pnpm -r build",
    "build:daemon": "cd daemon && make build",
    "build:daemon:all": "cd daemon && make build-all",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  }
}
```

Dev runtime topology:
- `pnpm dev` runs server (`:3000`) and Vite web (`:5173`).
- In development, Vite proxies `/api` and `/ws` to the server.
- Server-side static asset serving is used when a built web `dist` is present.

### Dependency Flow

```
@agenthq/web ──imports──▶ @agenthq/shared
                              ▲
@agenthq/server ──imports─────┘

daemon/ ◀──codegen (optional)── @agenthq/shared
```

- Web and server both import shared types
- Daemon can optionally codegen Go types from shared TypeScript (or just keep in sync manually)

### Shared Package Contents

```typescript
// packages/shared/src/types.ts
type AgentType = 'claude-code' | 'codex-cli' | 'cursor-agent' | 'kimi-cli' | 'droid-cli' | 'bash' | 'shell';
type ProcessStatus = 'pending' | 'running' | 'stopped' | 'error';
type EnvironmentType = 'local' | 'exe';
type EnvironmentStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface Worktree {
  id: string;
  repoName: string;
  path: string;
  branch: string;
  isMain: boolean;
  envId?: string;
  createdAt: number;
}

interface Process {
  id: string;
  worktreeId: string;
  agent: AgentType;
  status: ProcessStatus;
  envId: string;
  createdAt: number;
  exitCode?: number;
}

interface Environment {
  id: string;
  name: string;
  type: EnvironmentType;
  status: EnvironmentStatus;
  capabilities: string[];
  connectedAt?: number;
  lastHeartbeat?: number;
  vmName?: string;      // exe.dev
  vmSshDest?: string;   // exe.dev
  workspace?: string;
}

interface Repo {
  name: string;
  path: string;
  defaultBranch: string;
  envId?: string;
}

// packages/shared/src/protocol.ts
export type DaemonToServerMessage =
  | { type: 'register'; envId: string; envName: string; capabilities: string[]; workspace?: string }
  | { type: 'heartbeat' }
  | { type: 'pty-data'; processId: string; data: string } // base64-encoded bytes
  | { type: 'buffer-clear'; processId: string } // defined in shared types; not handled by daemon/server runtime
  | { type: 'process-started'; processId: string }
  | { type: 'process-exit'; processId: string; exitCode: number }
  | { type: 'worktree-ready'; worktreeId: string; path: string; branch: string }
  | { type: 'branch-changed'; worktreeId: string; branch: string } // reserved, not currently emitted
  | { type: 'repos-list'; repos: Array<{ name: string; path: string; defaultBranch: string }> };

export type ServerToDaemonMessage =
  | { type: 'create-worktree'; worktreeId: string; repoName: string; repoPath: string }
  | { type: 'spawn'; processId: string; worktreeId: string; worktreePath: string; agent: AgentType; args: string[]; task?: string; cols?: number; rows?: number; yoloMode?: boolean } // args currently ignored by daemon
  | { type: 'pty-input'; processId: string; data: string } // base64-encoded bytes
  | { type: 'resize'; processId: string; cols: number; rows: number }
  | { type: 'kill'; processId: string }
  | { type: 'remove-worktree'; worktreeId: string; worktreePath: string }
  | { type: 'list-repos' };

export type BrowserToServerMessage =
  | { type: 'attach'; processId: string; skipBuffer?: boolean }
  | { type: 'detach'; processId: string }
  | { type: 'input'; processId: string; data: string }
  | { type: 'resize'; processId: string; cols: number; rows: number };

export type ServerToBrowserMessage =
  | { type: 'pty-data'; processId: string; data: string }
  | { type: 'process-update'; process: Process }
  | { type: 'process-removed'; processId: string }
  | { type: 'worktree-update'; worktree: Worktree }
  | { type: 'worktree-removed'; worktreeId: string }
  | { type: 'env-update'; environments: Environment[] }
  | { type: 'error'; message: string };
```

### TypeScript Config

```json
// packages/shared/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "outDir": "dist"
  }
}

// packages/server/tsconfig.json
{
  "references": [{ "path": "../shared" }]
}
```

## Directory Structure

```
agenthq/
├── packages/
│   ├── server/             # @agenthq/server
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── api/
│   │   │   │   ├── index.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── environments.ts
│   │   │   │   ├── processes.ts
│   │   │   │   ├── repos.ts
│   │   │   │   └── worktrees.ts
│   │   │   ├── ws/
│   │   │   │   ├── index.ts
│   │   │   │   ├── daemon-hub.ts
│   │   │   │   └── browser-hub.ts
│   │   │   ├── state/
│   │   │   │   ├── index.ts
│   │   │   │   ├── config-store.ts
│   │   │   │   ├── env-store.ts
│   │   │   │   ├── process-store.ts
│   │   │   │   ├── repo-store.ts
│   │   │   │   └── worktree-store.ts
│   │   │   └── services/
│   │   │       ├── index.ts
│   │   │       ├── exe-client.ts
│   │   │       └── sprites-client.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                # @agenthq/web
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── index.css
│   │   │   ├── components/
│   │   │   │   ├── ui/           # shadcn components
│   │   │   │   ├── ConfirmDialog.tsx
│   │   │   │   ├── SettingsPage.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── SpawnDialog.tsx
│   │   │   │   ├── SplitTerminalContainer.tsx
│   │   │   │   └── TerminalPane.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── index.ts
│   │   │   │   ├── useTerminal.ts
│   │   │   │   └── useWebSocket.ts
│   │   │   └── lib/
│   │   │       └── utils.ts
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── shared/             # @agenthq/shared
│       ├── src/
│       │   ├── index.ts
│       │   ├── types.ts
│       │   ├── protocol.ts
│       │   └── constants.ts
│       ├── package.json
│       └── tsconfig.json
│
├── daemon/                 # Go binary (not npm)
│   ├── cmd/
│   │   └── agenthq-daemon/
│   │       └── main.go
│   ├── internal/
│   │   ├── client/
│   │   │   └── client.go
│   │   ├── protocol/
│   │   │   └── messages.go
│   │   ├── pty/
│   │   │   └── pty.go
│   │   └── session/
│   │       └── manager.go
│   ├── Makefile
│   ├── go.mod
│   └── go.sum
│
├── Makefile                # Development commands
├── package.json            # Root workspace config
├── pnpm-workspace.yaml
├── AGENTS.md               # Agent instructions
├── DESIGN_DOC.md
└── README.md
```

## Out of Scope (For Now)

- Multi-user / authentication
- Private repo cloning
- Remote push / PR creation
- Windows daemon builds
- Preview URLs / port forwarding (architecture should support adding this later — daemon can expose worktree dev servers via tunneled ports)

## Implemented Extensions

### exe.dev Integration

Remote environments via exe.dev VMs are supported:
- Create/destroy VMs via `exe` CLI
- Provision daemons remotely (upload binary, create workspace, start daemon)
- Update daemons on running VMs
- Environments tracked per-repo and per-worktree

### Multi-Environment Support

- Local daemon auto-connects on startup
- Remote daemons (exe.dev) connect with auth tokens
- Environment selector in UI to switch contexts
- Repos and worktrees are environment-scoped

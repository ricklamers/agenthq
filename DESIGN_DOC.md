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
│  • Dep checker   │    │  • Dep checker   │
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
| **server** | HTTP API, WebSocket hub, static file serving, state management |
| **daemon** | PTY spawning, worktree operations, dependency checks, connects to server |
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
| `AGENTHQ_SERVER_URL` | Yes | WebSocket URL to connect to (e.g. `ws://localhost:3000/ws/daemon`) |
| `AGENTHQ_ENV_ID` | No | Environment ID (auto-generated if not set) |
| `AGENTHQ_AUTH_TOKEN` | No | Auth token for remote daemon connections |

### Daemon CLI Flags

| Flag | Description |
|------|-------------|
| `--workspace` | Path to workspace folder (required for remote daemons) |

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

### Dependency Management

Daemon checks/installs dependencies deterministically on startup and before spawning agents.

**Core dependencies** (required):
- `git`
- `delta` (for diffs)

**Agent-specific dependencies**:
- `claude-code`: `claude` CLI
- `codex-cli`: `codex` CLI

**Install methods** (deterministic, not AI-based):
- macOS: `brew install <pkg>`
- Linux (Debian/Ubuntu): `apt-get install <pkg>`
- Linux (other): download from GitHub releases
- Fallback: download binary from GitHub releases

### Worktree Management

Worktrees are created explicitly by the user (not automatically per process):

```
git worktree add .agenthq-worktrees/<worktree-id> -b agent/<worktree-id>
```

Branch naming:
- Initial: `agent/<worktree-id>`
- Agent renames to meaningful name (e.g., `feature/add-dark-mode`)

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
[User: clicks "View Diff"]
        │
        ▼
[Daemon: runs "git diff main | delta" in worktree, streams to browser]
        │
        ▼
[User: clicks "Merge"]
        │
        ▼
[Server: git merge in main worktree]
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
| D→S | `pty-data` | `{ processId, data }` |
| D→S | `buffer-clear` | `{ processId }` |
| D→S | `process-started` | `{ processId }` |
| D→S | `process-exit` | `{ processId, exitCode }` |
| D→S | `branch-changed` | `{ worktreeId, branch }` |
| D→S | `worktree-ready` | `{ worktreeId, path, branch }` |
| D→S | `repos-list` | `{ repos: [{ name, path, defaultBranch }] }` |
| S→D | `create-worktree` | `{ worktreeId, repoName, repoPath }` |
| S→D | `spawn` | `{ processId, worktreeId, worktreePath, agent, args[], task?, cols?, rows?, yoloMode? }` |
| S→D | `pty-input` | `{ processId, data }` |
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
| S→B | `env-update` | `{ environments[] }` |
| S→B | `error` | `{ message }` |

## HTTP API

### Repos

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/repos?envId=` | List repos (optionally filtered by env) |
| POST | `/api/repos` | Clone repo `{ url }` (stub) |
| GET | `/api/repos/:name?envId=` | Repo details |
| DELETE | `/api/repos/:name` | Remove repo (stub) |

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
| DELETE | `/api/environments/:envId` | Delete environment (destroys VM for exe type) |
| POST | `/api/environments/:envId/provision` | Provision exe.dev environment (upload daemon, create workspace) |
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

Tasks are passed via the `task` field in the spawn message. For shell agents, the task is executed as a command. For coding agents, it's passed as the initial prompt.

## UI/UX

### Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Agent HQ                                            [+ Add Repo]        │
├─────────────────┬────────────────────────────────────────────────────────┤
│                 │  [claude ▼] [bash ▼] [codex ▼]             [+ New Tab] │
│  REPOS          ├────────────────────────────────────────────────────────┤
│                 │                                                        │
│  ▼ project-a    │  ┌────────────────────────────────────────────────────┐│
│    ├ main       │  │                                                    ││
│    ├ agent/abc  │◄─│  $ claude                                          ││
│    └ feat/dark  │  │  ╭────────────────────────────────────────────╮    ││
│    [+ Worktree] │  │  │ What would you like to do?                 │    ││
│                 │  │  ╰────────────────────────────────────────────╯    ││
│  ▼ project-b    │  │                                                    ││
│    └ main       │  │  > Add dark mode support to the settings page     ││
│                 │  │                                                    ││
│                 │  └────────────────────────────────────────────────────┘│
│                 │                                                        │
│  [Environments] │  [View Diff]  [Merge]  [Archive Worktree]              │
└─────────────────┴────────────────────────────────────────────────────────┘
```

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
- Selecting a worktree shows its processes as tabs in main area
- Visual indicators: process count badge, branch name

### Main Area

When a worktree is selected:

- **Tab bar**: Each tab is a process (agent or shell) in the selected worktree
- **[+ New Tab]**: Dropdown to spawn new process in current worktree:
  - **bash** — plain shell
  - **Claude Code** — opens spawn dialog, then starts `claude` CLI
  - **Codex CLI** — opens spawn dialog, then starts `codex` CLI
- **Terminal**: xterm.js rendering the selected process's PTY output
- **Action bar**: View Diff, Merge, Archive Worktree buttons

### Spawn Agent Dialog

When spawning a code agent (not bash), dialog prompts for:

| Field | Description |
|-------|-------------|
| **Model** | Dropdown of available models (e.g., `opus`, `sonnet`, `gpt-4o`) |
| **Initial Prompt** | Text area for the task/prompt to start the agent with |

### Interactions

| Action | Result |
|--------|--------|
| Click worktree in sidebar | Main area shows tabs (processes) for that worktree |
| Click tab | Switch to that process's terminal |
| Click "+ New Tab" → bash | Spawns shell in current worktree |
| Click "+ New Tab" → Agent | Opens spawn dialog, then starts agent in worktree |
| Click "+ New Worktree" | Creates worktree, selects it, shows empty tab bar |
| Click "View Diff" | Opens new tab running `git diff main \| delta` |
| Click "Merge" | Merges worktree branch into base branch |
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
| 8 | Diff/merge flow | Delta diff in terminal, local merge |
| 9 | Multi-environment | Daemon registration, environment selection |
| 10 | Polish | Reconnection, buffer persistence, compression |

## Monorepo Organization

### Why Monorepo

- **Shared types**: Protocol messages shared between server and web
- **Atomic changes**: Update server API and web client in one commit
- **Simplified dev**: One `pnpm dev` starts everything
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
    "dev": "concurrently \"pnpm --filter @agenthq/server dev\" \"pnpm --filter @agenthq/web dev\"",
    "build": "pnpm -r build",
    "build:daemon": "cd daemon && make build",
    "build:daemon:all": "cd daemon && make build-all",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  }
}
```

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
  | { type: 'pty-data'; processId: string; data: string }
  | { type: 'buffer-clear'; processId: string }
  | { type: 'process-started'; processId: string }
  | { type: 'process-exit'; processId: string; exitCode: number }
  | { type: 'worktree-ready'; worktreeId: string; path: string; branch: string }
  | { type: 'branch-changed'; worktreeId: string; branch: string }
  | { type: 'repos-list'; repos: Array<{ name: string; path: string; defaultBranch: string }> };

export type ServerToDaemonMessage =
  | { type: 'create-worktree'; worktreeId: string; repoName: string; repoPath: string }
  | { type: 'spawn'; processId: string; worktreeId: string; worktreePath: string; agent: AgentType; args: string[]; task?: string; cols?: number; rows?: number; yoloMode?: boolean }
  | { type: 'pty-input'; processId: string; data: string }
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

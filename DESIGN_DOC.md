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

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTHQ_WORKSPACE` | Yes | Path to workspace folder containing repos. Exit if not set. |
| `AGENTHQ_PORT` | No | Server port (default: 3000) |
| `AGENTHQ_SERVER_URL` | Yes (daemon) | URL daemon connects to |

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
| D→S | `register` | `{ envId, envName, capabilities: string[], repoPath }` |
| D→S | `heartbeat` | `{}` |
| D→S | `pty-data` | `{ processId, data: bytes (compressed) }` |
| D→S | `buffer-clear` | `{ processId }` |
| D→S | `process-exit` | `{ processId, exitCode }` |
| D→S | `branch-changed` | `{ worktreeId, branch }` |
| D→S | `worktree-ready` | `{ worktreeId, path, branch }` |
| S→D | `create-worktree` | `{ worktreeId, repoName }` |
| S→D | `spawn` | `{ processId, worktreeId, agent, args, task }` |
| S→D | `pty-input` | `{ processId, data }` |
| S→D | `resize` | `{ processId, cols, rows }` |
| S→D | `kill` | `{ processId }` |
| S→D | `remove-worktree` | `{ worktreeId }` |

### Browser ↔ Server (WebSocket)

| Direction | Type | Payload |
|-----------|------|---------|
| B→S | `attach` | `{ processId }` |
| B→S | `detach` | `{ processId }` |
| B→S | `input` | `{ processId, data }` |
| B→S | `resize` | `{ processId, cols, rows }` |
| S→B | `pty-data` | `{ processId, data }` |
| S→B | `process-update` | `{ process }` |
| S→B | `worktree-update` | `{ worktree }` |
| S→B | `env-update` | `{ environments }` |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/repos` | List repos in workspace |
| POST | `/api/repos` | Clone repo `{ url }` |
| DELETE | `/api/repos/:name` | Remove repo |
| GET | `/api/repos/:name` | Repo details + worktrees |
| POST | `/api/repos/:name/worktrees` | Create worktree `{ envId }` |
| GET | `/api/worktrees` | List all worktrees |
| GET | `/api/worktrees/:id` | Worktree details + processes |
| DELETE | `/api/worktrees/:id` | Archive worktree (kills processes, removes) |
| POST | `/api/worktrees/:id/diff` | Run diff command |
| POST | `/api/worktrees/:id/merge` | Merge into base branch |
| POST | `/api/worktrees/:id/processes` | Spawn process `{ agent, task, envId }` |
| GET | `/api/processes` | List all processes |
| GET | `/api/processes/:id` | Process details |
| DELETE | `/api/processes/:id` | Kill process |
| GET | `/api/environments` | List connected daemons |

## Supported Agents

| Agent | CLI Command | Status |
|-------|-------------|--------|
| Claude Code | `claude` | Initial support |
| Codex CLI | `codex` | Initial support |
| Kimi CLI | `kimi` | Initial support |

**TODO**: Figure out how to pass initial prompt/task to each agent CLI on startup. Options:
- CLI flags (if supported)
- Piping initial input
- Config file injection
- Wrapper script

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
interface Worktree {
  id: string;
  repoName: string;
  path: string;
  branch: string;
  isMain: boolean;
  createdAt: number;
}

interface Process {
  id: string;
  worktreeId: string;
  agent: AgentType;  // 'claude-code' | 'codex-cli' | 'bash'
  status: ProcessStatus;  // 'pending' | 'running' | 'stopped' | 'error'
  envId: string;
  createdAt: number;
  exitCode?: number;
}

// packages/shared/src/protocol.ts
export type DaemonMessage =
  | { type: 'register'; envId: string; capabilities: string[] }
  | { type: 'pty-data'; processId: string; data: string }
  | { type: 'process-exit'; processId: string; exitCode: number }
  | { type: 'worktree-ready'; worktreeId: string; path: string; branch: string }
  // ...

export type ServerMessage =
  | { type: 'create-worktree'; worktreeId: string; repoName: string }
  | { type: 'spawn'; processId: string; worktreeId: string; agent: string; args: string[] }
  | { type: 'pty-input'; processId: string; data: string }
  // ...

export type BrowserMessage = // ...
export type BrowserServerMessage = // ...
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
│   │   │   │   ├── repos.ts
│   │   │   │   ├── worktrees.ts
│   │   │   │   └── processes.ts
│   │   │   ├── ws/
│   │   │   │   ├── daemon-hub.ts
│   │   │   │   └── browser-hub.ts
│   │   │   └── state/
│   │   │       ├── worktree-store.ts
│   │   │       ├── process-store.ts
│   │   │       └── repo-store.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                # @agenthq/web
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── ui/     # shadcn components
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── TabBar.tsx
│   │   │   │   └── TerminalPanel.tsx
│   │   │   ├── hooks/
│   │   │   └── lib/
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── shared/             # @agenthq/shared
│       ├── src/
│       │   ├── protocol.ts
│       │   ├── constants.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── daemon/                 # Go binary (not npm)
│   ├── cmd/
│   │   └── agenthq-daemon/
│   │       └── main.go
│   ├── internal/
│   │   ├── pty/
│   │   ├── worktree/
│   │   ├── deps/
│   │   └── protocol/
│   ├── Makefile
│   └── go.mod
│
├── package.json            # Root scripts
├── pnpm-workspace.yaml
├── DESIGN_DOC.md
└── README.md
```

## Out of Scope (For Now)

- Multi-user / authentication
- Private repo cloning
- Remote push / PR creation
- Sprites.dev integration
- Windows daemon builds
- Preview URLs / port forwarding (architecture should support adding this later — daemon can expose worktree dev servers via tunneled ports)

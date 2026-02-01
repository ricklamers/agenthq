// Left sidebar with repo/worktree tree

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Folder, GitBranch, Plus, Server, Circle, RotateCcw } from 'lucide-react';
import type { Repo, Environment, Worktree, Process } from '@agenthq/shared';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface SidebarProps {
  connected: boolean;
  environments: Environment[];
  worktrees: Map<string, Worktree>;
  processes: Map<string, Process>;
  selectedWorktreeId: string | null;
  onSelectWorktree: (worktreeId: string) => void;
  onNewWorktree: (repoName: string, envId: string) => void;
}

export function Sidebar({
  connected,
  environments,
  worktrees,
  processes,
  selectedWorktreeId,
  onSelectWorktree,
  onNewWorktree,
}: SidebarProps) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/repos')
      .then((res) => res.json())
      .then((data) => {
        setRepos(data);
        // Expand all repos by default
        setExpandedRepos(new Set(data.map((r: Repo) => r.name)));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggleRepo = (name: string) => {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const getWorktreesForRepo = (repoName: string) => {
    return Array.from(worktrees.values()).filter((w) => w.repoName === repoName);
  };

  const getProcessCountForWorktree = (worktreeId: string) => {
    return Array.from(processes.values()).filter(
      (p) => p.worktreeId === worktreeId && (p.status === 'running' || p.status === 'pending')
    ).length;
  };

  const defaultEnvId = environments[0]?.id;

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Agent HQ</h1>
      </div>

      {/* Repos tree */}
      <div className="flex-1 overflow-auto p-2">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Repos</span>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <div className="px-2 text-sm text-muted-foreground">Loading...</div>
        ) : repos.length === 0 ? (
          <div className="px-2 text-sm text-muted-foreground">No repos found</div>
        ) : (
          <div className="space-y-1">
            {repos.map((repo) => {
              const isExpanded = expandedRepos.has(repo.name);
              const repoWorktrees = getWorktreesForRepo(repo.name);

              return (
                <div key={repo.name}>
                  {/* Repo header */}
                  <button
                    onClick={() => toggleRepo(repo.name)}
                    className="flex w-full items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate text-left">{repo.name}</span>
                  </button>

                  {/* Worktrees */}
                  {isExpanded && (
                    <div className="ml-4 space-y-0.5">
                      {/* Main worktree (always show even if not registered yet) */}
                      {(() => {
                        const mainWorktree = repoWorktrees.find((w) => w.isMain);
                        const mainWorktreeId = mainWorktree?.id ?? `main-${repo.name}`;
                        const processCount = mainWorktree ? getProcessCountForWorktree(mainWorktree.id) : 0;

                        return (
                          <button
                            key="main"
                            onClick={() => onSelectWorktree(mainWorktreeId)}
                            className={cn(
                              'flex w-full items-center gap-1 rounded px-2 py-1 text-sm',
                              selectedWorktreeId === mainWorktreeId ? 'bg-accent' : 'hover:bg-accent/50'
                            )}
                          >
                            <GitBranch className="h-3 w-3 text-muted-foreground" />
                            <span className="flex-1 truncate text-left">{repo.defaultBranch}</span>
                            {processCount > 0 && (
                              <span className="text-xs text-muted-foreground">{processCount}</span>
                            )}
                          </button>
                        );
                      })()}

                      {/* Other worktrees */}
                      {repoWorktrees
                        .filter((w) => !w.isMain)
                        .map((worktree) => {
                          const processCount = getProcessCountForWorktree(worktree.id);

                          return (
                            <button
                              key={worktree.id}
                              onClick={() => onSelectWorktree(worktree.id)}
                              className={cn(
                                'flex w-full items-center gap-1 rounded px-2 py-1 text-sm',
                                selectedWorktreeId === worktree.id ? 'bg-accent' : 'hover:bg-accent/50'
                              )}
                            >
                              <GitBranch className="h-3 w-3 text-muted-foreground" />
                              <span className="flex-1 truncate text-left">{worktree.branch}</span>
                              {processCount > 0 && (
                                <span className="text-xs text-muted-foreground">{processCount}</span>
                              )}
                            </button>
                          );
                        })}

                      {/* New worktree button */}
                      {defaultEnvId && (
                        <button
                          onClick={() => onNewWorktree(repo.name, defaultEnvId)}
                          className="flex w-full items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50"
                        >
                          <Plus className="h-3 w-3" />
                          <span>New worktree</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Environments section */}
      <div className="border-t border-border p-2">
        <div className="mb-2 flex items-center gap-2 px-2">
          <Circle
            className={cn(
              'h-2 w-2',
              connected ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
            )}
          />
          <span className="text-xs font-medium uppercase text-muted-foreground">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        {environments.length === 0 ? (
          <div className="px-2 text-sm text-muted-foreground">No daemons connected</div>
        ) : (
          <div className="space-y-1">
            {environments.map((env) => (
              <div
                key={env.id}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm group"
              >
                <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                <span className="flex-1 truncate">{env.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={async () => {
                    try {
                      await fetch(`/api/environments/${encodeURIComponent(env.id)}`, {
                        method: 'DELETE',
                      });
                    } catch (err) {
                      console.error('Failed to restart daemon:', err);
                    }
                  }}
                  title="Restart daemon"
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Left sidebar with repo/worktree tree

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Folder, GitBranch, Plus, Settings, Circle, RotateCcw, X } from 'lucide-react';
import type { Repo, Environment, Worktree, Process } from '@agenthq/shared';
import { Button } from './ui/button';
import { AddRepoDialog } from './AddRepoDialog';
import { cn } from '@/lib/utils';

interface SidebarProps {
  connected: boolean;
  environments: Environment[];
  worktrees: Map<string, Worktree>;
  processes: Map<string, Process>;
  selectedWorktreeId: string | null;
  selectedEnvId: string;
  onSelectWorktree: (worktreeId: string) => void;
  onNewWorktree: (repoName: string, envId: string) => void;
  onSelectEnv: (envId: string) => void;
  onOpenSettings: () => void;
  onClose?: () => void;
}

export function Sidebar({
  connected,
  environments,
  worktrees,
  processes,
  selectedWorktreeId,
  selectedEnvId,
  onSelectWorktree,
  onNewWorktree,
  onSelectEnv,
  onOpenSettings,
  onClose,
}: SidebarProps) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showAddRepoDialog, setShowAddRepoDialog] = useState(false);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    const url = selectedEnvId ? `/api/repos?envId=${encodeURIComponent(selectedEnvId)}` : '/api/repos';
    try {
      const res = await fetch(url);
      const data = await res.json();
      setRepos(data);
      // Expand all repos by default
      setExpandedRepos(new Set(data.map((r: Repo) => r.name)));
    } catch (err) {
      console.error('Failed to fetch repos:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedEnvId]);

  // Fetch repos for selected environment
  useEffect(() => {
    void fetchRepos();
  }, [fetchRepos]);

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
    return Array.from(worktrees.values()).filter(
      (w) => w.repoName === repoName && w.envId === selectedEnvId
    );
  };

  const getProcessCountForWorktree = (worktreeId: string) => {
    return Array.from(processes.values()).filter(
      (p) => p.worktreeId === worktreeId && (p.status === 'running' || p.status === 'pending')
    ).length;
  };

  const selectedEnv = environments.find((e) => e.id === selectedEnvId);
  const envConnected = selectedEnv?.status === 'connected';

  const handleAddRepo = () => {
    if (selectedEnvId !== 'local') {
      alert('Adding repos is currently supported for Local environment only.');
      return;
    }
    setShowAddRepoDialog(true);
  };

  const handleAddRepoSubmit = async (repoUrl: string) => {
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: repoUrl, envId: selectedEnvId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Unknown error');
      }

      setExpandedRepos((prev) => new Set([...prev, data.name]));
      await fetchRepos();
    } catch (err) {
      console.error('Failed to add repo:', err);
      if (err instanceof Error) {
        throw err;
      }
      throw new Error('Failed to add repo');
    }
  };

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      {/* Header with Environment Selector */}
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-semibold">Agent HQ</h1>
          <div className="flex items-center gap-1">
            {onClose && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close sidebar">
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOpenSettings} title="Settings">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* Environment Dropdown */}
        <div className="relative">
          <select
            value={selectedEnvId}
            onChange={(e) => onSelectEnv(e.target.value)}
            className="w-full appearance-none rounded-md border border-input bg-background px-3 py-1.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        
        {/* Connection status for selected env */}
        <div className="mt-2 flex items-center gap-2">
          <Circle
            className={cn(
              'h-2 w-2',
              envConnected ? 'fill-green-500 text-green-500' : 'fill-gray-500 text-gray-500'
            )}
          />
          <span className="text-xs text-muted-foreground">
            {envConnected ? 'Connected' : 'Disconnected'}
            {selectedEnv?.type === 'exe' && ' (exe.dev)'}
          </span>
        </div>
      </div>

      {/* Repos tree */}
      <div className="flex-1 overflow-auto p-2">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Repos</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleAddRepo}
            disabled={selectedEnvId !== 'local'}
            title={selectedEnvId === 'local' ? 'Add public GitHub repo' : 'Adding repos currently supports Local only'}
          >
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
                      {envConnected && (
                        <button
                          onClick={() => onNewWorktree(repo.name, selectedEnvId)}
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

      <AddRepoDialog
        open={showAddRepoDialog}
        onClose={() => setShowAddRepoDialog(false)}
        onSubmit={handleAddRepoSubmit}
      />

      {/* Environments summary */}
      <div className="border-t border-border p-2">
        <div className="mb-2 px-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Environments</span>
        </div>
        <div className="space-y-1">
          {environments.map((env) => (
            <div
              key={env.id}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1 text-sm group cursor-pointer",
                env.id === selectedEnvId && "bg-accent"
              )}
              onClick={() => onSelectEnv(env.id)}
            >
              <Circle
                className={cn(
                  'h-2 w-2',
                  env.status === 'connected' ? 'fill-green-500 text-green-500' : 'fill-gray-500 text-gray-500'
                )}
              />
              <span className="flex-1 truncate">{env.name}</span>
              {env.status === 'connected' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await fetch(`/api/environments/${encodeURIComponent(env.id)}/restart`, {
                        method: 'POST',
                      });
                    } catch (err) {
                      console.error('Failed to restart daemon:', err);
                    }
                  }}
                  title="Restart daemon"
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

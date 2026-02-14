// Main App component

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { AgentType, Repo } from '@agenthq/shared';
import { useWebSocket } from './hooks/useWebSocket';
import { Sidebar } from './components/Sidebar';
import { SplitTerminalContainer } from './components/SplitTerminalContainer';
import { SpawnDialog } from './components/SpawnDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SettingsPage } from './components/SettingsPage';
import { LoginPage } from './components/LoginPage';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable';
import { cn } from './lib/utils';

type ConfirmAction =
  | { type: 'kill-process'; processId: string }
  | { type: 'remove-process'; processId: string }
  | { type: 'archive-worktree' };

const SELECTED_ENV_STORAGE_KEY = 'agenthq:selectedEnvId';
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [authUsername, setAuthUsername] = useState<string | null>(null);
  const { connected, environments, worktrees, processes, send, onPtyData, onPtySize } = useWebSocket(authStatus === 'authenticated');
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [terminalSize, setTerminalSize] = useState<{ cols: number; rows: number } | null>(null);
  const [selectedEnvId, setSelectedEnvId] = useState<string>(() => {
    return localStorage.getItem(SELECTED_ENV_STORAGE_KEY) ?? 'local';
  });
  
  // Persist selected environment to localStorage
  useEffect(() => {
    localStorage.setItem(SELECTED_ENV_STORAGE_KEY, selectedEnvId);
  }, [selectedEnvId]);
  
  const [showSettings, setShowSettings] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [spawnDialog, setSpawnDialog] = useState<{ worktreeId: string; envId: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [autoSelectProcessId, setAutoSelectProcessId] = useState<string | null>(null);
  const [autoSelectedEnvIds, setAutoSelectedEnvIds] = useState<Set<string>>(new Set());

  const selectedWorktree = selectedWorktreeId ? worktrees.get(selectedWorktreeId) : null;

  useEffect(() => {
    let cancelled = false;

    const fetchSession = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (!response.ok) {
          throw new Error('auth-check-failed');
        }

        const payload = (await response.json()) as {
          authenticated?: boolean;
          user?: { username?: string };
        };

        if (cancelled) return;
        if (payload.authenticated && payload.user?.username) {
          setAuthUsername(payload.user.username);
          setAuthStatus('authenticated');
          return;
        }

        setAuthUsername(null);
        setAuthStatus('unauthenticated');
      } catch {
        if (!cancelled) {
          setAuthUsername(null);
          setAuthStatus('unauthenticated');
        }
      }
    };

    void fetchSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthenticated = useCallback((username: string) => {
    setAuthUsername(username);
    setAuthStatus('authenticated');
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Failed to logout:', err);
    } finally {
      setAuthUsername(null);
      setAuthStatus('unauthenticated');
      setShowSettings(false);
      setSelectedWorktreeId(null);
    }
  }, []);

  // Get processes for the selected worktree
  const worktreeProcesses = useMemo(() => {
    if (!selectedWorktreeId) return [];
    return Array.from(processes.values()).filter((p) => p.worktreeId === selectedWorktreeId);
  }, [processes, selectedWorktreeId]);

  const getMeasuredTerminalSize = useCallback(() => {
    if (!terminalSize || terminalSize.cols <= 0 || terminalSize.rows <= 0) {
      alert('Terminal size is still initializing. Please wait a moment and try again.');
      return null;
    }
    return terminalSize;
  }, [terminalSize]);

  // Select worktree and open new tab dialog if no tabs exist
  const handleSelectWorktree = useCallback((worktreeId: string) => {
    const isNewSelection = worktreeId !== selectedWorktreeId;
    setSelectedWorktreeId(worktreeId);

    // Auto-open spawn dialog when selecting a worktree with no existing tabs
    if (isNewSelection) {
      const hasExistingProcesses = Array.from(processes.values()).some(p => p.worktreeId === worktreeId);
      if (!hasExistingProcesses) {
        const worktree = worktrees.get(worktreeId);
        const envId = worktree?.envId ?? environments[0]?.id;
        if (envId) {
          setSpawnDialog({ worktreeId, envId });
        }
      }
    }
  }, [selectedWorktreeId, worktrees, environments, processes]);

  // Default-select first repo's main/master worktree on first load per environment
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    if (selectedWorktreeId) return;
    if (autoSelectedEnvIds.has(selectedEnvId)) return;

    let cancelled = false;

    const tryAutoSelect = async () => {
      try {
        const res = await fetch(`/api/repos?envId=${encodeURIComponent(selectedEnvId)}`);
        if (!res.ok) return;
        const repos = (await res.json()) as Repo[];
        if (!Array.isArray(repos) || repos.length === 0) {
          return;
        }

        const preferredRepo = repos[0];
        if (!preferredRepo) {
          return;
        }

        const mainWorktreeId =
          selectedEnvId === 'local'
            ? `main-${preferredRepo.name}`
            : `main-${selectedEnvId}-${preferredRepo.name}`;

        if (cancelled) return;
        setSelectedWorktreeId((prev) => prev ?? mainWorktreeId);
      } catch (err) {
        console.error('Failed to auto-select default repo:', err);
      } finally {
        if (!cancelled) {
          setAutoSelectedEnvIds((prev) => new Set([...prev, selectedEnvId]));
        }
      }
    };

    void tryAutoSelect();
    return () => {
      cancelled = true;
    };
  }, [authStatus, selectedWorktreeId, autoSelectedEnvIds, selectedEnvId]);

  // Track worktree IDs that are pending (waiting for path to be set by daemon)
  const [pendingWorktreeId, setPendingWorktreeId] = useState<string | null>(null);

  // Watch for pending worktree to become ready (path set)
  useEffect(() => {
    if (!pendingWorktreeId) return;
    
    const worktree = worktrees.get(pendingWorktreeId);
    if (worktree?.path) {
      // Worktree is ready, open spawn dialog
      setPendingWorktreeId(null);
      setSpawnDialog({ worktreeId: pendingWorktreeId, envId: worktree.envId ?? 'local' });
    }
  }, [pendingWorktreeId, worktrees]);

  const handleNewWorktree = async (repoName: string, envId: string) => {
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoName)}/worktrees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envId }),
      });

      if (res.ok) {
        const worktree = await res.json();
        setSelectedWorktreeId(worktree.id);
        // Mark as pending - spawn dialog will open when path is set
        setPendingWorktreeId(worktree.id);
      } else {
        const error = await res.json();
        console.error('Failed to create worktree:', error);
        alert(`Failed to create worktree: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to create worktree:', err);
      alert('Failed to create worktree');
    }
  };

  const handleNewProcess = () => {
    if (!selectedWorktreeId || !selectedWorktree) return;
    const envId = selectedWorktree.envId ?? environments[0]?.id;
    if (!envId) {
      alert('No environment available');
      return;
    }
    setSpawnDialog({ worktreeId: selectedWorktreeId, envId });
  };

  const handleSpawn = async (agent: AgentType, task?: string, yoloMode?: boolean) => {
    if (!spawnDialog) return;

    const measuredSize = getMeasuredTerminalSize();
    if (!measuredSize) return;

    try {
      const res = await fetch(`/api/worktrees/${spawnDialog.worktreeId}/processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          task,
          envId: spawnDialog.envId,
          cols: measuredSize.cols,
          rows: measuredSize.rows,
          yoloMode: yoloMode || false,
        }),
      });

      if (res.ok) {
        const newProcess = await res.json();
        setAutoSelectProcessId(newProcess.id);
        setSpawnDialog(null);
      } else {
        const error = await res.json();
        console.error('Failed to spawn process:', error);
        alert(`Failed to spawn process: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to spawn process:', err);
      alert('Failed to spawn process');
    }
  };

  const handleInput = useCallback(
    (processId: string, data: string) => {
      send({ type: 'input', processId, data });
    },
    [send]
  );

  const handleResize = useCallback(
    (processId: string, cols: number, rows: number) => {
      send({ type: 'resize', processId, cols, rows });
    },
    [send]
  );

  const handleKillProcess = useCallback((processId: string) => {
    const process = processes.get(processId);
    if (!process) return;

    const isAlive = process.status === 'running' || process.status === 'pending';

    if (isAlive) {
      // First click: confirm and kill the process
      setConfirmAction({ type: 'kill-process', processId });
    } else {
      // Second click: confirm and remove the tab
      setConfirmAction({ type: 'remove-process', processId });
    }
  }, [processes]);

  const handleArchiveWorktree = () => {
    if (!selectedWorktreeId) return;
    setConfirmAction({ type: 'archive-worktree' });
  };

  const handleViewDiff = async (): Promise<string | null> => {
    if (!selectedWorktreeId) return null;
    const measuredSize = getMeasuredTerminalSize();
    if (!measuredSize) return null;

    try {
      const res = await fetch(`/api/worktrees/${selectedWorktreeId}/diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cols: measuredSize.cols,
          rows: measuredSize.rows,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        console.error('Failed to view diff:', error);
        alert(`Failed to view diff: ${error.error}`);
        return null;
      }
      const data = await res.json();
      return data.processId ?? null;
    } catch (err) {
      console.error('Failed to view diff:', err);
      alert('Failed to view diff');
      return null;
    }
  };

  const handleMerge = async (): Promise<string | null> => {
    if (!selectedWorktreeId) return null;
    const measuredSize = getMeasuredTerminalSize();
    if (!measuredSize) return null;

    try {
      const res = await fetch(`/api/worktrees/${selectedWorktreeId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cols: measuredSize.cols,
          rows: measuredSize.rows,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        console.error('Failed to merge:', error);
        alert(`Failed to merge: ${error.error}`);
        return null;
      }
      const data = await res.json();
      return data.processId ?? null;
    } catch (err) {
      console.error('Failed to merge:', err);
      alert('Failed to merge');
      return null;
    }
  };

  const handleMergeWithAgent = async (agent: AgentType): Promise<string | null> => {
    if (!selectedWorktreeId) return null;
    const measuredSize = getMeasuredTerminalSize();
    if (!measuredSize) return null;

    try {
      const res = await fetch(`/api/worktrees/${selectedWorktreeId}/merge-with-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          cols: measuredSize.cols,
          rows: measuredSize.rows,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        console.error('Failed to start agent merge:', error);
        alert(`Failed to start agent merge: ${error.error}`);
        return null;
      }
      const data = await res.json();
      return data.processId ?? null;
    } catch (err) {
      console.error('Failed to start agent merge:', err);
      alert('Failed to start agent merge');
      return null;
    }
  };

  // Primary action: Kill + Remove (for kill-process dialog)
  const handleConfirmAction = async () => {
    if (!confirmAction) return;

    switch (confirmAction.type) {
      case 'kill-process': {
        // Primary action: Kill AND remove tab
        try {
          await fetch(`/api/processes/${confirmAction.processId}?remove=true`, { method: 'DELETE' });
        } catch (err) {
          console.error('Failed to kill and remove process:', err);
        }
        break;
      }
      case 'remove-process': {
        try {
          await fetch(`/api/processes/${confirmAction.processId}?remove=true`, { method: 'DELETE' });
        } catch (err) {
          console.error('Failed to remove process:', err);
        }
        break;
      }
      case 'archive-worktree': {
        try {
          await fetch(`/api/worktrees/${selectedWorktreeId}`, { method: 'DELETE' });
          setSelectedWorktreeId(null);
        } catch (err) {
          console.error('Failed to archive worktree:', err);
        }
        break;
      }
    }

    setConfirmAction(null);
  };

  // Secondary action: Kill only (keep tab)
  const handleSecondaryAction = async () => {
    if (!confirmAction) return;

    if (confirmAction.type === 'kill-process') {
      try {
        await fetch(`/api/processes/${confirmAction.processId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to kill process:', err);
      }
    }

    setConfirmAction(null);
  };

  const getConfirmDialogProps = () => {
    if (!confirmAction) return null;

    switch (confirmAction.type) {
      case 'kill-process':
        return {
          title: 'Kill Process',
          description: 'Are you sure you want to kill this process?',
          confirmLabel: 'Kill + Remove',
          secondaryLabel: 'Kill',
          variant: 'destructive' as const,
          icon: 'stop' as const,
        };
      case 'remove-process':
        return {
          title: 'Remove Process Tab',
          description: 'Remove this process tab from the worktree?',
          confirmLabel: 'Remove',
          variant: 'destructive' as const,
          icon: 'trash' as const,
        };
      case 'archive-worktree':
        return {
          title: 'Archive Worktree',
          description: 'Archive this worktree? All processes will be killed.',
          confirmLabel: 'Archive',
          variant: 'destructive' as const,
          icon: 'archive' as const,
        };
    }
  };

  const closeMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(false);
  }, []);

  const handleTerminalSizeChange = useCallback((cols: number, rows: number) => {
    // Reject zero/negative AND transiently small sizes that occur during
    // initial layout (e.g. before resizable panels have computed their widths).
    // A terminal narrower than 20 cols is unusable and almost certainly a
    // measurement taken before CSS layout has settled.
    if (cols < 20 || rows < 5) return;
    setTerminalSize((prev) => {
      if (prev && prev.cols === cols && prev.rows === rows) {
        return prev;
      }
      return { cols, rows };
    });
  }, []);

  const handleSelectWorktreeFromSidebar = useCallback((worktreeId: string) => {
    handleSelectWorktree(worktreeId);
    setIsMobileSidebarOpen(false);
  }, [handleSelectWorktree]);

  const handleNewWorktreeFromSidebar = useCallback((repoName: string, envId: string) => {
    void handleNewWorktree(repoName, envId);
    setIsMobileSidebarOpen(false);
  }, [handleNewWorktree]);

  const handleSelectEnvFromSidebar = useCallback((envId: string) => {
    setSelectedEnvId(envId);
    setIsMobileSidebarOpen(false);
  }, []);

  const handleOpenSettingsFromSidebar = useCallback(() => {
    setShowSettings(true);
    setIsMobileSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMobileSidebarOpen]);

  const terminalContent = (
    <SplitTerminalContainer
      worktree={selectedWorktree ?? null}
      processes={worktreeProcesses}
      autoSelectProcessId={autoSelectProcessId}
      onAutoSelectComplete={() => setAutoSelectProcessId(null)}
      onInput={handleInput}
      onResize={handleResize}
      onPtyData={onPtyData}
      onPtySize={onPtySize}
      onNewProcess={handleNewProcess}
      onKillProcess={handleKillProcess}
      onArchiveWorktree={handleArchiveWorktree}
      onViewDiff={handleViewDiff}
      onMerge={handleMerge}
      onMergeWithAgent={handleMergeWithAgent}
      onTerminalSizeChange={handleTerminalSizeChange}
      onOpenSidebar={() => setIsMobileSidebarOpen(true)}
    />
  );

  // Show settings page
  if (authStatus === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground [height:100svh]">
        Checking session...
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return <LoginPage onAuthenticated={handleAuthenticated} />;
  }

  // Show settings page
  if (showSettings) {
    return (
      <SettingsPage
        onBack={() => setShowSettings(false)}
        environments={environments}
        username={authUsername ?? undefined}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden [height:100svh] [max-height:100svh]">
      <div className="hidden h-full min-h-0 overflow-hidden md:block">
        <ResizablePanelGroup orientation="horizontal">
          {/* Sidebar */}
          <ResizablePanel defaultSize="256px" minSize="200px" maxSize="500px">
            <Sidebar
              connected={connected}
              environments={environments}
              worktrees={worktrees}
              processes={processes}
              selectedWorktreeId={selectedWorktreeId}
              selectedEnvId={selectedEnvId}
              onSelectWorktree={handleSelectWorktree}
              onNewWorktree={handleNewWorktree}
              onSelectEnv={setSelectedEnvId}
              onOpenSettings={() => setShowSettings(true)}
            />
          </ResizablePanel>

          <ResizableHandle />

          {/* Main content */}
          <ResizablePanel minSize="50%">
            {terminalContent}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="relative flex h-full min-h-0 flex-col overflow-hidden md:hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          {terminalContent}
        </div>

        <button
          type="button"
          aria-label="Close sidebar backdrop"
          onClick={closeMobileSidebar}
          className={cn(
            'absolute inset-0 z-40 bg-black/35 transition-opacity',
            isMobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        />

        <aside
          className={cn(
            'absolute inset-y-0 left-0 z-50 w-[88vw] max-w-sm border-r border-border bg-card shadow-xl transition-transform duration-200 ease-out',
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <Sidebar
            connected={connected}
            environments={environments}
            worktrees={worktrees}
            processes={processes}
            selectedWorktreeId={selectedWorktreeId}
            selectedEnvId={selectedEnvId}
            onSelectWorktree={handleSelectWorktreeFromSidebar}
            onNewWorktree={handleNewWorktreeFromSidebar}
            onSelectEnv={handleSelectEnvFromSidebar}
            onOpenSettings={handleOpenSettingsFromSidebar}
            onClose={closeMobileSidebar}
          />
        </aside>
      </div>

      {/* Spawn dialog */}
      {spawnDialog && (
        <SpawnDialog
          open={true}
          worktreeId={spawnDialog.worktreeId}
          onClose={() => setSpawnDialog(null)}
          onSpawn={handleSpawn}
        />
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <ConfirmDialog
          open={true}
          onConfirm={handleConfirmAction}
          onSecondary={handleSecondaryAction}
          onCancel={() => setConfirmAction(null)}
          {...getConfirmDialogProps()!}
        />
      )}
    </div>
  );
}

// Main App component

import { useState, useCallback, useMemo } from 'react';
import type { AgentType } from '@agenthq/shared';
import { useWebSocket } from './hooks/useWebSocket';
import { Sidebar } from './components/Sidebar';
import { SplitTerminalContainer, createDefaultPaneState, type PaneLayoutState } from './components/SplitTerminalContainer';
import { SpawnDialog } from './components/SpawnDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable';

type ConfirmAction =
  | { type: 'kill-process'; processId: string }
  | { type: 'remove-process'; processId: string }
  | { type: 'archive-worktree' };

export function App() {
  const { connected, environments, worktrees, processes, send, onPtyData } = useWebSocket();
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [spawnDialog, setSpawnDialog] = useState<{ worktreeId: string; envId: string; cols?: number; rows?: number } | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  
  // Per-worktree pane layout state
  const [paneStates, setPaneStates] = useState<Map<string, PaneLayoutState>>(new Map());

  const selectedWorktree = selectedWorktreeId ? worktrees.get(selectedWorktreeId) : null;
  
  // Get or create pane state for current worktree
  const currentPaneState = selectedWorktreeId ? paneStates.get(selectedWorktreeId) ?? null : null;
  
  const handlePaneStateChange = useCallback((state: PaneLayoutState) => {
    if (!selectedWorktreeId) return;
    setPaneStates(prev => {
      const next = new Map(prev);
      next.set(selectedWorktreeId, state);
      return next;
    });
  }, [selectedWorktreeId]);

  // Get processes for the selected worktree
  const worktreeProcesses = useMemo(() => {
    if (!selectedWorktreeId) return [];
    return Array.from(processes.values()).filter((p) => p.worktreeId === selectedWorktreeId);
  }, [processes, selectedWorktreeId]);

  // Select worktree and open new tab dialog if no tabs exist
  const handleSelectWorktree = useCallback((worktreeId: string) => {
    const isNewSelection = worktreeId !== selectedWorktreeId;
    setSelectedWorktreeId(worktreeId);

    // Initialize pane state if it doesn't exist for this worktree
    if (!paneStates.has(worktreeId)) {
      setPaneStates(prev => {
        const next = new Map(prev);
        next.set(worktreeId, createDefaultPaneState());
        return next;
      });
    }

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
  }, [selectedWorktreeId, worktrees, environments, processes, paneStates]);

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
        // Initialize pane state for the new worktree
        setPaneStates(prev => {
          const next = new Map(prev);
          next.set(worktree.id, createDefaultPaneState());
          return next;
        });
        // Auto-open spawn dialog for the new worktree
        setSpawnDialog({ worktreeId: worktree.id, envId });
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

    // Use provided dimensions or defaults
    const cols = spawnDialog.cols ?? 80;
    const rows = spawnDialog.rows ?? 24;

    try {
      const res = await fetch(`/api/worktrees/${spawnDialog.worktreeId}/processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          task,
          envId: spawnDialog.envId,
          cols,
          rows,
          yoloMode: yoloMode || false,
        }),
      });

      if (res.ok) {
        // Process will be added via WebSocket state
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
    try {
      const res = await fetch(`/api/worktrees/${selectedWorktreeId}/diff`, { method: 'POST' });
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
    try {
      const res = await fetch(`/api/worktrees/${selectedWorktreeId}/merge`, { method: 'POST' });
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

  const handleMergeWithAgent = async (): Promise<string | null> => {
    if (!selectedWorktreeId) return null;
    try {
      const res = await fetch(`/api/worktrees/${selectedWorktreeId}/merge-with-agent`, { method: 'POST' });
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

  const handleConfirmAction = async () => {
    if (!confirmAction) return;

    switch (confirmAction.type) {
      case 'kill-process': {
        try {
          await fetch(`/api/processes/${confirmAction.processId}`, { method: 'DELETE' });
        } catch (err) {
          console.error('Failed to kill process:', err);
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

  const getConfirmDialogProps = () => {
    if (!confirmAction) return null;

    switch (confirmAction.type) {
      case 'kill-process':
        return {
          title: 'Kill Process',
          description: 'Are you sure you want to kill this process?',
          confirmLabel: 'Kill',
          variant: 'destructive' as const,
        };
      case 'remove-process':
        return {
          title: 'Remove Process Tab',
          description: 'Remove this process tab from the worktree?',
          confirmLabel: 'Remove',
          variant: 'destructive' as const,
        };
      case 'archive-worktree':
        return {
          title: 'Archive Worktree',
          description: 'Archive this worktree? All processes will be killed.',
          confirmLabel: 'Archive',
          variant: 'destructive' as const,
        };
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        {/* Sidebar */}
        <ResizablePanel defaultSize="256px" minSize="200px" maxSize="500px">
          <Sidebar
            connected={connected}
            environments={environments}
            worktrees={worktrees}
            processes={processes}
            selectedWorktreeId={selectedWorktreeId}
            onSelectWorktree={handleSelectWorktree}
            onNewWorktree={handleNewWorktree}
          />
        </ResizablePanel>

        <ResizableHandle />

        {/* Main content */}
        <ResizablePanel minSize="50%">
          <SplitTerminalContainer
            worktree={selectedWorktree ?? null}
            processes={worktreeProcesses}
            paneState={currentPaneState}
            onPaneStateChange={handlePaneStateChange}
            onInput={handleInput}
            onResize={handleResize}
            onPtyData={onPtyData}
            onNewProcess={handleNewProcess}
            onKillProcess={handleKillProcess}
            onArchiveWorktree={handleArchiveWorktree}
            onViewDiff={handleViewDiff}
            onMerge={handleMerge}
            onMergeWithAgent={handleMergeWithAgent}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

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
          onCancel={() => setConfirmAction(null)}
          {...getConfirmDialogProps()!}
        />
      )}
    </div>
  );
}

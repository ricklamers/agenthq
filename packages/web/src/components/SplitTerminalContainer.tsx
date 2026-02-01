// Split terminal container with VS Code-style pane arrangement

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Process, Worktree, AgentType } from '@agenthq/shared';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable';
import { TerminalPane, type TerminalPaneHandle } from './TerminalPane';
import { Button } from './ui/button';
import { Plus, X, Circle, SplitSquareHorizontal, SplitSquareVertical, GitCompare, GitMerge, Archive, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

// Agent options for merge (only agents that support yolo mode / actually do coding)
const MERGE_AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex-cli', label: 'Codex CLI' },
  { value: 'cursor-agent', label: 'Cursor Agent' },
  { value: 'droid-cli', label: 'Droid CLI' },
  { value: 'kimi-cli', label: 'Kimi CLI' },
];

// Types for the pane layout tree
export type PaneNode =
  | { type: 'terminal'; id: string; processId: string | null }
  | { type: 'split'; id: string; direction: 'horizontal' | 'vertical'; children: [PaneNode, PaneNode]; sizes: [number, number] };

// Pane layout state that can be stored per-worktree
export interface PaneLayoutState {
  layout: PaneNode;
  focusedPaneId: string;
  processAssignments: Map<string, string>; // processId -> paneId
}

interface SplitTerminalContainerProps {
  worktree: Worktree | null;
  processes: Process[];
  paneState: PaneLayoutState | null;
  onPaneStateChange: (state: PaneLayoutState) => void;
  onInput: (processId: string, data: string) => void;
  onResize: (processId: string, cols: number, rows: number) => void;
  onPtyData: (processId: string, handler: (data: string) => void) => () => void;
  onNewProcess: () => void;
  onKillProcess: (processId: string) => void;
  onArchiveWorktree: () => void;
  onViewDiff: () => Promise<string | null>;
  onMerge: () => Promise<string | null>;
  onMergeWithAgent: (agent: AgentType) => Promise<string | null>;
}

export interface SplitTerminalContainerHandle {
  getDimensions: () => { cols: number; rows: number } | null;
}

// Generate unique IDs for panes
let paneIdCounter = 0;
const generatePaneId = () => `pane-${++paneIdCounter}`;

// Helper to create default pane state
export function createDefaultPaneState(): PaneLayoutState {
  const paneId = generatePaneId();
  return {
    layout: { type: 'terminal', id: paneId, processId: null },
    focusedPaneId: paneId,
    processAssignments: new Map(),
  };
}

export function SplitTerminalContainer({
  worktree,
  processes,
  paneState,
  onPaneStateChange,
  onInput,
  onResize,
  onPtyData,
  onNewProcess,
  onKillProcess,
  onArchiveWorktree,
  onViewDiff,
  onMerge,
  onMergeWithAgent,
}: SplitTerminalContainerProps) {
  // Use provided state or create default
  const currentState = paneState ?? createDefaultPaneState();
  const { layout, focusedPaneId, processAssignments } = currentState;

  // Helper to update state
  const updateState = useCallback((updates: Partial<PaneLayoutState>) => {
    onPaneStateChange({
      ...currentState,
      ...updates,
    });
  }, [currentState, onPaneStateChange]);

  const setLayout = useCallback((updater: PaneNode | ((prev: PaneNode) => PaneNode)) => {
    const newLayout = typeof updater === 'function' ? updater(layout) : updater;
    updateState({ layout: newLayout });
  }, [layout, updateState]);

  const setFocusedPaneId = useCallback((paneId: string) => {
    updateState({ focusedPaneId: paneId });
  }, [updateState]);

  const setProcessAssignments = useCallback((updater: Map<string, string> | ((prev: Map<string, string>) => Map<string, string>)) => {
    const newAssignments = typeof updater === 'function' ? updater(processAssignments) : updater;
    updateState({ processAssignments: newAssignments });
  }, [processAssignments, updateState]);
  
  // Drag state
  const [draggedProcessId, setDraggedProcessId] = useState<string | null>(null);
  
  // Pending process to auto-select when it arrives via WebSocket
  const [pendingSelectProcessId, setPendingSelectProcessId] = useState<string | null>(null);
  
  // Track layout changes to trigger resize
  const [layoutVersion, setLayoutVersion] = useState(0);
  
  // Agent merge dialog state
  const [showAgentMergeDialog, setShowAgentMergeDialog] = useState(false);
  
  // Refs for terminal panes
  const paneRefs = useRef<Map<string, TerminalPaneHandle>>(new Map());
  
  // Track previous process IDs to detect newly created processes
  const prevProcessIdsRef = useRef<Set<string>>(new Set());

  // Fit all terminal panes after layout changes
  const fitAllPanes = useCallback(() => {
    // Small delay to let the DOM update
    setTimeout(() => {
      paneRefs.current.forEach((handle) => {
        handle.fit();
      });
    }, 50);
  }, []);

  // Count terminal panes in layout (moved up for use in useEffect)
  const countPanes = useCallback((node: PaneNode): number => {
    if (node.type === 'terminal') return 1;
    return countPanes(node.children[0]) + countPanes(node.children[1]);
  }, []);

  const paneCount = countPanes(layout);

  // Close a pane (remove from split) - moved up for use in Ctrl+W handler
  const closePane = useCallback((paneId: string) => {
    const removePane = (node: PaneNode): PaneNode | null => {
      if (node.type === 'terminal') {
        return node.id === paneId ? null : node;
      }
      
      const [left, right] = node.children;
      
      // Check if one of the children is the pane to remove
      if (left.type === 'terminal' && left.id === paneId) {
        return right;
      }
      if (right.type === 'terminal' && right.id === paneId) {
        return left;
      }
      
      // Recursively process children
      const newLeft = removePane(left);
      const newRight = removePane(right);
      
      if (newLeft === null) return newRight;
      if (newRight === null) return newLeft;
      
      return { ...node, children: [newLeft, newRight] };
    };
    
    const newLayout = removePane(layout) ?? { type: 'terminal', id: generatePaneId(), processId: null };
    
    // Clear any process assignments for this pane
    const newAssignments = new Map(processAssignments);
    for (const [processId, assignedPane] of processAssignments) {
      if (assignedPane === paneId) {
        newAssignments.delete(processId);
      }
    }
    
    // Update layout and assignments in a single state update
    updateState({
      layout: newLayout,
      processAssignments: newAssignments,
    });
    
    setLayoutVersion(v => v + 1);
  }, [layout, processAssignments, updateState]);

  // Keyboard shortcut: Ctrl+W to close current tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        
        // Get process in focused pane
        for (const [processId, assignedPaneId] of processAssignments) {
          if (assignedPaneId === focusedPaneId) {
            const process = processes.find(p => p.id === processId);
            if (process) {
              onKillProcess(processId);
            }
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedPaneId, processAssignments, processes, onKillProcess]);

  // Trigger fit when layout changes
  useEffect(() => {
    if (layoutVersion > 0) {
      fitAllPanes();
    }
  }, [layoutVersion, fitAllPanes]);

  // Get the process shown in a specific pane
  const getProcessForPane = useCallback((paneId: string): Process | null => {
    // Find process assigned to this pane
    for (const [processId, assignedPaneId] of processAssignments) {
      if (assignedPaneId === paneId) {
        return processes.find(p => p.id === processId) ?? null;
      }
    }
    return null;
  }, [processAssignments, processes]);

  // Auto-assign newly created processes to focused pane
  // Only triggers for processes that didn't exist before (not just unassigned)
  useEffect(() => {
    // Don't auto-assign while dragging - let the drag complete first
    if (draggedProcessId) return;
    
    const currentProcessIds = new Set(processes.map(p => p.id));
    const prevProcessIds = prevProcessIdsRef.current;
    
    // Find truly new processes (just created, not previously existing)
    const newProcesses = processes.filter(p => 
      !prevProcessIds.has(p.id) && !processAssignments.has(p.id)
    );
    
    // Update the ref for next time
    prevProcessIdsRef.current = currentProcessIds;
    
    // Auto-assign the first new process to the focused pane
    const newProcess = newProcesses[0];
    if (newProcess) {
      setProcessAssignments(prev => {
        // Double-check the process isn't already assigned (might have changed)
        if (prev.has(newProcess.id)) return prev;
        
        const next = new Map(prev);
        // Remove any existing process from the focused pane
        for (const [pid, assignedPane] of next) {
          if (assignedPane === focusedPaneId) {
            next.delete(pid);
          }
        }
        next.set(newProcess.id, focusedPaneId);
        return next;
      });
    }
  }, [processes, focusedPaneId, draggedProcessId, processAssignments, setProcessAssignments]);

  // Assign process to pane
  const assignProcessToPane = useCallback((processId: string, paneId: string) => {
    setProcessAssignments(prev => {
      const next = new Map(prev);
      // Remove from any existing assignment
      next.delete(processId);
      // Also remove any existing process from target pane
      for (const [pid, assignedPane] of next) {
        if (assignedPane === paneId && pid !== processId) {
          next.delete(pid);
        }
      }
      // Assign to new pane
      next.set(processId, paneId);
      return next;
    });
  }, [setProcessAssignments]);

  // Auto-select pending process when it arrives via WebSocket
  useEffect(() => {
    if (!pendingSelectProcessId) return;
    
    const pendingProcess = processes.find(p => p.id === pendingSelectProcessId);
    if (pendingProcess) {
      // Process arrived - assign to focused pane
      assignProcessToPane(pendingSelectProcessId, focusedPaneId);
      setPendingSelectProcessId(null);
    }
  }, [pendingSelectProcessId, processes, focusedPaneId, assignProcessToPane]);

  // Split a pane
  const splitPane = useCallback((paneId: string, direction: 'horizontal' | 'vertical') => {
    const newPaneId = generatePaneId();
    
    const splitNode = (node: PaneNode): PaneNode => {
      if (node.type === 'terminal' && node.id === paneId) {
        return {
          type: 'split',
          id: generatePaneId(),
          direction,
          children: [
            node,
            { type: 'terminal', id: newPaneId, processId: null },
          ],
          sizes: [50, 50],
        };
      }
      if (node.type === 'split') {
        return {
          ...node,
          children: [splitNode(node.children[0]), splitNode(node.children[1])],
        };
      }
      return node;
    };
    
    const newLayout = splitNode(layout);
    
    // Update both layout and focusedPaneId in a single state update
    // to avoid race condition where second update overwrites first
    updateState({
      layout: newLayout,
      focusedPaneId: newPaneId,
    });
    
    setLayoutVersion(v => v + 1);
  }, [layout, updateState]);

  // Handle drop on pane
  const handleDrop = useCallback((paneId: string) => {
    if (draggedProcessId) {
      // Focus the target pane
      setFocusedPaneId(paneId);
      // Assign the process to the target pane
      assignProcessToPane(draggedProcessId, paneId);
      // Clear drag state after a small delay to prevent auto-assign race
      setTimeout(() => {
        setDraggedProcessId(null);
      }, 50);
    }
  }, [draggedProcessId, assignProcessToPane, setFocusedPaneId]);

  // Render a pane node recursively
  const renderPaneNode = (node: PaneNode): React.ReactNode => {
    if (node.type === 'terminal') {
      const process = getProcessForPane(node.id);
      const isFocused = focusedPaneId === node.id;
      
      return (
        <div 
          key={node.id}
          className={cn(
            "relative h-full flex flex-col",
            isFocused && paneCount > 1 && "ring-1 ring-primary/50"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(node.id);
          }}
        >
          {/* Pane header with process info and split buttons */}
          <div className="flex items-center justify-between border-b border-border bg-card/50 px-2 py-1 text-xs">
            <div className="flex items-center gap-1.5">
              {process ? (
                <>
                  <Circle
                    className={cn(
                      'h-2 w-2',
                      process.status === 'running'
                        ? 'fill-green-500 text-green-500'
                        : process.status === 'pending'
                          ? 'fill-yellow-500 text-yellow-500'
                          : 'fill-muted-foreground text-muted-foreground'
                    )}
                  />
                  <span className="text-muted-foreground">{process.agent}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Empty</span>
              )}
            </div>
            
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => splitPane(node.id, 'horizontal')}
                title="Split Right"
              >
                <SplitSquareHorizontal className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => splitPane(node.id, 'vertical')}
                title="Split Down"
              >
                <SplitSquareVertical className="h-3 w-3" />
              </Button>
              {paneCount > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => closePane(node.id)}
                  title="Close Pane"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          
          {/* Terminal - stable key to preserve terminal instance across process changes */}
          <div className="flex-1 overflow-hidden">
            <TerminalPane
              key={node.id}
              ref={(handle) => {
                if (handle) {
                  paneRefs.current.set(node.id, handle);
                } else {
                  paneRefs.current.delete(node.id);
                }
              }}
              process={process}
              onInput={onInput}
              onResize={onResize}
              onPtyData={onPtyData}
              isFocused={isFocused}
              onFocus={() => setFocusedPaneId(node.id)}
            />
          </div>
        </div>
      );
    }

    // Render split
    const isHorizontal = node.direction === 'horizontal';
    
    return (
      <ResizablePanelGroup
        key={node.id}
        orientation={isHorizontal ? 'horizontal' : 'vertical'}
      >
        <ResizablePanel defaultSize={node.sizes[0]}>
          {renderPaneNode(node.children[0])}
        </ResizablePanel>
        <ResizableHandle className={cn(
          isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
          'bg-border hover:bg-primary/50 transition-colors'
        )} />
        <ResizablePanel defaultSize={node.sizes[1]}>
          {renderPaneNode(node.children[1])}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar for all processes */}
      {worktree && (
        <div className="flex items-center gap-1 border-b border-border bg-card px-2 py-1">
          {processes.map((process) => {
            const isAssigned = processAssignments.has(process.id);
            const assignedPane = processAssignments.get(process.id);
            const isFocusedProcess = assignedPane === focusedPaneId;
            
            return (
              <div
                key={process.id}
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(e) => {
                  setDraggedProcessId(process.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', process.id);
                }}
                onDragEnd={() => setDraggedProcessId(null)}
                onClick={() => {
                  // Assign to focused pane on click
                  assignProcessToPane(process.id, focusedPaneId);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    assignProcessToPane(process.id, focusedPaneId);
                  }
                }}
                className={cn(
                  'group flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors cursor-grab active:cursor-grabbing',
                  isFocusedProcess
                    ? 'bg-accent text-accent-foreground'
                    : isAssigned
                      ? 'bg-accent/30 text-muted-foreground'
                      : 'hover:bg-accent/50 text-muted-foreground',
                  draggedProcessId === process.id && 'opacity-50'
                )}
              >
                <Circle
                  className={cn(
                    'h-2 w-2',
                    process.status === 'running'
                      ? 'fill-green-500 text-green-500'
                      : process.status === 'pending'
                        ? 'fill-yellow-500 text-yellow-500'
                        : 'fill-muted-foreground text-muted-foreground'
                  )}
                />
                <span>{process.agent}</span>
                {isAssigned && !isFocusedProcess && (
                  <span className="text-xs text-muted-foreground/50">•</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onKillProcess(process.id);
                  }}
                  className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {/* New tab button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-muted-foreground"
            onClick={onNewProcess}
          >
            <Plus className="h-3.5 w-3.5" />
            New Tab
          </Button>
        </div>
      )}

      {/* Pane layout */}
      <div className="flex-1 overflow-hidden">
        {!worktree ? (
          <div className="flex h-full items-center justify-center bg-[#0a0a0a]">
            <span className="text-muted-foreground">Select a worktree to view processes</span>
          </div>
        ) : processes.length === 0 ? (
          <div className="flex h-full items-center justify-center bg-[#0a0a0a]">
            <span className="text-muted-foreground">Click "+ New Tab" to spawn a process</span>
          </div>
        ) : (
          renderPaneNode(layout)
        )}
      </div>

      {/* Action bar - only show when worktree is selected and not main */}
      {worktree && !worktree.isMain && (
        <div className="flex items-center justify-between border-t border-border bg-card px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium">{worktree.branch}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1" onClick={async () => {
              const processId = await onViewDiff();
              if (processId) setPendingSelectProcessId(processId);
            }}>
              <GitCompare className="h-4 w-4" />
              View Diff
            </Button>
            <Button variant="ghost" size="sm" className="gap-1" onClick={async () => {
              const processId = await onMerge();
              if (processId) setPendingSelectProcessId(processId);
            }}>
              <GitMerge className="h-4 w-4" />
              Merge
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => setShowAgentMergeDialog(true)}
              title="Use AI agent to resolve merge conflicts"
            >
              <Bot className="h-4 w-4" />
              Agent Merge
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-destructive hover:text-destructive"
              onClick={onArchiveWorktree}
            >
              <Archive className="h-4 w-4" />
              Archive Worktree
            </Button>
          </div>
        </div>
      )}

      {/* Agent Merge Dialog */}
      {showAgentMergeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 text-lg font-semibold">Select Agent for Merge</h2>
            <div className="grid grid-cols-2 gap-2">
              {MERGE_AGENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={async () => {
                    setShowAgentMergeDialog(false);
                    const processId = await onMergeWithAgent(option.value);
                    if (processId) setPendingSelectProcessId(processId);
                  }}
                  className="flex flex-col items-start rounded-lg border border-input bg-background px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary/10"
                >
                  <span className="font-medium text-sm">{option.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={() => setShowAgentMergeDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

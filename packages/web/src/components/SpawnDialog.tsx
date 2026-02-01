// Dialog for spawning new agent processes

import { useState } from 'react';
import type { AgentType } from '@agenthq/shared';
import { Button } from './ui/button';

const AGENT_OPTIONS: { value: AgentType; label: string; description: string; supportsYolo: boolean }[] = [
  { value: 'bash', label: 'Terminal', description: 'Plain bash shell', supportsYolo: false },
  { value: 'claude-code', label: 'Claude Code', description: 'Anthropic coding agent', supportsYolo: true },
  { value: 'codex-cli', label: 'Codex CLI', description: 'OpenAI coding agent', supportsYolo: true },
  { value: 'cursor-agent', label: 'Cursor Agent', description: 'Cursor coding agent', supportsYolo: true },
  { value: 'droid-cli', label: 'Droid CLI', description: 'Factory AI coding agent', supportsYolo: false },
  { value: 'kimi-cli', label: 'Kimi CLI', description: 'Moonshot coding agent', supportsYolo: true },
];

interface SpawnDialogProps {
  open: boolean;
  worktreeId: string;
  onClose: () => void;
  onSpawn: (agent: AgentType, task?: string, yoloMode?: boolean) => void;
}

export function SpawnDialog({ open, worktreeId, onClose, onSpawn }: SpawnDialogProps) {
  const [yoloMode, setYoloMode] = useState(false);

  if (!open) return null;

  const handleSelect = (agent: AgentType) => {
    const option = AGENT_OPTIONS.find((o) => o.value === agent);
    const useYolo = option?.supportsYolo ? yoloMode : false;
    onSpawn(agent, undefined, useYolo);
    onClose();
    setYoloMode(false); // Reset for next time
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">New Process</h2>

        <div className="space-y-4">
          {/* Yolo Mode Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-input bg-background px-3 py-2.5">
            <div className="flex flex-col">
              <span className="font-medium text-sm">Yolo Mode</span>
              <span className="text-xs text-muted-foreground">Skip permission prompts</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={yoloMode}
              onClick={() => setYoloMode(!yoloMode)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                yoloMode ? 'bg-primary' : 'bg-input'
              }`}
            >
              <span
                className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  yoloMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Select Agent</label>
            <div className="grid grid-cols-2 gap-2">
              {AGENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className="flex flex-col items-start rounded-lg border border-input bg-background px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary/10"
                >
                  <span className="font-medium text-sm">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

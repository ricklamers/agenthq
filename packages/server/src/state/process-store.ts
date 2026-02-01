// In-memory store for processes and terminal buffers

import type { Process, ProcessStatus } from '@agenthq/shared';
import { PROCESS_ID_LENGTH } from '@agenthq/shared';
import { nanoid } from 'nanoid';

// Maximum buffer size per process (1MB)
const MAX_BUFFER_SIZE = 1024 * 1024;

interface ProcessWithBuffer extends Process {
  buffer: string;
}

class ProcessStore {
  private processes = new Map<string, ProcessWithBuffer>();

  generateId(): string {
    return nanoid(PROCESS_ID_LENGTH);
  }

  create(process: Omit<Process, 'id' | 'createdAt' | 'status'>): Process {
    const id = this.generateId();
    const newProcess: ProcessWithBuffer = {
      ...process,
      id,
      status: 'pending',
      createdAt: Date.now(),
      buffer: '',
    };
    this.processes.set(id, newProcess);
    return this.toProcess(newProcess);
  }

  get(processId: string): Process | undefined {
    const p = this.processes.get(processId);
    return p ? this.toProcess(p) : undefined;
  }

  getAll(): Process[] {
    return Array.from(this.processes.values()).map((p) => this.toProcess(p));
  }

  getByWorktree(worktreeId: string): Process[] {
    return Array.from(this.processes.values())
      .filter((p) => p.worktreeId === worktreeId)
      .map((p) => this.toProcess(p));
  }

  getByEnv(envId: string): Process[] {
    return Array.from(this.processes.values())
      .filter((p) => p.envId === envId)
      .map((p) => this.toProcess(p));
  }

  updateStatus(processId: string, status: ProcessStatus, exitCode?: number): Process | undefined {
    const process = this.processes.get(processId);
    if (process) {
      process.status = status;
      if (exitCode !== undefined) {
        process.exitCode = exitCode;
      }
      return this.toProcess(process);
    }
    return undefined;
  }

  appendBuffer(processId: string, data: string): void {
    const process = this.processes.get(processId);
    if (process) {
      process.buffer += data;
      // Trim buffer if too large (keep last MAX_BUFFER_SIZE chars)
      if (process.buffer.length > MAX_BUFFER_SIZE) {
        process.buffer = process.buffer.slice(-MAX_BUFFER_SIZE);
      }
    }
  }

  getBuffer(processId: string): string {
    return this.processes.get(processId)?.buffer ?? '';
  }

  clearBuffer(processId: string): void {
    const process = this.processes.get(processId);
    if (process) {
      process.buffer = '';
    }
  }

  delete(processId: string): boolean {
    return this.processes.delete(processId);
  }

  private toProcess(p: ProcessWithBuffer): Process {
    const { buffer: _, ...process } = p;
    return process;
  }
}

export const processStore = new ProcessStore();

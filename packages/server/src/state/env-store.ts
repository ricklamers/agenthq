// In-memory store for connected daemon environments

import type { Environment } from '@agenthq/shared';
import type { WebSocket } from 'ws';

interface ConnectedEnv extends Environment {
  ws: WebSocket;
}

class EnvStore {
  private envs = new Map<string, ConnectedEnv>();
  // Map from env name to env id for deduplication on reconnect
  private nameToId = new Map<string, string>();

  register(env: Omit<ConnectedEnv, 'connectedAt' | 'lastHeartbeat'>): void {
    // If an environment with the same name already exists, remove the old one
    // This handles daemon restarts cleanly
    const existingId = this.nameToId.get(env.name);
    if (existingId && existingId !== env.id) {
      this.envs.delete(existingId);
    }

    this.nameToId.set(env.name, env.id);
    this.envs.set(env.id, {
      ...env,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    });
  }

  unregister(envId: string): void {
    const env = this.envs.get(envId);
    if (env) {
      // Only remove from nameToId if this is the current mapping
      if (this.nameToId.get(env.name) === envId) {
        this.nameToId.delete(env.name);
      }
    }
    this.envs.delete(envId);
  }

  get(envId: string): ConnectedEnv | undefined {
    return this.envs.get(envId);
  }

  heartbeat(envId: string): void {
    const env = this.envs.get(envId);
    if (env) {
      env.lastHeartbeat = Date.now();
    }
  }

  getAll(): Environment[] {
    return Array.from(this.envs.values()).map(({ ws: _, ...env }) => env);
  }

  getSocket(envId: string): WebSocket | undefined {
    return this.envs.get(envId)?.ws;
  }
}

export const envStore = new EnvStore();

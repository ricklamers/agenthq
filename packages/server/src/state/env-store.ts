// In-memory store for environment connections
// Combines configured environments (from configStore) with connection state

import type { Environment, EnvironmentConfig, EnvironmentStatus } from '@agenthq/shared';
import type { WebSocket } from 'ws';
import { configStore } from './config-store.js';

interface ConnectionState {
  ws: WebSocket;
  capabilities: string[];
  connectedAt: number;
  lastHeartbeat: number;
  workspace?: string;
}

class EnvStore {
  // Connection state by environment ID
  private connections = new Map<string, ConnectionState>();
  // Map from daemon's reported name to env config id (for matching)
  private nameToConfigId = new Map<string, string>();

  // Register a daemon connection
  // The daemon reports envId and envName - we match it to a configured environment
  register(daemonEnvId: string, envName: string, capabilities: string[], ws: WebSocket, workspace?: string): string {
    const configs = configStore.getEnvironments();
    
    // First priority: match by explicit daemonEnvId if provided
    let matchedConfig = daemonEnvId ? configs.find((c) => c.id === daemonEnvId) : undefined;
    
    // Second: try to match by name
    if (!matchedConfig) {
      matchedConfig = configs.find((c) => c.name === envName);
    }
    
    // Third: for exe type, match by VM name
    if (!matchedConfig) {
      matchedConfig = configs.find((c) => c.type === 'exe' && c.vmName === envName);
    }
    
    // Fourth: for local type, match if name is hostname
    if (!matchedConfig) {
      matchedConfig = configs.find((c) => c.type === 'local');
    }

    const configId = matchedConfig?.id ?? daemonEnvId;

    // If there's an existing connection for this config, close it
    const existing = this.connections.get(configId);
    if (existing && existing.ws !== ws) {
      try {
        existing.ws.close();
      } catch {
        // Ignore close errors
      }
    }

    this.nameToConfigId.set(envName, configId);
    this.connections.set(configId, {
      ws,
      capabilities,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      workspace,
    });

    return configId;
  }

  // Unregister a connection
  unregister(envId: string): void {
    this.connections.delete(envId);
    // Clean up name mapping
    for (const [name, id] of Array.from(this.nameToConfigId.entries())) {
      if (id === envId) {
        this.nameToConfigId.delete(name);
        break;
      }
    }
  }

  // Get connection state for an environment
  getConnection(envId: string): ConnectionState | undefined {
    return this.connections.get(envId);
  }

  // Update heartbeat
  heartbeat(envId: string): void {
    const conn = this.connections.get(envId);
    if (conn) {
      conn.lastHeartbeat = Date.now();
    }
  }

  // Check if environment is connected
  isConnected(envId: string): boolean {
    return this.connections.has(envId);
  }

  // Get all environments (configured + connection state)
  getAll(): Environment[] {
    const configs = configStore.getEnvironments();
    
    return configs.map((config) => {
      const conn = this.connections.get(config.id);
      const status: EnvironmentStatus = conn ? 'connected' : 'disconnected';
      
      return {
        id: config.id,
        name: config.name,
        type: config.type,
        status,
        capabilities: conn?.capabilities ?? [],
        connectedAt: conn?.connectedAt,
        lastHeartbeat: conn?.lastHeartbeat,
        vmName: config.vmName,
        vmSshDest: config.vmSshDest,
        workspace: config.workspace ?? conn?.workspace,
      };
    });
  }

  // Get a single environment by ID
  get(envId: string): Environment | undefined {
    const config = configStore.getEnvironment(envId);
    if (!config) return undefined;
    
    const conn = this.connections.get(envId);
    const status: EnvironmentStatus = conn ? 'connected' : 'disconnected';
    
    return {
      id: config.id,
      name: config.name,
      type: config.type,
      status,
      capabilities: conn?.capabilities ?? [],
      connectedAt: conn?.connectedAt,
      lastHeartbeat: conn?.lastHeartbeat,
      vmName: config.vmName,
      vmSshDest: config.vmSshDest,
      workspace: config.workspace ?? conn?.workspace,
    };
  }

  // Get WebSocket for an environment
  getSocket(envId: string): WebSocket | undefined {
    return this.connections.get(envId)?.ws;
  }

  // Get connected environment IDs
  getConnectedIds(): string[] {
    return Array.from(this.connections.keys());
  }
}

export const envStore = new EnvStore();

// Configuration store - persists sprites token and environment configs

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EnvironmentConfig } from '@agenthq/shared';

const META_DIR = '.agenthq-meta';
const CONFIG_FILE = 'config.json';

interface Config {
  spritesToken?: string;
  serverPublicUrl?: string;
  daemonAuthToken?: string; // Token that daemons use to authenticate with the server
  environments: EnvironmentConfig[];
}

const DEFAULT_CONFIG: Config = {
  environments: [
    {
      id: 'local',
      name: 'Local',
      type: 'local',
    },
  ],
};

class ConfigStore {
  private workspace: string = '';
  private config: Config = { ...DEFAULT_CONFIG };

  setWorkspace(path: string): void {
    this.workspace = path;
    this.load();
  }

  private getConfigPath(): string {
    return join(this.workspace, META_DIR, CONFIG_FILE);
  }

  private ensureMetaDir(): void {
    const metaPath = join(this.workspace, META_DIR);
    if (!existsSync(metaPath)) {
      mkdirSync(metaPath, { recursive: true });
    }
  }

  private load(): void {
    const configPath = this.getConfigPath();
    if (existsSync(configPath)) {
      try {
        const data = readFileSync(configPath, 'utf-8');
        const loaded = JSON.parse(data) as Partial<Config>;
        this.config = {
          ...DEFAULT_CONFIG,
          ...loaded,
          environments: loaded.environments ?? DEFAULT_CONFIG.environments,
        };
        // Ensure local environment always exists
        if (!this.config.environments.some((e) => e.type === 'local')) {
          this.config.environments.unshift({
            id: 'local',
            name: 'Local',
            type: 'local',
          });
        }
      } catch (err) {
        console.error('Failed to load config:', err);
        this.config = { ...DEFAULT_CONFIG };
      }
    } else {
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  private save(): void {
    if (!this.workspace) return;
    this.ensureMetaDir();
    const configPath = this.getConfigPath();
    writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }

  // Sprites token
  getSpritesToken(): string | undefined {
    return this.config.spritesToken;
  }

  setSpritesToken(token: string): void {
    this.config.spritesToken = token;
    this.save();
  }

  // Server public URL (for sprites daemons to connect back)
  getServerPublicUrl(): string | undefined {
    return this.config.serverPublicUrl || process.env.AGENTHQ_SERVER_PUBLIC_URL;
  }

  setServerPublicUrl(url: string): void {
    this.config.serverPublicUrl = url;
    this.save();
  }

  // Daemon auth token (for remote daemons to authenticate)
  getDaemonAuthToken(): string | undefined {
    return this.config.daemonAuthToken || process.env.AGENTHQ_DAEMON_AUTH_TOKEN;
  }

  setDaemonAuthToken(token: string): void {
    this.config.daemonAuthToken = token;
    this.save();
  }

  // Environment configs
  getEnvironments(): EnvironmentConfig[] {
    return this.config.environments;
  }

  getEnvironment(id: string): EnvironmentConfig | undefined {
    return this.config.environments.find((e) => e.id === id);
  }

  addEnvironment(env: EnvironmentConfig): void {
    // Remove existing with same id
    this.config.environments = this.config.environments.filter((e) => e.id !== env.id);
    this.config.environments.push(env);
    this.save();
  }

  updateEnvironment(id: string, updates: Partial<EnvironmentConfig>): void {
    const env = this.config.environments.find((e) => e.id === id);
    if (env) {
      Object.assign(env, updates);
      this.save();
    }
  }

  removeEnvironment(id: string): void {
    // Cannot remove local environment
    if (id === 'local') return;
    this.config.environments = this.config.environments.filter((e) => e.id !== id);
    this.save();
  }

  // Get full config (for API)
  getConfig(): Config {
    return { ...this.config };
  }
}

export const configStore = new ConfigStore();

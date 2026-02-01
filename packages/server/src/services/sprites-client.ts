// Sprites.dev API client using official SDK

import { SpritesClient as OfficialSpritesClient, type Sprite } from '@fly/sprites';
import dns from 'node:dns';

// Force IPv4 to avoid connectivity issues with IPv6
dns.setDefaultResultOrder('ipv4first');

export interface SpriteInfo {
  name: string;
  status: string;
  url?: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class SpritesClient {
  private client: OfficialSpritesClient;

  constructor(token: string) {
    this.client = new OfficialSpritesClient(token);
  }

  // List all sprites
  async list(): Promise<SpriteInfo[]> {
    const result = await this.client.listSprites();
    return result.sprites.map((s) => ({
      name: s.name,
      status: s.status ?? 'unknown',
      url: s.url,
    }));
  }

  // Get sprite info
  async get(name: string): Promise<SpriteInfo> {
    const result = await this.client.listSprites();
    const spriteInfo = result.sprites.find((s) => s.name === name);
    if (!spriteInfo) {
      throw new Error(`Sprite ${name} not found`);
    }
    return {
      name: spriteInfo.name,
      status: spriteInfo.status ?? 'unknown',
      url: spriteInfo.url,
    };
  }

  // Create a new sprite
  async create(name: string): Promise<SpriteInfo> {
    const sprite = await this.client.createSprite(name);
    return {
      name: sprite.name,
      status: 'created',
      url: (sprite as unknown as { url?: string }).url,
    };
  }

  // Delete a sprite
  async destroy(name: string): Promise<void> {
    const sprite = this.client.sprite(name);
    await sprite.destroy();
  }

  // Get sprite URL
  async getUrl(name: string): Promise<string> {
    const info = await this.get(name);
    return info.url ?? `https://${name}.sprites.dev`;
  }

  // Execute a command on a sprite (blocking, waits for completion)
  async exec(name: string, command: string, args: string[] = []): Promise<ExecResult> {
    const sprite = this.client.sprite(name);
    
    try {
      const result = await sprite.execFile(command, args);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout?.toString() ?? '',
        stderr: result.stderr?.toString() ?? '',
      };
    } catch (err: unknown) {
      const error = err as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: error.exitCode ?? 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message ?? 'Unknown error',
      };
    }
  }

  // Execute a shell command (convenience method)
  async execShell(name: string, shellCommand: string): Promise<ExecResult> {
    return this.exec(name, 'bash', ['-c', shellCommand]);
  }

  // Write a file using SDK filesystem API
  async writeFile(name: string, path: string, content: string | Buffer): Promise<void> {
    const sprite = this.client.sprite(name);
    const fs = sprite.filesystem('/');
    await fs.writeFile(path, content);
  }

  // Read a file using SDK filesystem API
  async readFile(name: string, path: string): Promise<string> {
    const sprite = this.client.sprite(name);
    const fs = sprite.filesystem('/');
    return await fs.readFile(path, 'utf8');
  }

  // Upload a binary file using SDK filesystem API
  async uploadFile(name: string, localPath: string, remotePath: string): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(localPath);
    
    const sprite = this.client.sprite(name);
    const fs = sprite.filesystem('/');
    await fs.writeFile(remotePath, content);
  }

  // Set file permissions using SDK filesystem API
  async chmod(name: string, path: string, mode: number): Promise<void> {
    const sprite = this.client.sprite(name);
    const fs = sprite.filesystem('/');
    await fs.chmod(path, mode);
  }

  // Check if sprite exists
  async exists(name: string): Promise<boolean> {
    try {
      await this.get(name);
      return true;
    } catch {
      return false;
    }
  }

  // Wake up the sprite by running a simple command
  async wakeUp(name: string): Promise<void> {
    try {
      await this.exec(name, 'true', []);
    } catch {
      // Ignore errors - sprite might take a moment to wake
    }
  }

  // Wait for sprite to exist and wake it up
  async waitReady(name: string, timeoutMs: number = 60000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      if (await this.exists(name)) {
        // Wake it up with a simple command
        await this.wakeUp(name);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Sprite ${name} did not become ready within ${timeoutMs}ms`);
  }
}

// Factory function that gets token from config store
export async function createSpritesClient(): Promise<SpritesClient | null> {
  const { configStore } = await import('../state/config-store.js');
  const token = configStore.getSpritesToken();
  if (!token) {
    return null;
  }
  return new SpritesClient(token);
}

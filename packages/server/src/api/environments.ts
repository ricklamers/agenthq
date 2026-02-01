// Environment API routes

import type { FastifyInstance } from 'fastify';
import type { EnvironmentConfig } from '@agenthq/shared';
import { envStore, processStore, configStore } from '../state/index.js';
import { browserHub } from '../ws/browser-hub.js';
import { createExeClient } from '../services/exe-client.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

export async function registerEnvRoutes(app: FastifyInstance): Promise<void> {
  // List all environments (configured + connection state)
  app.get('/api/environments', async () => {
    return envStore.getAll();
  });

  // Get single environment
  app.get<{ Params: { envId: string } }>('/api/environments/:envId', async (request, reply) => {
    const { envId } = request.params;
    const env = envStore.get(envId);
    if (!env) {
      return reply.status(404).send({ error: 'Environment not found' });
    }
    return env;
  });

  // Create a new exe.dev environment
  app.post<{ Body: { name: string; vmName: string } }>('/api/environments', async (request, reply) => {
    const { name, vmName } = request.body;

    if (!name || !vmName) {
      return reply.status(400).send({ error: 'name and vmName are required' });
    }

    const client = createExeClient();

    try {
      // Create the VM
      console.log(`[create] Creating exe.dev VM: ${vmName}`);
      const vmInfo = await client.create(vmName);
      console.log(`[create] VM created: ${vmInfo.sshDest}`);
      
      // Generate environment ID
      const envId = `exe-${vmName}-${Date.now()}`;
      
      // Create environment config
      const config: EnvironmentConfig = {
        id: envId,
        name,
        type: 'exe',
        vmName,
        vmSshDest: vmInfo.sshDest,
        workspace: '/workspace',
      };

      configStore.addEnvironment(config);
      browserHub.broadcastEnvUpdate();

      return { success: true, environment: envStore.get(envId) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: `Failed to create VM: ${message}` });
    }
  });

  // Delete/disconnect an environment
  app.delete<{ Params: { envId: string } }>('/api/environments/:envId', async (request, reply) => {
    const { envId } = request.params;
    
    const env = envStore.get(envId);
    if (!env) {
      return reply.status(404).send({ error: 'Environment not found' });
    }

    // Cannot delete local environment
    if (env.type === 'local') {
      // Just disconnect, don't delete config
      const ws = envStore.getSocket(envId);
      if (ws) {
        ws.close(1000, 'Restart requested');
      }
      envStore.unregister(envId);
      browserHub.broadcastEnvUpdate();
      return { success: true, message: 'Local daemon disconnected, will auto-reconnect' };
    }

    // Stop all processes in this environment first
    const processes = processStore.getByEnv(envId);
    for (const process of processes) {
      const updated = processStore.updateStatus(process.id, 'stopped');
      if (updated) {
        browserHub.broadcastProcessUpdate(updated);
      }
    }

    // Close WebSocket if connected
    const ws = envStore.getSocket(envId);
    if (ws) {
      ws.close(1000, 'Environment deleted');
    }
    envStore.unregister(envId);

    // For exe environments, destroy the VM
    if (env.type === 'exe' && env.vmName) {
      const client = createExeClient();
      try {
        await client.destroy(env.vmName);
      } catch (err) {
        console.error(`Failed to destroy VM ${env.vmName}:`, err);
      }
    }

    // Remove from config
    configStore.removeEnvironment(envId);
    browserHub.broadcastEnvUpdate();

    return { success: true, message: 'Environment deleted' };
  });

  // Provision an exe.dev environment (copy daemon, start it, create test repo)
  app.post<{ Params: { envId: string } }>('/api/environments/:envId/provision', async (request, reply) => {
    const { envId } = request.params;
    
    const env = envStore.get(envId);
    if (!env) {
      return reply.status(404).send({ error: 'Environment not found' });
    }

    if (env.type !== 'exe') {
      return reply.status(400).send({ error: 'Can only provision exe environments' });
    }

    if (!env.vmName) {
      return reply.status(400).send({ error: 'Environment has no VM name' });
    }

    const serverUrl = configStore.getServerPublicUrl();
    if (!serverUrl) {
      return reply.status(400).send({ error: 'Server public URL not configured' });
    }

    const client = createExeClient();

    try {
      const vmName = env.vmName;
      
      // Wait for VM to be ready
      console.log(`[provision] Waiting for VM ${vmName} to be ready...`);
      await client.waitReady(vmName, 60000);
      console.log(`[provision] VM ready`);

      // Find the daemon binary
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const daemonPath = join(__dirname, '../../../../daemon/agenthq-daemon-linux-amd64');
      
      if (!existsSync(daemonPath)) {
        return reply.status(500).send({ 
          error: 'Daemon binary not found. Run: make build-daemon-linux' 
        });
      }

      // Upload daemon binary via SCP
      console.log(`[provision] Uploading daemon binary via SCP...`);
      await client.uploadFile(vmName, daemonPath, '/tmp/agenthq-daemon');
      console.log(`[provision] Daemon binary uploaded`);
      
      // Move to /usr/local/bin and make executable
      console.log(`[provision] Installing daemon...`);
      await client.execShell(vmName, 'sudo mv /tmp/agenthq-daemon /usr/local/bin/agenthq-daemon && sudo chmod +x /usr/local/bin/agenthq-daemon');

      // Create workspace directory
      console.log(`[provision] Creating workspace...`);
      await client.execShell(vmName, 'sudo mkdir -p /workspace && sudo chown $(whoami) /workspace');

      // Disable exe.dev MOTD/banner in .bashrc (lines 121-159 contain the message block)
      console.log(`[provision] Disabling exe.dev banner...`);
      await client.execShell(vmName, 'sed -i "/# Print exe.dev message/,/^fi$/s/^/# DISABLED: /" ~/.bashrc');

      // Create a test repo with README (proper git repo for worktrees)
      console.log(`[provision] Creating test repo...`);
      const repoDir = '/workspace/test-repo';
      
      // Create directory and init with explicit main branch
      let result = await client.execShell(vmName, `mkdir -p ${repoDir}`);
      if (result.exitCode !== 0) {
        console.error(`[provision] Failed to create test repo directory: ${result.stderr}`);
        throw new Error(`Failed to create test repo directory: ${result.stderr}`);
      }
      
      result = await client.execShell(vmName, `cd ${repoDir} && git init --initial-branch=main`);
      if (result.exitCode !== 0) {
        console.error(`[provision] Failed to init git repo: ${result.stderr}`);
        throw new Error(`Failed to init git repo: ${result.stderr}`);
      }
      
      // Configure git user (required for commits)
      result = await client.execShell(vmName, `cd ${repoDir} && git config user.email "agent@agenthq.local" && git config user.name "Agent HQ"`);
      if (result.exitCode !== 0) {
        console.error(`[provision] Failed to configure git: ${result.stderr}`);
        throw new Error(`Failed to configure git: ${result.stderr}`);
      }
      
      // Write initial files
      await client.writeFile(vmName, `${repoDir}/README.md`, '# Test Repository\n\nThis is a test repository for Agent HQ.\n');
      await client.writeFile(vmName, `${repoDir}/.gitignore`, '# Ignore worktrees directory\n.agenthq-worktrees/\n');
      
      // Stage and commit
      result = await client.execShell(vmName, `cd ${repoDir} && git add -A && git commit -m "Initial commit"`);
      if (result.exitCode !== 0) {
        console.error(`[provision] Failed to create initial commit: ${result.stderr}`);
        throw new Error(`Failed to create initial commit: ${result.stderr}`);
      }
      
      // Verify repo is valid by checking HEAD
      result = await client.execShell(vmName, `cd ${repoDir} && git rev-parse HEAD`);
      if (result.exitCode !== 0) {
        console.error(`[provision] Git repo verification failed - no valid HEAD: ${result.stderr}`);
        throw new Error(`Git repo verification failed - no valid HEAD`);
      }
      console.log(`[provision] Test repo created with commit: ${result.stdout.trim()}`);

      // Start the daemon with environment variables using nohup
      // Write a startup script to avoid shell escaping issues
      console.log(`[provision] Starting daemon...`);
      const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws/daemon';
      const authToken = configStore.getDaemonAuthToken() || '';
      const startScript = `#!/bin/bash
export AGENTHQ_SERVER_URL="${wsUrl}"
export AGENTHQ_ENV_ID="${envId}"
export AGENTHQ_AUTH_TOKEN="${authToken}"
nohup /usr/local/bin/agenthq-daemon --workspace /workspace > /tmp/daemon.log 2>&1 &
`;
      await client.writeFile(vmName, '/tmp/start-daemon.sh', startScript);
      await client.execShell(vmName, 'chmod +x /tmp/start-daemon.sh && /tmp/start-daemon.sh');
      
      console.log(`[provision] Environment provisioned successfully`);
      return { success: true, message: 'Environment provisioned successfully' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[provision] Failed:`, err);
      return reply.status(500).send({ error: `Failed to provision: ${message}` });
    }
  });

  // Update daemon in an exe.dev environment (upload latest binary and restart)
  app.post<{ Params: { envId: string } }>('/api/environments/:envId/update-daemon', async (request, reply) => {
    const { envId } = request.params;
    
    const env = envStore.get(envId);
    if (!env) {
      return reply.status(404).send({ error: 'Environment not found' });
    }

    if (env.type !== 'exe') {
      return reply.status(400).send({ error: 'Can only update daemon on exe environments' });
    }

    if (!env.vmName) {
      return reply.status(400).send({ error: 'Environment has no VM name' });
    }

    const serverUrl = configStore.getServerPublicUrl();
    if (!serverUrl) {
      return reply.status(400).send({ error: 'Server public URL not configured' });
    }

    const client = createExeClient();

    try {
      const vmName = env.vmName;
      
      // Build the daemon binary
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const daemonDir = join(__dirname, '../../../../daemon');
      const daemonPath = join(daemonDir, 'agenthq-daemon-linux-amd64');
      
      console.log(`[update-daemon] Building daemon binary...`);
      try {
        execSync('GOOS=linux GOARCH=amd64 /usr/local/go/bin/go build -o agenthq-daemon-linux-amd64 ./cmd/agenthq-daemon', {
          cwd: daemonDir,
          stdio: 'pipe',
        });
        console.log(`[update-daemon] Daemon binary built`);
      } catch (buildErr) {
        const buildError = buildErr as { stderr?: Buffer };
        const stderr = buildError.stderr?.toString() || 'Unknown build error';
        return reply.status(500).send({ error: `Failed to build daemon: ${stderr}` });
      }

      if (!existsSync(daemonPath)) {
        return reply.status(500).send({ error: 'Daemon binary not found after build' });
      }

      // Stop existing daemon
      console.log(`[update-daemon] Stopping existing daemon on ${vmName}...`);
      await client.execShell(vmName, 'pkill -f agenthq-daemon || true');
      
      // Close WebSocket connection
      const ws = envStore.getSocket(envId);
      if (ws) {
        ws.close(1000, 'Daemon update');
      }
      envStore.unregister(envId);
      browserHub.broadcastEnvUpdate();

      // Upload new daemon binary via SCP
      console.log(`[update-daemon] Uploading new daemon binary via SCP...`);
      await client.uploadFile(vmName, daemonPath, '/tmp/agenthq-daemon');
      console.log(`[update-daemon] Daemon binary uploaded`);
      
      // Move to /usr/local/bin and make executable
      console.log(`[update-daemon] Installing daemon...`);
      await client.execShell(vmName, 'sudo mv /tmp/agenthq-daemon /usr/local/bin/agenthq-daemon && sudo chmod +x /usr/local/bin/agenthq-daemon');

      // Start the daemon
      console.log(`[update-daemon] Starting daemon...`);
      const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws/daemon';
      const authToken = configStore.getDaemonAuthToken() || '';
      const startScript = `#!/bin/bash
export AGENTHQ_SERVER_URL="${wsUrl}"
export AGENTHQ_ENV_ID="${envId}"
export AGENTHQ_AUTH_TOKEN="${authToken}"
nohup /usr/local/bin/agenthq-daemon --workspace /workspace > /tmp/daemon.log 2>&1 &
`;
      await client.writeFile(vmName, '/tmp/start-daemon.sh', startScript);
      await client.execShell(vmName, 'chmod +x /tmp/start-daemon.sh && /tmp/start-daemon.sh');
      
      console.log(`[update-daemon] Daemon updated successfully`);
      return { success: true, message: 'Daemon updated successfully' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[update-daemon] Failed:`, err);
      return reply.status(500).send({ error: `Failed to update daemon: ${message}` });
    }
  });

  // Restart daemon in an environment
  app.post<{ Params: { envId: string } }>('/api/environments/:envId/restart', async (request, reply) => {
    const { envId } = request.params;
    
    const env = envStore.get(envId);
    if (!env) {
      return reply.status(404).send({ error: 'Environment not found' });
    }

    // Close existing WebSocket connection (daemon will auto-reconnect for local)
    const ws = envStore.getSocket(envId);
    if (ws) {
      ws.close(1000, 'Restart requested');
    }
    envStore.unregister(envId);
    browserHub.broadcastEnvUpdate();

    // For exe environments, re-run the daemon
    if (env.type === 'exe' && env.vmName) {
      const client = createExeClient();
      const serverUrl = configStore.getServerPublicUrl();
      
      if (serverUrl) {
        try {
          // Kill existing daemon
          await client.execShell(env.vmName, 'pkill -f agenthq-daemon || true');
          
          // Start daemon again using the startup script
          const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws/daemon';
          const authToken = configStore.getDaemonAuthToken() || '';
          const startScript = `#!/bin/bash
export AGENTHQ_SERVER_URL="${wsUrl}"
export AGENTHQ_ENV_ID="${envId}"
export AGENTHQ_AUTH_TOKEN="${authToken}"
nohup /usr/local/bin/agenthq-daemon --workspace /workspace > /tmp/daemon.log 2>&1 &
`;
          await client.writeFile(env.vmName, '/tmp/start-daemon.sh', startScript);
          await client.execShell(env.vmName, 'chmod +x /tmp/start-daemon.sh && /tmp/start-daemon.sh');
        } catch (err) {
          console.error(`Failed to restart daemon on VM ${env.vmName}:`, err);
        }
      }
    }

    return { success: true, message: 'Daemon restart requested' };
  });
}

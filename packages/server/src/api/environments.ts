// Environment API routes

import type { FastifyInstance } from 'fastify';
import { envStore, processStore } from '../state/index.js';
import { browserHub } from '../ws/browser-hub.js';

export async function registerEnvRoutes(app: FastifyInstance): Promise<void> {
  // List connected environments
  app.get('/api/environments', async () => {
    return envStore.getAll();
  });

  // Disconnect/restart a daemon (closes WebSocket, daemon will auto-reconnect)
  app.delete<{ Params: { envId: string } }>('/api/environments/:envId', async (request, reply) => {
    const { envId } = request.params;
    
    const env = envStore.get(envId);
    if (!env) {
      return reply.status(404).send({ error: 'Environment not found' });
    }

    // Stop all processes in this environment first
    const processes = processStore.getByEnv(envId);
    for (const process of processes) {
      const updated = processStore.updateStatus(process.id, 'stopped');
      if (updated) {
        browserHub.broadcastProcessUpdate(updated);
      }
    }

    // Close the daemon's WebSocket connection (this will trigger reconnect)
    const ws = envStore.getSocket(envId);
    if (ws) {
      ws.close(1000, 'Restart requested');
    }

    // Unregister the environment
    envStore.unregister(envId);
    browserHub.broadcastEnvUpdate();

    return { success: true, message: 'Daemon disconnected, will auto-reconnect' };
  });
}

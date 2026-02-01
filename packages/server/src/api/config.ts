// Config API routes

import type { FastifyInstance } from 'fastify';
import { configStore } from '../state/index.js';

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  // Get config (without sensitive data like full tokens)
  app.get('/api/config', async () => {
    const config = configStore.getConfig();
    return {
      hasSpritesToken: !!config.spritesToken,
      hasDaemonAuthToken: !!configStore.getDaemonAuthToken(),
      serverPublicUrl: configStore.getServerPublicUrl(),
      environments: config.environments,
    };
  });

  // Set sprites token
  app.post<{ Body: { token: string } }>('/api/config/sprites-token', async (request) => {
    const { token } = request.body;
    configStore.setSpritesToken(token);
    return { success: true };
  });

  // Set server public URL
  app.post<{ Body: { url: string } }>('/api/config/server-url', async (request) => {
    const { url } = request.body;
    configStore.setServerPublicUrl(url);
    return { success: true };
  });

  // Set daemon auth token (for remote daemons)
  app.post<{ Body: { token: string } }>('/api/config/daemon-auth-token', async (request) => {
    const { token } = request.body;
    configStore.setDaemonAuthToken(token);
    return { success: true };
  });
}

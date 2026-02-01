// Agent HQ Server - Main entry point

import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_PORT } from '@agenthq/shared';
import { repoStore, configStore } from './state/index.js';
import { registerDaemonWs, registerBrowserWs } from './ws/index.js';
import { registerRepoRoutes, registerWorktreeRoutes, registerProcessRoutes, registerEnvRoutes, registerConfigRoutes } from './api/index.js';

// Validate environment
const workspace = process.env.AGENTHQ_WORKSPACE;
if (!workspace) {
  console.error('Error: AGENTHQ_WORKSPACE environment variable is required');
  process.exit(1);
}

const resolvedWorkspace = resolve(workspace);
if (!existsSync(resolvedWorkspace)) {
  console.error(`Error: Workspace path does not exist: ${resolvedWorkspace}`);
  process.exit(1);
}

// Initialize stores with workspace
repoStore.setWorkspace(resolvedWorkspace);
configStore.setWorkspace(resolvedWorkspace);

const port = parseInt(process.env.AGENTHQ_PORT ?? String(DEFAULT_PORT), 10);

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  },
});

// Register plugins
await app.register(fastifyCors, {
  origin: true, // Allow all origins in development
});

await app.register(fastifyWebsocket);

// Register WebSocket routes
registerDaemonWs(app);
registerBrowserWs(app);

// Register API routes
await registerRepoRoutes(app);
await registerWorktreeRoutes(app);
await registerProcessRoutes(app);
await registerEnvRoutes(app);
await registerConfigRoutes(app);

// Serve static files in production
const webDistPath = join(import.meta.dirname, '../../web/dist');
if (existsSync(webDistPath)) {
  await app.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
  });

  // SPA fallback
  app.setNotFoundHandler(async (request, reply) => {
    if (!request.url.startsWith('/api') && !request.url.startsWith('/ws')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'Not found' });
  });
}

// Health check
app.get('/health', async () => ({ status: 'ok' }));

// Start server
try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`\n🚀 Agent HQ Server running at http://localhost:${port}`);
  console.log(`📁 Workspace: ${resolvedWorkspace}`);
  console.log(`\n   WebSocket endpoints:`);
  console.log(`   - Daemon: ws://localhost:${port}/ws/daemon`);
  console.log(`   - Browser: ws://localhost:${port}/ws/browser\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

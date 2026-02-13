import type { AuthenticatedUser } from './auth/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

export {};

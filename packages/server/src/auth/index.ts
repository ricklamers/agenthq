import { AuthService } from './service.js';

let authServiceInstance: AuthService | null = null;

interface InitAuthOptions {
  dbPath: string;
  defaultUsername: string;
  defaultPassword: string;
}

export function initializeAuth(options: InitAuthOptions): AuthService {
  const service = new AuthService({ dbPath: options.dbPath });
  if (options.defaultUsername && options.defaultPassword) {
    service.seedUser(options.defaultUsername, options.defaultPassword);
  }
  authServiceInstance = service;
  return service;
}

export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    throw new Error('AuthService has not been initialized');
  }
  return authServiceInstance;
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAuthService } from '../auth/index.js';

interface LoginBody {
  username?: string;
  password?: string;
  deviceId?: string;
  devicePin?: string;
}

interface DevicePinStatusQuery {
  deviceId?: string;
}

interface DevicePinLoginBody {
  deviceId?: string;
  pin?: string;
}

function isValidDeviceId(deviceId: string): boolean {
  const trimmed = deviceId.trim();
  return trimmed.length >= 16 && trimmed.length <= 200;
}

function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin.trim());
}

function isSecureRequest(request: FastifyRequest): boolean {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const forwardedProtoValue = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return forwardedProtoValue === 'https' || request.protocol === 'https';
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const authService = getAuthService();

  app.get('/api/auth/me', async (request) => {
    const user = authService.getAuthenticatedUserFromCookie(request.headers.cookie);
    if (!user) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
      },
    };
  });

  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const username = request.body?.username ?? '';
    const password = request.body?.password ?? '';
    const deviceId = request.body?.deviceId ?? '';
    const devicePin = request.body?.devicePin ?? '';

    if (!isValidDeviceId(deviceId)) {
      return reply.status(400).send({ error: 'Invalid device identifier' });
    }

    const user = authService.verifyCredentials(username, password);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid username or password' });
    }

    const hasDevicePin = authService.hasDevicePin(deviceId);
    if (!hasDevicePin) {
      if (!isValidPin(devicePin)) {
        return reply.status(428).send({
          error: 'Set a 4-8 digit PIN for this device to continue',
          devicePinRequired: true,
        });
      }
      authService.upsertDevicePin(user.id, deviceId, devicePin.trim());
    }

    const loginResult = authService.login(username, password);
    if (!loginResult) {
      return reply.status(500).send({ error: 'Failed to create session' });
    }

    reply.header('Set-Cookie', authService.createSessionCookie(loginResult.sessionId, isSecureRequest(request)));
    return {
      authenticated: true,
      user: loginResult.user,
      devicePinRequired: false,
    };
  });

  app.get<{ Querystring: DevicePinStatusQuery }>('/api/auth/device-pin/status', async (request) => {
    const deviceId = request.query?.deviceId ?? '';
    if (!isValidDeviceId(deviceId)) {
      return { canUsePin: false };
    }

    return { canUsePin: authService.hasDevicePin(deviceId) };
  });

  app.post<{ Body: DevicePinLoginBody }>('/api/auth/device-pin/login', async (request, reply) => {
    const deviceId = request.body?.deviceId ?? '';
    const pin = request.body?.pin ?? '';
    if (!isValidDeviceId(deviceId) || !isValidPin(pin)) {
      return reply.status(400).send({ error: 'Invalid device PIN login payload' });
    }

    const loginResult = authService.loginWithDevicePin(deviceId, pin.trim());
    if (!loginResult) {
      return reply.status(401).send({ error: 'Invalid PIN' });
    }

    reply.header('Set-Cookie', authService.createSessionCookie(loginResult.sessionId, isSecureRequest(request)));
    return {
      authenticated: true,
      user: loginResult.user,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = authService.getSessionIdFromCookie(request.headers.cookie);
    if (sessionId) {
      authService.logout(sessionId);
    }

    reply.header('Set-Cookie', authService.clearSessionCookie(isSecureRequest(request)));
    return { success: true };
  });
}

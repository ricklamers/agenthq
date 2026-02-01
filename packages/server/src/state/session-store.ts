// In-memory store for sessions and terminal buffers

import type { Session, SessionStatus } from '@agenthq/shared';
import { SESSION_ID_LENGTH } from '@agenthq/shared';
import { nanoid } from 'nanoid';

// Maximum buffer size per session (1MB)
const MAX_BUFFER_SIZE = 1024 * 1024;

interface SessionWithBuffer extends Session {
  buffer: string;
}

class SessionStore {
  private sessions = new Map<string, SessionWithBuffer>();

  generateId(): string {
    return nanoid(SESSION_ID_LENGTH);
  }

  create(session: Omit<Session, 'id' | 'createdAt' | 'status'>): Session {
    const id = this.generateId();
    const newSession: SessionWithBuffer = {
      ...session,
      id,
      status: 'pending',
      createdAt: Date.now(),
      buffer: '',
    };
    this.sessions.set(id, newSession);
    return this.toSession(newSession);
  }

  get(sessionId: string): Session | undefined {
    const s = this.sessions.get(sessionId);
    return s ? this.toSession(s) : undefined;
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values()).map((s) => this.toSession(s));
  }

  getByEnv(envId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.envId === envId)
      .map((s) => this.toSession(s));
  }

  updateStatus(sessionId: string, status: SessionStatus, exitCode?: number): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      if (exitCode !== undefined) {
        session.exitCode = exitCode;
      }
      return this.toSession(session);
    }
    return undefined;
  }

  updateBranch(sessionId: string, branch: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.branch = branch;
      return this.toSession(session);
    }
    return undefined;
  }

  appendBuffer(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.buffer += data;
      // Trim buffer if too large (keep last MAX_BUFFER_SIZE chars)
      if (session.buffer.length > MAX_BUFFER_SIZE) {
        session.buffer = session.buffer.slice(-MAX_BUFFER_SIZE);
      }
    }
  }

  getBuffer(sessionId: string): string {
    return this.sessions.get(sessionId)?.buffer ?? '';
  }

  clearBuffer(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.buffer = '';
    }
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private toSession(s: SessionWithBuffer): Session {
    const { buffer: _, ...session } = s;
    return session;
  }
}

export const sessionStore = new SessionStore();

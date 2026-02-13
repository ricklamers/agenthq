import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SESSION_COOKIE_NAME = 'agenthq_session';
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  password_salt: string;
}

interface SessionRow {
  user_id: number;
  username: string;
  expires_at: number;
}

interface DevicePinRow {
  user_id: number;
  username: string;
  pin_hash: string;
  pin_salt: string;
}

export interface AuthenticatedUser {
  id: number;
  username: string;
}

interface AuthServiceOptions {
  dbPath: string;
  sessionTtlSeconds?: number;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function normalizeDeviceId(deviceId: string): string {
  return deviceId.trim();
}

function hashPassword(password: string, saltHex: string): string {
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return derived.toString('hex');
}

function createPasswordHash(password: string): { passwordHash: string; passwordSalt: string } {
  const passwordSalt = randomBytes(16).toString('hex');
  return {
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
  };
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'hex');
  const rightBuf = Buffer.from(right, 'hex');
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  const parsed: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = pair.slice(0, separatorIndex).trim();
    if (!name) {
      continue;
    }

    const rawValue = pair.slice(separatorIndex + 1).trim();
    try {
      parsed[name] = decodeURIComponent(rawValue);
    } catch {
      parsed[name] = rawValue;
    }
  }

  return parsed;
}

export class AuthService {
  private db: DatabaseSync;
  private readonly sessionTtlSeconds: number;

  constructor(options: AuthServiceOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new DatabaseSync(options.dbPath);
    this.sessionTtlSeconds = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS device_pins (
        device_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        pin_hash TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_used_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_device_pins_user_id ON device_pins(user_id);
    `);
  }

  seedUser(username: string, password: string): void {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || !password) {
      throw new Error('Default auth user must include a username and password');
    }

    const existing = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(normalizedUsername) as { id: number } | undefined;

    if (existing) {
      return;
    }

    const { passwordHash, passwordSalt } = createPasswordHash(password);
    this.db
      .prepare('INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)')
      .run(normalizedUsername, passwordHash, passwordSalt);
  }

  login(username: string, password: string): { sessionId: string; user: AuthenticatedUser } | null {
    const user = this.verifyCredentials(username, password);
    if (!user) {
      return null;
    }

    return {
      sessionId: this.createSessionForUserId(user.id),
      user,
    };
  }

  verifyCredentials(username: string, password: string): AuthenticatedUser | null {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || !password) {
      return null;
    }

    const user = this.db
      .prepare('SELECT id, username, password_hash, password_salt FROM users WHERE username = ?')
      .get(normalizedUsername) as UserRow | undefined;

    if (!user) {
      return null;
    }

    const expectedHash = hashPassword(password, user.password_salt);
    if (!safeEqualHex(expectedHash, user.password_hash)) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
    };
  }

  hasDevicePin(deviceId: string): boolean {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId) {
      return false;
    }

    const row = this.db
      .prepare('SELECT device_id FROM device_pins WHERE device_id = ?')
      .get(normalizedDeviceId) as { device_id: string } | undefined;

    return !!row;
  }

  upsertDevicePin(userId: number, deviceId: string, pin: string): void {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId || !pin) {
      throw new Error('deviceId and pin are required');
    }

    const { passwordHash, passwordSalt } = createPasswordHash(pin);
    this.db.prepare(`
      INSERT INTO device_pins (device_id, user_id, pin_hash, pin_salt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        user_id = excluded.user_id,
        pin_hash = excluded.pin_hash,
        pin_salt = excluded.pin_salt,
        updated_at = unixepoch()
    `).run(normalizedDeviceId, userId, passwordHash, passwordSalt);
  }

  loginWithDevicePin(deviceId: string, pin: string): { sessionId: string; user: AuthenticatedUser } | null {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId || !pin) {
      return null;
    }

    const row = this.db
      .prepare(`
        SELECT device_pins.user_id, users.username, device_pins.pin_hash, device_pins.pin_salt
        FROM device_pins
        JOIN users ON users.id = device_pins.user_id
        WHERE device_pins.device_id = ?
      `)
      .get(normalizedDeviceId) as DevicePinRow | undefined;

    if (!row) {
      return null;
    }

    const expectedHash = hashPassword(pin, row.pin_salt);
    if (!safeEqualHex(expectedHash, row.pin_hash)) {
      return null;
    }

    this.db
      .prepare('UPDATE device_pins SET last_used_at = unixepoch(), updated_at = unixepoch() WHERE device_id = ?')
      .run(normalizedDeviceId);

    const user: AuthenticatedUser = {
      id: row.user_id,
      username: row.username,
    };

    return {
      sessionId: this.createSessionForUserId(user.id),
      user,
    };
  }

  logout(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  getSessionIdFromCookie(cookieHeader: string | undefined): string | null {
    const cookies = parseCookieHeader(cookieHeader);
    const sessionId = cookies[SESSION_COOKIE_NAME];
    return sessionId || null;
  }

  getAuthenticatedUserFromCookie(cookieHeader: string | undefined): AuthenticatedUser | null {
    const sessionId = this.getSessionIdFromCookie(cookieHeader);
    if (!sessionId) {
      return null;
    }

    this.cleanupExpiredSessions();

    const row = this.db
      .prepare(`
        SELECT sessions.user_id, users.username, sessions.expires_at
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.id = ?
      `)
      .get(sessionId) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    if (row.expires_at <= Math.floor(Date.now() / 1000)) {
      this.logout(sessionId);
      return null;
    }

    return {
      id: row.user_id,
      username: row.username,
    };
  }

  createSessionCookie(sessionId: string, secure: boolean): string {
    const secureDirective = secure ? '; Secure' : '';
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${this.sessionTtlSeconds}${secureDirective}`;
  }

  clearSessionCookie(secure: boolean): string {
    const secureDirective = secure ? '; Secure' : '';
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureDirective}`;
  }

  private cleanupExpiredSessions(): void {
    this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(Math.floor(Date.now() / 1000));
  }

  private createSessionForUserId(userId: number): string {
    const sessionId = randomBytes(32).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + this.sessionTtlSeconds;
    this.db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, userId, expiresAt);
    return sessionId;
  }
}

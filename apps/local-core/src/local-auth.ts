import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";

export type AuthRole = "owner" | "member";

export interface AuthUserRecord {
  userId: string;
  email: string;
  passwordHash: string;
  role: AuthRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface AuthSessionRecord {
  sessionId: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

interface AuthFile {
  version: number;
  users: AuthUserRecord[];
  sessions: AuthSessionRecord[];
}

export interface AuthSessionView {
  token: string;
  expiresAt: string;
  user: {
    userId: string;
    email: string;
    role: AuthRole;
  };
}

export interface AuthAuthenticatedUser {
  userId: string;
  email: string;
  role: AuthRole;
  sessionId: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function validEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length < 6 || email.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(value: string): boolean {
  if (value.length < 10 || value.length > 120) return false;
  const hasLetter = /[a-zA-Z]/.test(value);
  const hasNumber = /[0-9]/.test(value);
  return hasLetter && hasNumber;
}

export class LocalAuthStore {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly filePath: string;
  private readonly sessionTtlMs: number;

  public constructor(filePath: string, options?: { sessionTtlHours?: number }) {
    this.filePath = path.resolve(filePath);
    const ttlHours = Math.max(1, Math.min(24 * 30, Math.floor(options?.sessionTtlHours ?? 72)));
    this.sessionTtlMs = ttlHours * 60 * 60 * 1000;
  }

  public async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
      await this.pruneExpiredSessions();
    } catch {
      await this.write({
        version: 1,
        users: [],
        sessions: []
      });
    }
  }

  public async signup(input: { email: string; password: string; roleHint?: AuthRole }): Promise<AuthSessionView> {
    const email = normalizeEmail(input.email);
    const password = input.password;
    if (!validEmail(email)) {
      throw new Error("A valid email address is required.");
    }
    if (!validPassword(password)) {
      throw new Error("Password must be 10-120 chars and include letters and numbers.");
    }

    return this.withLock(async () => {
      const current = await this.read();
      if (current.users.some((user) => user.email === email)) {
        throw new Error("An account with this email already exists.");
      }
      const now = new Date().toISOString();
      const passwordHash = await bcrypt.hash(password, 12);
      const user: AuthUserRecord = {
        userId: `user_${randomUUID()}`,
        email,
        passwordHash,
        role: current.users.length === 0 ? "owner" : input.roleHint ?? "member",
        createdAt: now,
        updatedAt: now
      };
      current.users.push(user);
      const session = this.createSessionRecord(user.userId, now);
      const token = this.createToken();
      session.tokenHash = sha256(token);
      current.sessions.push(session);
      user.lastLoginAt = now;
      await this.write(current);
      return {
        token,
        expiresAt: session.expiresAt,
        user: {
          userId: user.userId,
          email: user.email,
          role: user.role
        }
      };
    });
  }

  public async signin(input: { email: string; password: string }): Promise<AuthSessionView> {
    const email = normalizeEmail(input.email);
    const password = input.password;
    if (!validEmail(email)) {
      throw new Error("Invalid email or password.");
    }
    return this.withLock(async () => {
      const current = await this.read();
      const user = current.users.find((row) => row.email === email);
      if (!user) {
        throw new Error("Invalid email or password.");
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        throw new Error("Invalid email or password.");
      }
      const now = new Date().toISOString();
      user.lastLoginAt = now;
      user.updatedAt = now;
      const token = this.createToken();
      const session = this.createSessionRecord(user.userId, now);
      session.tokenHash = sha256(token);
      current.sessions.push(session);
      await this.write(current);
      return {
        token,
        expiresAt: session.expiresAt,
        user: {
          userId: user.userId,
          email: user.email,
          role: user.role
        }
      };
    });
  }

  public async authenticateToken(token: string): Promise<AuthAuthenticatedUser | null> {
    const normalized = token.trim();
    if (!normalized) return null;
    return this.withLock(async () => {
      const current = await this.read();
      const tokenHash = sha256(normalized);
      const nowMs = Date.now();
      const session = current.sessions.find((row) => row.tokenHash === tokenHash && !row.revokedAt);
      if (!session) {
        return null;
      }
      if (new Date(session.expiresAt).getTime() <= nowMs) {
        session.revokedAt = new Date(nowMs).toISOString();
        await this.write(current);
        return null;
      }
      const user = current.users.find((row) => row.userId === session.userId);
      if (!user) {
        session.revokedAt = new Date(nowMs).toISOString();
        await this.write(current);
        return null;
      }
      session.updatedAt = new Date(nowMs).toISOString();
      await this.write(current);
      return {
        userId: user.userId,
        email: user.email,
        role: user.role,
        sessionId: session.sessionId
      };
    });
  }

  public async logout(token: string): Promise<boolean> {
    const normalized = token.trim();
    if (!normalized) return false;
    return this.withLock(async () => {
      const current = await this.read();
      const tokenHash = sha256(normalized);
      const session = current.sessions.find((row) => row.tokenHash === tokenHash && !row.revokedAt);
      if (!session) {
        return false;
      }
      session.revokedAt = new Date().toISOString();
      session.updatedAt = session.revokedAt;
      await this.write(current);
      return true;
    });
  }

  public async pruneExpiredSessions(): Promise<void> {
    await this.withLock(async () => {
      const current = await this.read();
      const nowMs = Date.now();
      current.sessions = current.sessions.filter((row) => {
        if (row.revokedAt) return false;
        return new Date(row.expiresAt).getTime() > nowMs;
      });
      await this.write(current);
    });
  }

  private createSessionRecord(userId: string, createdAtIso: string): AuthSessionRecord {
    return {
      sessionId: `sess_${randomUUID()}`,
      userId,
      tokenHash: "",
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      expiresAt: new Date(new Date(createdAtIso).getTime() + this.sessionTtlMs).toISOString()
    };
  }

  private createToken(): string {
    return randomBytes(40).toString("base64url");
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChain;
    let release: () => void = () => undefined;
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async read(): Promise<AuthFile> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthFile>;
    return {
      version: Number(parsed.version ?? 1),
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    };
  }

  private async write(file: AuthFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }
}


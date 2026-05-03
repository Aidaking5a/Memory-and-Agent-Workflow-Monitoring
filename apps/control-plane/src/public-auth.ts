import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PublicAuthRole = "owner" | "member";

interface PublicAuthUser {
  userId: string;
  email: string;
  passwordHash: string;
  role: PublicAuthRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

interface PublicSession {
  sessionId: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

interface PublicAuthFile {
  version: number;
  users: PublicAuthUser[];
  sessions: PublicSession[];
}

export interface PublicAuthSessionPayload {
  token: string;
  expiresAt: string;
  user: {
    userId: string;
    email: string;
    role: PublicAuthRole;
  };
}

export interface PublicAuthUserView {
  userId: string;
  email: string;
  role: PublicAuthRole;
  sessionId: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length < 6 || email.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(value: string): boolean {
  if (value.length < 10 || value.length > 120) return false;
  return /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
}

export class PublicAuthStore {
  private readonly filePath: string;
  private readonly sessionTtlMs: number;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(filePath: string, options?: { sessionTtlHours?: number }) {
    this.filePath = path.resolve(filePath);
    const ttlHours = Math.max(1, Math.min(24 * 30, Math.floor(options?.sessionTtlHours ?? 96)));
    this.sessionTtlMs = ttlHours * 60 * 60 * 1000;
  }

  public async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
      await this.pruneExpired();
    } catch {
      await this.write({
        version: 1,
        users: [],
        sessions: []
      });
    }
  }

  public async signup(emailRaw: string, password: string): Promise<PublicAuthSessionPayload> {
    const email = normalizeEmail(emailRaw);
    if (!validEmail(email)) throw new Error("A valid email is required.");
    if (!validPassword(password)) throw new Error("Password must be 10-120 chars with letters and numbers.");

    return this.withLock(async () => {
      const current = await this.read();
      if (current.users.some((entry) => entry.email === email)) {
        throw new Error("An account already exists for this email.");
      }
      const now = new Date().toISOString();
      const user: PublicAuthUser = {
        userId: `user_${randomUUID()}`,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: current.users.length === 0 ? "owner" : "member",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now
      };
      current.users.push(user);
      const token = randomBytes(40).toString("base64url");
      const session = this.createSession(user.userId, now, hash(token));
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

  public async signin(emailRaw: string, password: string): Promise<PublicAuthSessionPayload> {
    const email = normalizeEmail(emailRaw);
    if (!validEmail(email)) throw new Error("Invalid email or password.");
    return this.withLock(async () => {
      const current = await this.read();
      const user = current.users.find((entry) => entry.email === email);
      if (!user) throw new Error("Invalid email or password.");
      const passwordOk = await bcrypt.compare(password, user.passwordHash);
      if (!passwordOk) throw new Error("Invalid email or password.");
      const now = new Date().toISOString();
      user.updatedAt = now;
      user.lastLoginAt = now;
      const token = randomBytes(40).toString("base64url");
      const session = this.createSession(user.userId, now, hash(token));
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

  public async authenticateToken(tokenRaw: string): Promise<PublicAuthUserView | null> {
    const token = tokenRaw.trim();
    if (!token) return null;
    return this.withLock(async () => {
      const current = await this.read();
      const tokenHash = hash(token);
      const nowMs = Date.now();
      const session = current.sessions.find((entry) => entry.tokenHash === tokenHash && !entry.revokedAt);
      if (!session) return null;
      if (new Date(session.expiresAt).getTime() <= nowMs) {
        session.revokedAt = new Date(nowMs).toISOString();
        await this.write(current);
        return null;
      }
      const user = current.users.find((entry) => entry.userId === session.userId);
      if (!user) return null;
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

  public async logout(tokenRaw: string): Promise<boolean> {
    const token = tokenRaw.trim();
    if (!token) return false;
    return this.withLock(async () => {
      const current = await this.read();
      const tokenHash = hash(token);
      const session = current.sessions.find((entry) => entry.tokenHash === tokenHash && !entry.revokedAt);
      if (!session) return false;
      session.revokedAt = new Date().toISOString();
      session.updatedAt = session.revokedAt;
      await this.write(current);
      return true;
    });
  }

  private createSession(userId: string, createdAtIso: string, tokenHash: string): PublicSession {
    return {
      sessionId: `sess_${randomUUID()}`,
      userId,
      tokenHash,
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
      expiresAt: new Date(new Date(createdAtIso).getTime() + this.sessionTtlMs).toISOString()
    };
  }

  private async pruneExpired(): Promise<void> {
    await this.withLock(async () => {
      const current = await this.read();
      const nowMs = Date.now();
      current.sessions = current.sessions.filter((entry) => !entry.revokedAt && new Date(entry.expiresAt).getTime() > nowMs);
      await this.write(current);
    });
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

  private async read(): Promise<PublicAuthFile> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PublicAuthFile>;
    return {
      version: Number(parsed.version ?? 1),
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    };
  }

  private async write(data: PublicAuthFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}


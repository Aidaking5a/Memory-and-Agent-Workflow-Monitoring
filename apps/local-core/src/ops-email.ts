import nodemailer from "nodemailer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type OpsEmailStatus = "sent" | "queued_local" | "failed";

export interface OpsEmailRecord {
  messageId: string;
  createdAt: string;
  to: string;
  subject: string;
  status: OpsEmailStatus;
  reason: string;
  lastError?: string;
}

interface OpsEmailFile {
  records: OpsEmailRecord[];
}

function readText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function safeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function id(): string {
  return `mail_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function emailConfig() {
  const host = readText(process.env.SMTP_HOST) ?? readText(process.env.THEIA_SMTP_HOST);
  const port = safeInt(process.env.SMTP_PORT ?? process.env.THEIA_SMTP_PORT, 587);
  const user = readText(process.env.SMTP_USER) ?? readText(process.env.THEIA_SMTP_USER);
  const pass = readText(process.env.SMTP_PASS) ?? readText(process.env.THEIA_SMTP_PASS);
  const from = readText(process.env.SMTP_FROM) ?? readText(process.env.THEIA_SMTP_FROM) ?? "alerts@theia.local";
  const secureRaw = readText(process.env.SMTP_SECURE) ?? readText(process.env.THEIA_SMTP_SECURE);
  const secure = secureRaw ? ["1", "true", "yes", "on"].includes(secureRaw.toLowerCase()) : false;
  return {
    host,
    port,
    user,
    pass,
    from,
    secure
  };
}

export class OpsEmailNotifier {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  public async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await this.write({ records: [] });
    }
  }

  public async send(input: { to: string; subject: string; text: string }): Promise<OpsEmailRecord> {
    const now = new Date().toISOString();
    const cfg = emailConfig();
    if (!cfg.host) {
      return this.record({
        messageId: id(),
        createdAt: now,
        to: input.to,
        subject: input.subject,
        status: "queued_local",
        reason: "SMTP host not configured. Stored in local queue."
      });
    }
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined
      });
      await transporter.sendMail({
        from: cfg.from,
        to: input.to,
        subject: input.subject,
        text: input.text
      });
      return this.record({
        messageId: id(),
        createdAt: now,
        to: input.to,
        subject: input.subject,
        status: "sent",
        reason: "SMTP delivery succeeded."
      });
    } catch (error) {
      return this.record({
        messageId: id(),
        createdAt: now,
        to: input.to,
        subject: input.subject,
        status: "failed",
        reason: "SMTP delivery failed.",
        lastError: error instanceof Error ? error.message : "Unknown SMTP error"
      });
    }
  }

  public async listRecent(limit = 100): Promise<OpsEmailRecord[]> {
    const file = await this.read();
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
    return [...file.records]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, bounded);
  }

  private async record(entry: OpsEmailRecord): Promise<OpsEmailRecord> {
    return this.withLock(async () => {
      const current = await this.read();
      current.records.push(entry);
      current.records = current.records
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-3000);
      await this.write(current);
      return entry;
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

  private async read(): Promise<OpsEmailFile> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<OpsEmailFile>;
    return {
      records: Array.isArray(parsed.records) ? parsed.records : []
    };
  }

  private async write(file: OpsEmailFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }
}


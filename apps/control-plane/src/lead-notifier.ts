import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import type { LeadRecord } from "./leads-store.js";

export type LeadDeliveryStatus = "sent" | "queued_local" | "failed";

export interface LeadDeliveryRecord {
  deliveryId: string;
  createdAt: string;
  leadId: string;
  leadEmail: string;
  submissionCount: number;
  status: LeadDeliveryStatus;
  targetEmail: string;
  transport: "smtp" | "local_queue";
  reason: string;
  attempts: number;
  lastError?: string;
}

interface DeliveryFile {
  deliveries: LeadDeliveryRecord[];
}

interface LeadNotifierConfig {
  enabled: boolean;
  targetEmail: string;
  fromEmail: string;
  subjectPrefix: string;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPassword?: string;
}

function readText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function safeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function leadDeliveryId(): string {
  return `delivery_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function notifierConfig(): LeadNotifierConfig {
  const enabled = readBoolean(process.env.THEIA_LEADS_NOTIFY_ENABLED) ?? true;
  const targetEmail = readText(process.env.THEIA_LEADS_NOTIFY_TO) ?? "windsurf345@outlook.com";
  return {
    enabled,
    targetEmail,
    fromEmail: readText(process.env.THEIA_LEADS_NOTIFY_FROM) ?? "alerts@theia.local",
    subjectPrefix: readText(process.env.THEIA_LEADS_NOTIFY_SUBJECT_PREFIX) ?? "[THEIA LEAD]",
    smtpHost: readText(process.env.THEIA_LEADS_NOTIFY_SMTP_HOST),
    smtpPort: safeInt(process.env.THEIA_LEADS_NOTIFY_SMTP_PORT, 587),
    smtpSecure: readBoolean(process.env.THEIA_LEADS_NOTIFY_SMTP_SECURE) ?? false,
    smtpUser: readText(process.env.THEIA_LEADS_NOTIFY_SMTP_USER),
    smtpPassword: readText(process.env.THEIA_LEADS_NOTIFY_SMTP_PASSWORD)
  };
}

export interface LeadDeliveryReport {
  total: number;
  sent: number;
  queuedLocal: number;
  failed: number;
  latest?: LeadDeliveryRecord;
}

export interface LeadNotifierConfigView {
  enabled: boolean;
  targetEmail: string;
  fromEmail: string;
  subjectPrefix: string;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpConfigured: boolean;
  smtpPasswordConfigured: boolean;
}

export interface LeadNotifierVerification {
  ok: boolean;
  targetEmail: string;
  mode: "disabled" | "queue_only" | "smtp";
  message: string;
}

export class LeadNotifier {
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
      await this.write({ deliveries: [] });
    }
  }

  public async listRecent(limit = 80): Promise<LeadDeliveryRecord[]> {
    const data = await this.read();
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 80;
    return [...data.deliveries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, bounded);
  }

  public async report(): Promise<LeadDeliveryReport> {
    const deliveries = await this.read();
    const sent = deliveries.deliveries.filter((row) => row.status === "sent").length;
    const queuedLocal = deliveries.deliveries.filter((row) => row.status === "queued_local").length;
    const failed = deliveries.deliveries.filter((row) => row.status === "failed").length;
    const latest = [...deliveries.deliveries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return {
      total: deliveries.deliveries.length,
      sent,
      queuedLocal,
      failed,
      latest
    };
  }

  public getConfigView(): LeadNotifierConfigView {
    const config = notifierConfig();
    return {
      enabled: config.enabled,
      targetEmail: config.targetEmail,
      fromEmail: config.fromEmail,
      subjectPrefix: config.subjectPrefix,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpSecure: config.smtpSecure,
      smtpUser: config.smtpUser,
      smtpConfigured: Boolean(config.smtpHost),
      smtpPasswordConfigured: Boolean(config.smtpPassword)
    };
  }

  public async verifyTransport(): Promise<LeadNotifierVerification> {
    const config = notifierConfig();
    if (!config.enabled) {
      return {
        ok: false,
        targetEmail: config.targetEmail,
        mode: "disabled",
        message: "Lead notifier is disabled by THEIA_LEADS_NOTIFY_ENABLED=false."
      };
    }
    if (!config.smtpHost) {
      return {
        ok: false,
        targetEmail: config.targetEmail,
        mode: "queue_only",
        message: "SMTP host is not configured. Leads will be queued locally."
      };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword ?? "" } : undefined
      });
      await transporter.verify();
      return {
        ok: true,
        targetEmail: config.targetEmail,
        mode: "smtp",
        message: "SMTP connection verified and ready for delivery."
      };
    } catch (error) {
      return {
        ok: false,
        targetEmail: config.targetEmail,
        mode: "smtp",
        message: error instanceof Error ? error.message : "SMTP verification failed."
      };
    }
  }

  public async sendTestDelivery(initiatedBy?: string): Promise<LeadDeliveryRecord> {
    const now = new Date().toISOString();
    const fakeLead: LeadRecord = {
      leadId: `lead_test_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      lastSubmittedAt: now,
      submissionCount: 1,
      status: "new",
      name: "SMTP Test Delivery",
      email: "test@theia.local",
      role: "Theia Operator",
      environment: `This is a manual delivery test triggered by ${initiatedBy ?? "unknown-operator"}.`,
      company: "Theia Internal",
      sourcePage: "/dashboard",
      notes: []
    };
    return this.notifyLead(fakeLead);
  }

  public async notifyLead(lead: LeadRecord): Promise<LeadDeliveryRecord> {
    const config = notifierConfig();
    const now = new Date().toISOString();

    if (!config.enabled) {
      return this.record({
        deliveryId: leadDeliveryId(),
        createdAt: now,
        leadId: lead.leadId,
        leadEmail: lead.email,
        submissionCount: lead.submissionCount,
        status: "queued_local",
        targetEmail: config.targetEmail,
        transport: "local_queue",
        reason: "Lead notification disabled by THEIA_LEADS_NOTIFY_ENABLED=false.",
        attempts: 0
      });
    }

    if (!config.smtpHost) {
      return this.record({
        deliveryId: leadDeliveryId(),
        createdAt: now,
        leadId: lead.leadId,
        leadEmail: lead.email,
        submissionCount: lead.submissionCount,
        status: "queued_local",
        targetEmail: config.targetEmail,
        transport: "local_queue",
        reason: "SMTP not configured. Stored locally for operator follow-up.",
        attempts: 0
      });
    }

    try {
      await this.sendSmtpMail({
        to: config.targetEmail,
        subject: `${config.subjectPrefix} ${lead.submissionCount > 1 ? "Updated" : "New"}: ${lead.name}`,
        text: [
          "Theia lead submission received.",
          `Lead ID: ${lead.leadId}`,
          `Status: ${lead.status}`,
          `Name: ${lead.name}`,
          `Email: ${lead.email}`,
          `Company: ${lead.company ?? "-"}`,
          `Role: ${lead.role}`,
          `Submission count: ${lead.submissionCount}`,
          `Source page: ${lead.sourcePage ?? "-"}`,
          `Origin: ${lead.origin ?? "-"}`,
          `Submitted by user: ${lead.submittedByEmail ?? lead.email}`,
          `Submitted at: ${lead.lastSubmittedAt}`,
          "",
          "Environment details:",
          lead.environment
        ].join("\n")
      });
      return this.record({
        deliveryId: leadDeliveryId(),
        createdAt: now,
        leadId: lead.leadId,
        leadEmail: lead.email,
        submissionCount: lead.submissionCount,
        status: "sent",
        targetEmail: config.targetEmail,
        transport: "smtp",
        reason: "SMTP delivery succeeded.",
        attempts: 1
      });
    } catch (error) {
      return this.record({
        deliveryId: leadDeliveryId(),
        createdAt: now,
        leadId: lead.leadId,
        leadEmail: lead.email,
        submissionCount: lead.submissionCount,
        status: "failed",
        targetEmail: config.targetEmail,
        transport: "smtp",
        reason: "SMTP delivery failed.",
        attempts: 1,
        lastError: error instanceof Error ? error.message : "Unknown SMTP error"
      });
    }
  }

  public async notifySubmitter(lead: LeadRecord, userEmail: string): Promise<LeadDeliveryRecord> {
    const config = notifierConfig();
    const now = new Date().toISOString();
    if (!config.enabled) {
      return this.record({
        deliveryId: leadDeliveryId(),
        createdAt: now,
        leadId: lead.leadId,
        leadEmail: userEmail,
        submissionCount: lead.submissionCount,
        status: "queued_local",
        targetEmail: userEmail,
        transport: "local_queue",
        reason: "Submitter confirmation queued because notifier is disabled.",
        attempts: 0
      });
    }
    if (!config.smtpHost) {
      return this.record({
        deliveryId: leadDeliveryId(),
        createdAt: now,
        leadId: lead.leadId,
        leadEmail: userEmail,
        submissionCount: lead.submissionCount,
        status: "queued_local",
        targetEmail: userEmail,
        transport: "local_queue",
        reason: "Submitter confirmation queued locally because SMTP is not configured.",
        attempts: 0
      });
    }
    try {
      await this.sendSmtpMail({
        to: userEmail,
        subject: `[THEIA] Submission received (${lead.leadId})`,
        text: [
          "Your Theia application request was received successfully.",
          `Lead ID: ${lead.leadId}`,
          `Status: ${lead.status}`,
          `Submitted at: ${lead.lastSubmittedAt}`,
          "",
          "What happens next:",
          "1) We review your environment profile.",
          "2) We confirm connector and trust-boundary scope.",
          "3) We send follow-up onboarding actions."
        ].join("\n")
      });
      return this.record({
        deliveryId: leadDeliveryId(),
        createdAt: now,
        leadId: lead.leadId,
        leadEmail: userEmail,
        submissionCount: lead.submissionCount,
        status: "sent",
        targetEmail: userEmail,
        transport: "smtp",
        reason: "Submitter confirmation email sent.",
        attempts: 1
      });
    } catch (error) {
      return this.record({
        deliveryId: leadDeliveryId(),
        createdAt: now,
        leadId: lead.leadId,
        leadEmail: userEmail,
        submissionCount: lead.submissionCount,
        status: "failed",
        targetEmail: userEmail,
        transport: "smtp",
        reason: "Submitter confirmation email failed.",
        attempts: 1,
        lastError: error instanceof Error ? error.message : "Unknown SMTP error"
      });
    }
  }

  private async sendSmtpMail(input: { to: string; subject: string; text: string }): Promise<void> {
    const config = notifierConfig();
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword ?? "" } : undefined
    });
    await transporter.sendMail({
      from: config.fromEmail,
      to: input.to,
      subject: input.subject,
      text: input.text
    });
  }

  private async record(entry: LeadDeliveryRecord): Promise<LeadDeliveryRecord> {
    return this.withLock(async () => {
      const current = await this.read();
      current.deliveries.push(entry);
      current.deliveries = [...current.deliveries]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-2500);
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

  private async read(): Promise<DeliveryFile> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DeliveryFile>;
    return { deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [] };
  }

  private async write(file: DeliveryFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }
}

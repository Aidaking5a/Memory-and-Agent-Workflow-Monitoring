import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type LeadStatus = "new" | "contacted" | "qualified" | "closed_won" | "closed_lost" | "spam";

export interface LeadRecord {
  leadId: string;
  createdAt: string;
  updatedAt: string;
  lastSubmittedAt: string;
  submissionCount: number;
  status: LeadStatus;
  name: string;
  email: string;
  role: string;
  environment: string;
  company?: string;
  sourcePage?: string;
  origin?: string;
  referrer?: string;
  userAgent?: string;
  ipHash?: string;
  notes: string[];
}

interface LeadFile {
  leads: LeadRecord[];
}

export interface LeadUpsertInput {
  name: string;
  email: string;
  role: string;
  environment: string;
  company?: string;
  sourcePage?: string;
  origin?: string;
  referrer?: string;
  userAgent?: string;
  ipHash?: string;
  markAsSpam?: boolean;
}

export interface LeadListQuery {
  limit: number;
  status?: LeadStatus;
  search?: string;
}

export interface LeadReport {
  total: number;
  byStatus: Record<LeadStatus, number>;
  newLast7Days: number;
  updatedLast24Hours: number;
}

const DEFAULT_BY_STATUS: Record<LeadStatus, number> = {
  new: 0,
  contacted: 0,
  qualified: 0,
  closed_won: 0,
  closed_lost: 0,
  spam: 0
};

function isLeadStatus(value: string): value is LeadStatus {
  return ["new", "contacted", "qualified", "closed_won", "closed_lost", "spam"].includes(value);
}

function safeText(input: string | undefined, fallback = ""): string {
  if (!input) return fallback;
  return input.trim();
}

function normalizeEmail(email: string): string {
  return safeText(email).toLowerCase();
}

export class LeadsStore {
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
      await this.write({ leads: [] });
    }
  }

  public async upsertLead(input: LeadUpsertInput): Promise<{ lead: LeadRecord; isNew: boolean }> {
    return this.withLock(async () => {
      const current = await this.read();
      const now = new Date().toISOString();
      const email = normalizeEmail(input.email);

      const existing = current.leads.find((lead) => lead.email === email);
      if (existing) {
        existing.updatedAt = now;
        existing.lastSubmittedAt = now;
        existing.submissionCount += 1;
        existing.name = safeText(input.name, existing.name);
        existing.role = safeText(input.role, existing.role);
        existing.environment = safeText(input.environment, existing.environment);
        existing.company = safeText(input.company, existing.company ?? "");
        existing.sourcePage = safeText(input.sourcePage, existing.sourcePage ?? "");
        existing.origin = safeText(input.origin, existing.origin ?? "");
        existing.referrer = safeText(input.referrer, existing.referrer ?? "");
        existing.userAgent = safeText(input.userAgent, existing.userAgent ?? "");
        existing.ipHash = safeText(input.ipHash, existing.ipHash ?? "");
        if (input.markAsSpam) {
          existing.status = "spam";
        }
        await this.write(current);
        return { lead: existing, isNew: false };
      }

      const lead: LeadRecord = {
        leadId: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        createdAt: now,
        updatedAt: now,
        lastSubmittedAt: now,
        submissionCount: 1,
        status: input.markAsSpam ? "spam" : "new",
        name: safeText(input.name),
        email,
        role: safeText(input.role),
        environment: safeText(input.environment),
        company: safeText(input.company),
        sourcePage: safeText(input.sourcePage),
        origin: safeText(input.origin),
        referrer: safeText(input.referrer),
        userAgent: safeText(input.userAgent),
        ipHash: safeText(input.ipHash),
        notes: []
      };
      current.leads.push(lead);
      await this.write(current);
      return { lead, isNew: true };
    });
  }

  public async updateStatus(leadId: string, status: LeadStatus, note?: string): Promise<LeadRecord | null> {
    return this.withLock(async () => {
      const current = await this.read();
      const lead = current.leads.find((entry) => entry.leadId === leadId);
      if (!lead) {
        return null;
      }
      lead.status = status;
      lead.updatedAt = new Date().toISOString();
      if (note && note.trim().length > 0) {
        lead.notes.push(note.trim());
      }
      await this.write(current);
      return lead;
    });
  }

  public async list(query: LeadListQuery): Promise<LeadRecord[]> {
    const current = await this.read();
    const limit = Number.isFinite(query.limit) ? Math.max(1, Math.min(500, Math.floor(query.limit))) : 100;
    const search = safeText(query.search).toLowerCase();

    return [...current.leads]
      .filter((lead) => (query.status ? lead.status === query.status : true))
      .filter((lead) => {
        if (!search) return true;
        const text = `${lead.name} ${lead.email} ${lead.role} ${lead.company ?? ""} ${lead.environment}`.toLowerCase();
        return text.includes(search);
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }

  public async report(): Promise<LeadReport> {
    const current = await this.read();
    const byStatus: Record<LeadStatus, number> = { ...DEFAULT_BY_STATUS };
    const nowMs = Date.now();
    const last7Days = nowMs - 7 * 24 * 60 * 60 * 1000;
    const last24Hours = nowMs - 24 * 60 * 60 * 1000;

    let newLast7Days = 0;
    let updatedLast24Hours = 0;

    for (const lead of current.leads) {
      if (isLeadStatus(lead.status)) {
        byStatus[lead.status] += 1;
      }

      if (new Date(lead.createdAt).getTime() >= last7Days) {
        newLast7Days += 1;
      }
      if (new Date(lead.updatedAt).getTime() >= last24Hours) {
        updatedLast24Hours += 1;
      }
    }

    return {
      total: current.leads.length,
      byStatus,
      newLast7Days,
      updatedLast24Hours
    };
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

  private async read(): Promise<LeadFile> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LeadFile>;
    return {
      leads: Array.isArray(parsed.leads) ? parsed.leads : []
    };
  }

  private async write(data: LeadFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}

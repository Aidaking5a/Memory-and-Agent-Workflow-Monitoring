import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LoginEvent {
  eventId: string;
  timestamp: string;
  provider: "saml" | "dev";
  userId: string;
  email?: string;
  displayName?: string;
}

interface LoginMetricsFile {
  events: LoginEvent[];
}

export interface LoginVolumePoint {
  date: string;
  count: number;
}

export interface LoginVolumeReport {
  totalLogins: number;
  uniqueUsers: number;
  lastLoginAt?: string;
  points: LoginVolumePoint[];
}

export class LoginMetricsStore {
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  public async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await this.write({ events: [] });
    }
  }

  public async record(event: Omit<LoginEvent, "eventId">): Promise<LoginEvent> {
    const current = await this.read();
    const next: LoginEvent = {
      ...event,
      eventId: `login_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    };
    current.events.push(next);
    await this.write(current);
    return next;
  }

  public async report(days: number): Promise<LoginVolumeReport> {
    const current = await this.read();
    const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.floor(days))) : 30;

    const now = new Date();
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - (safeDays - 1));
    from.setUTCHours(0, 0, 0, 0);

    const points = new Map<string, number>();
    for (let i = 0; i < safeDays; i += 1) {
      const date = new Date(from);
      date.setUTCDate(from.getUTCDate() + i);
      const key = date.toISOString().slice(0, 10);
      points.set(key, 0);
    }

    const filtered = current.events.filter((event) => new Date(event.timestamp).getTime() >= from.getTime());

    for (const event of filtered) {
      const key = event.timestamp.slice(0, 10);
      if (!points.has(key)) continue;
      points.set(key, (points.get(key) ?? 0) + 1);
    }

    const uniqueUsers = new Set(filtered.map((event) => event.userId));

    return {
      totalLogins: filtered.length,
      uniqueUsers: uniqueUsers.size,
      lastLoginAt: filtered.length > 0 ? filtered[filtered.length - 1]?.timestamp : undefined,
      points: [...points.entries()].map(([date, count]) => ({ date, count }))
    };
  }

  public async listRecent(limit = 25): Promise<LoginEvent[]> {
    const current = await this.read();
    return [...current.events]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, Math.max(1, Math.min(500, limit)));
  }

  private async read(): Promise<LoginMetricsFile> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LoginMetricsFile>;
    return {
      events: Array.isArray(parsed.events) ? parsed.events : []
    };
  }

  private async write(data: LoginMetricsFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}
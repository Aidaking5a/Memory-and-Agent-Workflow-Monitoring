import { createHash, randomBytes, randomUUID } from "node:crypto";

export type TelemetrySeverity = "info" | "low" | "medium" | "high" | "critical";
export type TelemetryStatus = "ok" | "degraded" | "failed" | "stopped" | "waiting";

export interface TelemetryPairingRecord {
  pairingId: string;
  label: string;
  tokenHash: string;
  userId: string;
  userEmail: string;
  sessionId?: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface TelemetryPairingView {
  pairingId: string;
  label: string;
  userId: string;
  userEmail: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  active: boolean;
}

export interface TelemetryRawEvent {
  eventId?: unknown;
  sessionId?: unknown;
  runId?: unknown;
  agentId?: unknown;
  taskId?: unknown;
  eventType?: unknown;
  status?: unknown;
  message?: unknown;
  timestamp?: unknown;
  source?: unknown;
  severity?: unknown;
  confidence?: unknown;
  metadata?: unknown;
  memorySummary?: unknown;
  logSummary?: unknown;
}

export interface TelemetryIngestBody {
  events?: unknown;
  source?: unknown;
}

export interface TelemetryMemoryLogSummary {
  summaryId: string;
  fileKind: "memory.md" | "bootstrap.md" | "session-log" | "other";
  filePathHint: string;
  changeType: "created" | "updated" | "appended";
  section?: string;
  lineDelta?: number;
  hash?: string;
  extractedSignals: string[];
}

export interface TelemetryEventRecord {
  id: string;
  pairingId: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  sessionId?: string;
  runId: string;
  agentId: string;
  taskId?: string;
  eventType: string;
  status: TelemetryStatus;
  message: string;
  timestamp: string;
  source: "openclaw-hook" | "openclaw-plugin" | "openclaw-tool";
  severity: TelemetrySeverity;
  confidence: number;
  metadata: Record<string, unknown>;
  memorySummary?: TelemetryMemoryLogSummary;
  logSummary?: TelemetryMemoryLogSummary;
  signatureVersion: "v1";
  dedupeKey: string;
  ingestedAt: string;
}

export interface TelemetryHubState {
  pairings: TelemetryPairingRecord[];
  events: TelemetryEventRecord[];
  metrics?: Partial<TelemetryMetrics>;
}

export interface TelemetryMetrics {
  requestsAccepted: number;
  requestsRejected: number;
  eventsAccepted: number;
  eventsRejected: number;
  dedupedEvents: number;
  lastIngestAt?: string;
  lastRejectAt?: string;
  lastRejectReason?: string;
}

interface IngestPairingContext {
  pairingId: string;
  userId: string;
  userEmail: string;
  sessionId?: string;
}

interface TelemetryHubConfig {
  workspaceId: string;
  retentionMs: number;
  maxEvents: number;
  maxPairings: number;
  maxPayloadBytes: number;
  maxEventsPerRequest: number;
  dedupeWindowMs: number;
}

interface ValidationIssue {
  code: string;
  message: string;
}

export interface IngestRequestResult {
  ok: boolean;
  statusCode: number;
  message: string;
  acceptedEvents: TelemetryEventRecord[];
  acceptedCount: number;
  rejectedCount: number;
  dedupedCount: number;
  issues: ValidationIssue[];
}

export interface TelemetryHealthSnapshot {
  activePairings: number;
  totalPairings: number;
  eventCount: number;
  latestEventAt?: string;
  metrics: TelemetryMetrics;
}

type TelemetrySubscriber = (record: TelemetryEventRecord) => void;

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clamp(input: number): number {
  return Math.max(0, Math.min(1, input));
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashDedupe(parts: string[]): string {
  return sha256(parts.join("|"));
}

function normalizePathHint(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "unknown";
  return trimmed
    .replace(/[A-Za-z]:\\Users\\[^\\]+/gi, "<USER_HOME>")
    .replace(/\/home\/[^/]+/gi, "<USER_HOME>")
    .replace(/\/Users\/[^/]+/gi, "<USER_HOME>");
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeMessage(value: unknown, maxLength = 420): string {
  const raw = readString(value) ?? "OpenClaw activity event";
  const normalized = raw
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z]:\\Users\\[^\\]+/gi, "<USER_HOME>")
    .replace(/\/home\/[^/]+/gi, "<USER_HOME>")
    .replace(/\/Users\/[^/]+/gi, "<USER_HOME>")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactStringValue(input: string): string {
  if (/^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+$/.test(input)) return "[REDACTED_JWT]";
  if (/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(input)) return "[REDACTED_BEARER]";
  if (/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(input)) return "[REDACTED_TOKEN]";
  if (/AKIA[0-9A-Z]{16}/.test(input)) return "[REDACTED_KEY]";
  return input
    .replace(/[A-Za-z]:\\Users\\[^\\]+/gi, "<USER_HOME>")
    .replace(/\/home\/[^/]+/gi, "<USER_HOME>")
    .replace(/\/Users\/[^/]+/gi, "<USER_HOME>");
}

function redactMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const redacted = redactStringValue(value);
    return redacted.length > 1000 ? `${redacted.slice(0, 997)}...` : redacted;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => redactMetadata(item, depth + 1));
  }
  if (!isObject(value)) {
    return String(value);
  }

  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.length > 120) continue;
    if (shouldRedactMetadataKey(key, raw)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = redactMetadata(raw, depth + 1);
  }
  return result;
}

function shouldRedactMetadataKey(key: string, value: unknown): boolean {
  const normalized = key.toLowerCase();
  if (["inputtokens", "outputtokens", "prompttokens", "completiontokens", "totaltokens"].includes(normalized)) {
    return false;
  }
  if (normalized === "tokens" && (typeof value === "number" || (typeof value === "string" && Number.isFinite(Number(value))))) {
    return false;
  }
  if (normalized === "tokenusage" && value && typeof value === "object") {
    return false;
  }
  return /(token|secret|password|authorization|api[_-]?key|cookie)/i.test(key);
}

function normalizeSeverity(value: unknown): TelemetrySeverity {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low" || normalized === "info") {
    return normalized;
  }
  return "info";
}

function normalizeStatus(value: unknown): TelemetryStatus {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "ok" || normalized === "degraded" || normalized === "failed" || normalized === "stopped" || normalized === "waiting") {
    return normalized;
  }
  if (normalized === "error") return "failed";
  if (normalized === "offline") return "degraded";
  return "ok";
}

function normalizeSource(value: unknown): "openclaw-hook" | "openclaw-plugin" | "openclaw-tool" {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "openclaw-hook" || normalized === "openclaw-plugin" || normalized === "openclaw-tool") {
    return normalized;
  }
  if (normalized?.includes("plugin")) return "openclaw-plugin";
  if (normalized?.includes("tool")) return "openclaw-tool";
  return "openclaw-hook";
}

function parseSummary(kind: "memory" | "log", value: unknown): TelemetryMemoryLogSummary | undefined {
  if (!isObject(value)) return undefined;
  const filePath = readString(value.filePath) ?? readString(value.path);
  if (!filePath) return undefined;
  const kindValue = readString(value.fileKind)?.toLowerCase();
  const fileKind: TelemetryMemoryLogSummary["fileKind"] =
    kindValue === "memory.md" || kindValue === "bootstrap.md" || kindValue === "session-log" || kindValue === "other"
      ? kindValue
      : filePath.toLowerCase().endsWith("memory.md")
        ? "memory.md"
        : filePath.toLowerCase().endsWith("bootstrap.md")
          ? "bootstrap.md"
          : kind === "log"
            ? "session-log"
            : "other";
  const change = readString(value.changeType)?.toLowerCase();
  const changeType: TelemetryMemoryLogSummary["changeType"] =
    change === "created" || change === "updated" || change === "appended" ? change : "updated";
  const lineDelta = readNumber(value.lineDelta);
  const extractedSignals = Array.isArray(value.extractedSignals)
    ? value.extractedSignals.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry)).slice(0, 16)
    : [];
  return {
    summaryId: `summary_${randomUUID()}`,
    fileKind,
    filePathHint: normalizePathHint(filePath),
    changeType,
    section: readString(value.section),
    lineDelta: typeof lineDelta === "number" ? Math.floor(lineDelta) : undefined,
    hash: readString(value.hash),
    extractedSignals
  };
}

function normalizeEventType(value: unknown, fallbackText: string): string {
  const explicit = readString(value)?.trim();
  if (explicit) {
    const normalized = explicit.toLowerCase();
    if (normalized === "agent.connected" || normalized === "agent.activity") return "task.updated";
    if (normalized === "task.progress") return "task.updated";
    if (normalized === "memory.updated") return "memory.changed";
    if (normalized === "log.updated") return "checkpoint.created";
    if (normalized === "gateway.disconnected") return "run.failed";
    if (normalized === "run.stopped") return "run.failed";
    return explicit.length > 120 ? explicit.slice(0, 120) : explicit;
  }
  const text = fallbackText.toLowerCase();
  if (text.includes("memory") && text.includes("update")) return "memory.changed";
  if (text.includes("memory") && text.includes("read")) return "memory.read";
  if (text.includes("tool") && text.includes("start")) return "tool_call.started";
  if (text.includes("tool") && (text.includes("complete") || text.includes("result") || text.includes("success"))) {
    return "tool_call.completed";
  }
  if (text.includes("tool") && (text.includes("error") || text.includes("fail"))) return "tool_call.failed";
  if (text.includes("task") && text.includes("complete")) return "task.completed";
  if (text.includes("task")) return "task.updated";
  if (text.includes("stop")) return "run.failed";
  if (text.includes("fail") || text.includes("error")) return "run.failed";
  return "task.updated";
}

function computeDedupeKey(input: {
  pairingId: string;
  eventType: string;
  runId: string;
  agentId: string;
  timestamp: string;
  message: string;
}): string {
  return hashDedupe([input.pairingId, input.eventType, input.runId, input.agentId, input.timestamp.slice(0, 19), input.message.slice(0, 220)]);
}

export class OpenClawTelemetryHub {
  private readonly config: TelemetryHubConfig;
  private readonly pairings = new Map<string, TelemetryPairingRecord>();
  private readonly events: TelemetryEventRecord[] = [];
  private readonly dedupeSeen = new Map<string, number>();
  private readonly subscribers = new Set<TelemetrySubscriber>();
  private readonly requestRate = new Map<string, number[]>();
  private metrics: TelemetryMetrics = {
    requestsAccepted: 0,
    requestsRejected: 0,
    eventsAccepted: 0,
    eventsRejected: 0,
    dedupedEvents: 0
  };

  public constructor(config: Partial<TelemetryHubConfig> & Pick<TelemetryHubConfig, "workspaceId">) {
    this.config = {
      workspaceId: config.workspaceId,
      retentionMs: config.retentionMs ?? 7 * 24 * 60 * 60 * 1000,
      maxEvents: config.maxEvents ?? 4000,
      maxPairings: config.maxPairings ?? 80,
      maxPayloadBytes: config.maxPayloadBytes ?? 128 * 1024,
      maxEventsPerRequest: config.maxEventsPerRequest ?? 200,
      dedupeWindowMs: config.dedupeWindowMs ?? 20_000
    };
  }

  public createPairing(input: {
    label?: string;
    userId: string;
    userEmail: string;
    sessionId?: string;
    ttlHours?: number;
  }): { pairing: TelemetryPairingRecord; token: string } {
    this.prune();
    const now = Date.now();
    const ttlHours = Math.max(1, Math.min(168, Math.floor(input.ttlHours ?? 24)));
    const token = randomBytes(36).toString("base64url");
    const pairing: TelemetryPairingRecord = {
      pairingId: `pair_${randomUUID()}`,
      label: sanitizeMessage(input.label ?? "OpenClaw pairing", 90),
      tokenHash: sha256(token),
      userId: input.userId,
      userEmail: input.userEmail,
      sessionId: input.sessionId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlHours * 60 * 60 * 1000).toISOString()
    };
    this.pairings.set(pairing.pairingId, pairing);
    this.enforcePairingLimit();
    return { pairing, token };
  }

  public listPairings(): TelemetryPairingView[] {
    this.prune();
    return [...this.pairings.values()]
      .map((pairing) => ({
        pairingId: pairing.pairingId,
        label: pairing.label,
        userId: pairing.userId,
        userEmail: pairing.userEmail,
        createdAt: pairing.createdAt,
        expiresAt: pairing.expiresAt,
        lastUsedAt: pairing.lastUsedAt,
        revokedAt: pairing.revokedAt,
        revokedBy: pairing.revokedBy,
        active: this.isPairingActive(pairing)
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public revokePairing(pairingId: string, actorId: string): boolean {
    const pairing = this.pairings.get(pairingId);
    if (!pairing) return false;
    pairing.revokedAt = nowIso();
    pairing.revokedBy = actorId;
    this.pairings.set(pairingId, pairing);
    return true;
  }

  public authenticatePairing(input: { token?: string; pairingId?: string }): IngestPairingContext | undefined {
    this.prune();
    const token = readString(input.token);
    if (!token) return undefined;
    const tokenHash = sha256(token);
    const candidates = input.pairingId ? [this.pairings.get(input.pairingId)].filter(Boolean) : [...this.pairings.values()];
    const match = candidates.find((pairing) => pairing && pairing.tokenHash === tokenHash && this.isPairingActive(pairing));
    if (!match) return undefined;
    match.lastUsedAt = nowIso();
    this.pairings.set(match.pairingId, match);
    return {
      pairingId: match.pairingId,
      userId: match.userId,
      userEmail: match.userEmail,
      sessionId: match.sessionId
    };
  }

  public ingest(input: {
    pairing: IngestPairingContext;
    body: TelemetryIngestBody;
    requestRateKey: string;
    now?: Date;
  }): IngestRequestResult {
    const now = input.now ?? new Date();
    this.prune(now.getTime());
    const bodyBytes = Buffer.byteLength(JSON.stringify(input.body ?? {}), "utf8");
    if (bodyBytes > this.config.maxPayloadBytes) {
      return this.reject("Payload exceeds telemetry size limit.", "payload_too_large", 413);
    }
    if (!this.consumeRequestRate(input.requestRateKey, now.getTime())) {
      return this.reject("Telemetry rate limit exceeded. Retry shortly.", "rate_limited", 429);
    }

    const body = input.body ?? {};
    const rawEvents = Array.isArray(body.events)
      ? body.events
      : isObject(body.events)
        ? [body.events]
        : Array.isArray(body as unknown as unknown[])
          ? (body as unknown as unknown[])
          : [];

    if (rawEvents.length === 0) {
      return this.reject("No telemetry events provided.", "events_required", 400);
    }
    if (rawEvents.length > this.config.maxEventsPerRequest) {
      return this.reject(
        `Too many telemetry events in one request. Maximum is ${this.config.maxEventsPerRequest}.`,
        "events_limit",
        400
      );
    }

    const sourceHint = normalizeSource((isObject(body.source) ? body.source.system : body.source) ?? "openclaw-hook");
    const accepted: TelemetryEventRecord[] = [];
    const issues: ValidationIssue[] = [];
    let rejectedCount = 0;
    let dedupedCount = 0;

    for (let idx = 0; idx < rawEvents.length; idx += 1) {
      const row = rawEvents[idx];
      if (!isObject(row)) {
        rejectedCount += 1;
        issues.push({ code: "invalid_event", message: `Event at index ${idx} is not a JSON object.` });
        continue;
      }
      const parsed = this.normalizeRawEvent(row, input.pairing, sourceHint, now);
      if (!parsed.ok) {
        rejectedCount += 1;
        issues.push({ code: parsed.code, message: `Event at index ${idx}: ${parsed.message}` });
        continue;
      }
      if (this.isDuplicate(parsed.record.dedupeKey, now.getTime())) {
        dedupedCount += 1;
        continue;
      }
      accepted.push(parsed.record);
      this.events.push(parsed.record);
      this.publish(parsed.record);
    }

    this.enforceEventLimit();
    this.metrics.requestsAccepted += 1;
    this.metrics.eventsAccepted += accepted.length;
    this.metrics.eventsRejected += rejectedCount;
    this.metrics.dedupedEvents += dedupedCount;
    this.metrics.lastIngestAt = now.toISOString();
    if (rejectedCount > 0 && accepted.length === 0) {
      this.metrics.lastRejectAt = now.toISOString();
      this.metrics.lastRejectReason = issues[0]?.message;
    }

    return {
      ok: true,
      statusCode: 202,
      message:
        accepted.length > 0
          ? `Accepted ${accepted.length} telemetry event(s).`
          : dedupedCount > 0
            ? "No new telemetry events. Duplicate payload suppressed."
            : "No valid telemetry events accepted.",
      acceptedEvents: accepted,
      acceptedCount: accepted.length,
      rejectedCount,
      dedupedCount,
      issues
    };
  }

  public history(limit = 120): TelemetryEventRecord[] {
    this.prune();
    const normalizedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return [...this.events]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, normalizedLimit);
  }

  public health(): TelemetryHealthSnapshot {
    this.prune();
    const pairings = this.listPairings();
    const activePairings = pairings.filter((entry) => entry.active).length;
    return {
      activePairings,
      totalPairings: pairings.length,
      eventCount: this.events.length,
      latestEventAt: this.events.length > 0 ? this.events[this.events.length - 1]?.timestamp : undefined,
      metrics: { ...this.metrics }
    };
  }

  public subscribe(listener: TelemetrySubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  public exportState(): TelemetryHubState {
    this.prune();
    return {
      pairings: [...this.pairings.values()],
      events: [...this.events],
      metrics: { ...this.metrics }
    };
  }

  public restoreState(state: unknown): void {
    if (!isObject(state)) return;
    if (Array.isArray(state.pairings)) {
      for (const row of state.pairings) {
        if (!isObject(row)) continue;
        const pairingId = readString(row.pairingId);
        const tokenHash = readString(row.tokenHash);
        const userId = readString(row.userId);
        const userEmail = readString(row.userEmail);
        const createdAt = readString(row.createdAt);
        const expiresAt = readString(row.expiresAt);
        if (!pairingId || !tokenHash || !userId || !userEmail || !createdAt || !expiresAt) continue;
        this.pairings.set(pairingId, {
          pairingId,
          tokenHash,
          label: sanitizeMessage(row.label ?? "OpenClaw pairing", 90),
          userId,
          userEmail,
          sessionId: readString(row.sessionId),
          createdAt,
          expiresAt,
          lastUsedAt: readString(row.lastUsedAt),
          revokedAt: readString(row.revokedAt),
          revokedBy: readString(row.revokedBy)
        });
      }
    }
    if (Array.isArray(state.events)) {
      for (const row of state.events) {
        if (!isObject(row)) continue;
        const id = readString(row.id);
        const pairingId = readString(row.pairingId);
        const workspaceId = readString(row.workspaceId);
        const userId = readString(row.userId);
        const userEmail = readString(row.userEmail);
        const runId = readString(row.runId);
        const agentId = readString(row.agentId);
        const eventType = readString(row.eventType);
        const status = normalizeStatus(row.status);
        const message = sanitizeMessage(row.message);
        const timestamp = readString(row.timestamp);
        const source = normalizeSource(row.source);
        const severity = normalizeSeverity(row.severity);
        const confidence = clamp(readNumber(row.confidence) ?? 0.75);
        const dedupeKey = readString(row.dedupeKey);
        const ingestedAt = readString(row.ingestedAt);
        if (!id || !pairingId || !workspaceId || !userId || !userEmail || !runId || !agentId || !eventType || !timestamp || !dedupeKey || !ingestedAt) {
          continue;
        }
        this.events.push({
          id,
          pairingId,
          workspaceId,
          userId,
          userEmail,
          sessionId: readString(row.sessionId),
          runId,
          agentId,
          taskId: readString(row.taskId),
          eventType,
          status,
          message,
          timestamp,
          source,
          severity,
          confidence,
          metadata: isObject(row.metadata) ? (redactMetadata(row.metadata) as Record<string, unknown>) : {},
          memorySummary: parseSummary("memory", row.memorySummary),
          logSummary: parseSummary("log", row.logSummary),
          signatureVersion: "v1",
          dedupeKey,
          ingestedAt
        });
      }
    }
    if (isObject(state.metrics)) {
      this.metrics = {
        requestsAccepted: Math.max(0, Math.floor(readNumber(state.metrics.requestsAccepted) ?? this.metrics.requestsAccepted)),
        requestsRejected: Math.max(0, Math.floor(readNumber(state.metrics.requestsRejected) ?? this.metrics.requestsRejected)),
        eventsAccepted: Math.max(0, Math.floor(readNumber(state.metrics.eventsAccepted) ?? this.metrics.eventsAccepted)),
        eventsRejected: Math.max(0, Math.floor(readNumber(state.metrics.eventsRejected) ?? this.metrics.eventsRejected)),
        dedupedEvents: Math.max(0, Math.floor(readNumber(state.metrics.dedupedEvents) ?? this.metrics.dedupedEvents)),
        lastIngestAt: readString(state.metrics.lastIngestAt) ?? this.metrics.lastIngestAt,
        lastRejectAt: readString(state.metrics.lastRejectAt) ?? this.metrics.lastRejectAt,
        lastRejectReason: readString(state.metrics.lastRejectReason) ?? this.metrics.lastRejectReason
      };
    }
    this.prune();
  }

  private normalizeRawEvent(
    raw: TelemetryRawEvent,
    pairing: IngestPairingContext,
    sourceHint: "openclaw-hook" | "openclaw-plugin" | "openclaw-tool",
    now: Date
  ):
    | { ok: true; record: TelemetryEventRecord }
    | { ok: false; code: string; message: string } {
    const message = sanitizeMessage(raw.message ?? raw.eventType ?? raw.status ?? "OpenClaw event");
    const timestampInput = readString(raw.timestamp);
    const parsedTs = timestampInput ? new Date(timestampInput) : now;
    if (!Number.isFinite(parsedTs.getTime())) {
      return { ok: false, code: "invalid_timestamp", message: "timestamp must be a valid ISO date string." };
    }
    const timestamp = parsedTs.toISOString();
    const eventType = normalizeEventType(raw.eventType, message);
    const runId = readString(raw.runId) ?? readString(raw.sessionId) ?? "run:openclaw";
    const agentId = readString(raw.agentId) ?? "agent:openclaw";
    const confidence = clamp(readNumber(raw.confidence) ?? 0.78);
    const source = normalizeSource(raw.source ?? sourceHint);
    const severity = normalizeSeverity(raw.severity);
    const status = normalizeStatus(raw.status);
    const metadata = isObject(raw.metadata) ? (redactMetadata(raw.metadata) as Record<string, unknown>) : {};
    const memorySummary = parseSummary("memory", raw.memorySummary);
    const logSummary = parseSummary("log", raw.logSummary);
    const dedupeKey = computeDedupeKey({
      pairingId: pairing.pairingId,
      eventType,
      runId,
      agentId,
      timestamp,
      message
    });
    return {
      ok: true,
      record: {
        id: readString(raw.eventId) ?? `tlm_${randomUUID()}`,
        pairingId: pairing.pairingId,
        workspaceId: this.config.workspaceId,
        userId: pairing.userId,
        userEmail: pairing.userEmail,
        sessionId: readString(raw.sessionId) ?? pairing.sessionId,
        runId,
        agentId,
        taskId: readString(raw.taskId),
        eventType,
        status,
        message,
        timestamp,
        source,
        severity,
        confidence,
        metadata,
        memorySummary,
        logSummary,
        signatureVersion: "v1",
        dedupeKey,
        ingestedAt: now.toISOString()
      }
    };
  }

  private reject(message: string, code: string, statusCode: number): IngestRequestResult {
    this.metrics.requestsRejected += 1;
    this.metrics.lastRejectAt = nowIso();
    this.metrics.lastRejectReason = message;
    return {
      ok: false,
      statusCode,
      message,
      acceptedEvents: [],
      acceptedCount: 0,
      rejectedCount: 0,
      dedupedCount: 0,
      issues: [{ code, message }]
    };
  }

  private consumeRequestRate(key: string, nowMs: number): boolean {
    const windowMs = 15_000;
    const maxRequests = 60;
    const existing = this.requestRate.get(key) ?? [];
    const recent = existing.filter((value) => nowMs - value <= windowMs);
    if (recent.length >= maxRequests) {
      this.requestRate.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.requestRate.set(key, recent);
    if (this.requestRate.size > 3000) {
      for (const [candidate, timestamps] of this.requestRate.entries()) {
        const filtered = timestamps.filter((value) => nowMs - value <= windowMs);
        if (filtered.length === 0) {
          this.requestRate.delete(candidate);
        } else {
          this.requestRate.set(candidate, filtered);
        }
      }
    }
    return true;
  }

  private isPairingActive(pairing: TelemetryPairingRecord): boolean {
    if (pairing.revokedAt) return false;
    return new Date(pairing.expiresAt).getTime() > Date.now();
  }

  private isDuplicate(key: string, nowMs: number): boolean {
    const seenAt = this.dedupeSeen.get(key);
    if (typeof seenAt === "number" && nowMs - seenAt <= this.config.dedupeWindowMs) {
      return true;
    }
    this.dedupeSeen.set(key, nowMs);
    return false;
  }

  private enforcePairingLimit(): void {
    if (this.pairings.size <= this.config.maxPairings) return;
    const sorted = [...this.pairings.values()].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    while (sorted.length > this.config.maxPairings) {
      const candidate = sorted.shift();
      if (!candidate) break;
      this.pairings.delete(candidate.pairingId);
    }
  }

  private enforceEventLimit(): void {
    if (this.events.length <= this.config.maxEvents) return;
    const excess = this.events.length - this.config.maxEvents;
    if (excess > 0) {
      this.events.splice(0, excess);
    }
  }

  private publish(record: TelemetryEventRecord): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(record);
      } catch {
        // Ignore individual subscriber failures.
      }
    }
  }

  private prune(nowMs = Date.now()): void {
    const cutoff = nowMs - this.config.retentionMs;
    if (this.events.length > 0) {
      const filtered = this.events.filter((event) => {
        const ts = new Date(event.timestamp).getTime();
        return Number.isFinite(ts) && ts >= cutoff;
      });
      if (filtered.length !== this.events.length) {
        this.events.length = 0;
        this.events.push(...filtered);
      }
    }
    for (const [pairingId, pairing] of this.pairings.entries()) {
      const expiresAt = new Date(pairing.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
        this.pairings.delete(pairingId);
      }
    }
    for (const [dedupeKey, seenAt] of this.dedupeSeen.entries()) {
      if (nowMs - seenAt > this.config.dedupeWindowMs * 3) {
        this.dedupeSeen.delete(dedupeKey);
      }
    }
  }
}

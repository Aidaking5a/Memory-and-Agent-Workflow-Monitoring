
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import nodemailer from "nodemailer";
import type { Severity, WorkflowEvent } from "@theia/event-schema";

export type HighRiskSeverity = Extract<Severity, "medium" | "high" | "critical">;
export type HighRiskCategory =
  | "privileged_escalation"
  | "destructive_mutation"
  | "credential_exposure"
  | "data_exfiltration"
  | "policy_bypass"
  | "production_write"
  | "autonomous_external_side_effect"
  | "repeated_privileged_loop";
export type NotificationChannel = "in_app_banner" | "email" | "webhook";
export type NotificationDeliveryStatus = "queued" | "retrying" | "sent" | "failed" | "suppressed";
export type NotificationRecordStatus = "open" | "acknowledged" | "resolved";
export type DedupeStatus =
  | "dispatched"
  | "filtered_threshold"
  | "suppressed_dedupe"
  | "suppressed_cooldown"
  | "suppressed_rate_limit"
  | "quiet_hours"
  | "disabled";

export interface HighRiskTaxonomyRule {
  category: HighRiskCategory;
  label: string;
  trigger: string;
  defaultSeverity: HighRiskSeverity;
}

export interface HighRiskNotificationSettings {
  enabled: boolean;
  minimumSeverity: HighRiskSeverity;
  minimumConfidence: number;
  dedupeWindowSeconds: number;
  cooldownSeconds: number;
  antiSpamWindowSeconds: number;
  maxNotificationsPerWindow: number;
  channels: {
    inAppBanner: boolean;
    email: boolean;
    webhook: boolean;
  };
  quietHours: {
    enabled: boolean;
    startLocal: string;
    endLocal: string;
    allowCritical: boolean;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  routing: {
    defaultRecipients: string[];
    criticalRecipients: string[];
  };
  escalation: {
    enabled: boolean;
    severityAtLeast: "high" | "critical";
    afterMinutes: number;
    additionalRecipients: string[];
    escalateToWebhook: boolean;
  };
  email: {
    fromAddress: string;
    smtpHost?: string;
    smtpPort: number;
    secure: boolean;
    smtpUsername?: string;
    smtpPassword?: string;
    connectTimeoutMs: number;
    subjectPrefix: string;
  };
  webhook: {
    url?: string;
    bearerToken?: string;
    timeoutMs: number;
  };
  slo: {
    p95DispatchTargetMs: number;
  };
}

export interface HighRiskNotificationSettingsInput {
  enabled?: boolean;
  minimumSeverity?: HighRiskSeverity;
  minimumConfidence?: number;
  dedupeWindowSeconds?: number;
  cooldownSeconds?: number;
  antiSpamWindowSeconds?: number;
  maxNotificationsPerWindow?: number;
  channels?: Partial<HighRiskNotificationSettings["channels"]>;
  quietHours?: Partial<HighRiskNotificationSettings["quietHours"]>;
  retry?: Partial<HighRiskNotificationSettings["retry"]>;
  routing?: Partial<HighRiskNotificationSettings["routing"]>;
  escalation?: Partial<HighRiskNotificationSettings["escalation"]>;
  email?: Partial<Omit<HighRiskNotificationSettings["email"], "smtpPassword">> & {
    smtpPassword?: string;
  };
  webhook?: Partial<Omit<HighRiskNotificationSettings["webhook"], "bearerToken">> & {
    bearerToken?: string;
  };
  slo?: Partial<HighRiskNotificationSettings["slo"]>;
}

export interface HighRiskNotificationSettingsView {
  enabled: boolean;
  minimumSeverity: HighRiskSeverity;
  minimumConfidence: number;
  dedupeWindowSeconds: number;
  cooldownSeconds: number;
  antiSpamWindowSeconds: number;
  maxNotificationsPerWindow: number;
  channels: HighRiskNotificationSettings["channels"];
  quietHours: HighRiskNotificationSettings["quietHours"];
  retry: HighRiskNotificationSettings["retry"];
  routing: HighRiskNotificationSettings["routing"];
  escalation: HighRiskNotificationSettings["escalation"];
  email: Omit<HighRiskNotificationSettings["email"], "smtpPassword"> & {
    configured: boolean;
    hasPassword: boolean;
  };
  webhook: Omit<HighRiskNotificationSettings["webhook"], "bearerToken"> & {
    configured: boolean;
    hasBearerToken: boolean;
  };
  slo: HighRiskNotificationSettings["slo"];
}

export interface NotificationChannelState {
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  attempts: number;
  queuedAt?: string;
  lastAttemptAt?: string;
  sentAt?: string;
  latencyMs?: number;
  lastError?: string;
  nextRetryAt?: string;
}

export interface HighRiskNotificationRecord {
  notificationId: string;
  riskId: string;
  sourceEventId: string;
  sourceEventType: WorkflowEvent["eventType"];
  category: HighRiskCategory;
  severity: HighRiskSeverity;
  confidence: number;
  triggerRule: string;
  title: string;
  explanation: string;
  recommendedNextAction: string;
  dedupeStatus: DedupeStatus;
  suppressionReason?: string;
  agentId: string;
  runId: string;
  affectedResource?: string;
  toolName?: string;
  occurredAt: string;
  detectedAt: string;
  status: NotificationRecordStatus;
  acknowledgedAt?: string;
  resolvedAt?: string;
  escalatedAt?: string;
  channels: NotificationChannelState[];
  signals: string[];
  firstDispatchedAt?: string;
  firstDispatchLatencyMs?: number;
  pipeline: Array<{
    stage: string;
    at: string;
    detail: string;
  }>;
}

export interface HighRiskDeliveryAttempt {
  attemptId: string;
  notificationId: string;
  channel: NotificationChannel;
  attempt: number;
  status: NotificationDeliveryStatus;
  queuedAt: string;
  completedAt: string;
  latencyMs: number;
  error?: string;
  reason: "initial" | "retry" | "escalation";
}

export interface HighRiskHistoryFilter {
  q?: string;
  severity?: HighRiskSeverity;
  status?: NotificationRecordStatus;
  channel?: NotificationChannel;
  dedupeStatus?: DedupeStatus;
  limit?: number;
}

export interface HighRiskSloSummary {
  targetP95Ms: number;
  measuredP95Ms: number;
  measuredP50Ms: number;
  sampleSize: number;
  withinTarget: boolean;
  lastDispatchAt?: string;
  queueDepth: number;
  failedDeliveryCount24h: number;
}

export interface HighRiskPipelineSummary {
  detected: number;
  dispatched: number;
  suppressed: number;
  suppressedBreakdown: Record<DedupeStatus, number>;
  averageDetectionMs: number;
  p95DetectionMs: number;
}

export interface HighRiskEngineState {
  settings: HighRiskNotificationSettings;
  records: HighRiskNotificationRecord[];
  attempts: HighRiskDeliveryAttempt[];
  dedupeCache: Record<string, number>;
  cooldownCache: Record<string, number>;
  dispatchEpochs: number[];
}

interface DetectionSignal {
  category: HighRiskCategory;
  severity: HighRiskSeverity;
  weight: number;
  label: string;
}

interface DetectionResult {
  category: HighRiskCategory;
  severity: HighRiskSeverity;
  confidence: number;
  triggerRule: string;
  title: string;
  explanation: string;
  recommendedNextAction: string;
  signals: DetectionSignal[];
  affectedResource?: string;
  toolName?: string;
}

interface DispatchJob {
  notificationId: string;
  channel: Exclude<NotificationChannel, "in_app_banner">;
  attempt: number;
  scheduledAt: number;
  reason: "initial" | "retry" | "escalation";
  overrideRecipients?: string[];
}

interface EngineOptions {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  onMutation?: () => void;
}

const TAXONOMY: HighRiskTaxonomyRule[] = [
  {
    category: "privileged_escalation",
    label: "Privileged Escalation",
    trigger: "Privileged actions executed or attempted without clear approval context.",
    defaultSeverity: "critical"
  },
  {
    category: "destructive_mutation",
    label: "Destructive Mutation",
    trigger: "File-system, database, or infrastructure destructive commands detected.",
    defaultSeverity: "critical"
  },
  {
    category: "credential_exposure",
    label: "Credential Exposure",
    trigger: "Secret, credential, token, or key extraction patterns detected.",
    defaultSeverity: "high"
  },
  {
    category: "data_exfiltration",
    label: "Data Exfiltration",
    trigger: "Bulk export or external transmission of sensitive context detected.",
    defaultSeverity: "high"
  },
  {
    category: "policy_bypass",
    label: "Policy Bypass",
    trigger: "Denied approvals followed by override/bypass behavior.",
    defaultSeverity: "high"
  },
  {
    category: "production_write",
    label: "Production Write Action",
    trigger: "Production environment write mutation detected.",
    defaultSeverity: "high"
  },
  {
    category: "autonomous_external_side_effect",
    label: "Autonomous Side Effect",
    trigger: "Autonomous external action executed without explicit operator gate.",
    defaultSeverity: "high"
  },
  {
    category: "repeated_privileged_loop",
    label: "Repeated Privileged Loop",
    trigger: "Repeated privileged attempts indicate unstable automation behavior.",
    defaultSeverity: "medium"
  }
];

const RISK_RESOURCE_KEYS = ["targetPath", "filePath", "path", "resource", "url", "endpoint", "target", "db", "database"];
const TOOL_KEYS = ["tool", "toolName", "tool_name", "action", "command", "operation"];
const ACTIVE_BANNER_WINDOW_MS = 10 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(ordered.length - 1, Math.ceil(quantile * ordered.length) - 1));
  return ordered[index] ?? 0;
}

function severityRank(severity: HighRiskSeverity): number {
  if (severity === "critical") return 3;
  if (severity === "high") return 2;
  return 1;
}

function deriveSeverity(signals: DetectionSignal[]): HighRiskSeverity {
  if (signals.some((signal) => signal.severity === "critical")) return "critical";
  if (signals.some((signal) => signal.severity === "high")) return "high";
  return "medium";
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function payloadText(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).toLowerCase();
}

function computeDedupeKey(input: {
  category: HighRiskCategory;
  agentId: string;
  runId: string;
  eventType: string;
  resource?: string;
  tool?: string;
}): string {
  const digest = createHash("sha256")
    .update(`${input.category}|${input.agentId}|${input.runId}|${input.eventType}|${input.resource ?? ""}|${input.tool ?? ""}`)
    .digest("hex");
  return digest.slice(0, 24);
}

function formatTimestamp(value: number): string {
  return new Date(value).toISOString();
}

function toTimeParts(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function inQuietHours(now: Date, quietHours: HighRiskNotificationSettings["quietHours"]): boolean {
  if (!quietHours.enabled) return false;
  const start = toTimeParts(quietHours.startLocal);
  const end = toTimeParts(quietHours.endLocal);
  if (!start || !end) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function trimArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value).trim()).filter((value) => value.length > 0);
}

function hasExternalUrl(payloadLower: string): boolean {
  return /https?:\/\//.test(payloadLower) || payloadLower.includes("ftp://");
}

function defaultSettings(): HighRiskNotificationSettings {
  return {
    enabled: true,
    minimumSeverity: "high",
    minimumConfidence: 0.7,
    dedupeWindowSeconds: 120,
    cooldownSeconds: 90,
    antiSpamWindowSeconds: 300,
    maxNotificationsPerWindow: 14,
    channels: {
      inAppBanner: true,
      email: false,
      webhook: false
    },
    quietHours: {
      enabled: false,
      startLocal: "22:00",
      endLocal: "07:00",
      allowCritical: true
    },
    retry: {
      maxAttempts: 3,
      baseDelayMs: 350,
      maxDelayMs: 2500
    },
    routing: {
      defaultRecipients: [],
      criticalRecipients: []
    },
    escalation: {
      enabled: true,
      severityAtLeast: "critical",
      afterMinutes: 5,
      additionalRecipients: [],
      escalateToWebhook: false
    },
    email: {
      fromAddress: "alerts@theia.local",
      smtpPort: 587,
      secure: false,
      connectTimeoutMs: 7000,
      subjectPrefix: "[THEIA HIGH-RISK]"
    },
    webhook: {
      timeoutMs: 3500
    },
    slo: {
      p95DispatchTargetMs: 1200
    }
  };
}

function mergeSettings(
  current: HighRiskNotificationSettings,
  input: HighRiskNotificationSettingsInput | undefined
): HighRiskNotificationSettings {
  if (!input) {
    return current;
  }

  const next: HighRiskNotificationSettings = {
    ...current,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    minimumSeverity: input.minimumSeverity ?? current.minimumSeverity,
    minimumConfidence:
      typeof input.minimumConfidence === "number" ? clamp(input.minimumConfidence, 0, 1) : current.minimumConfidence,
    dedupeWindowSeconds:
      typeof input.dedupeWindowSeconds === "number"
        ? Math.max(15, Math.round(input.dedupeWindowSeconds))
        : current.dedupeWindowSeconds,
    cooldownSeconds:
      typeof input.cooldownSeconds === "number"
        ? Math.max(0, Math.round(input.cooldownSeconds))
        : current.cooldownSeconds,
    antiSpamWindowSeconds:
      typeof input.antiSpamWindowSeconds === "number"
        ? Math.max(30, Math.round(input.antiSpamWindowSeconds))
        : current.antiSpamWindowSeconds,
    maxNotificationsPerWindow:
      typeof input.maxNotificationsPerWindow === "number"
        ? Math.max(1, Math.round(input.maxNotificationsPerWindow))
        : current.maxNotificationsPerWindow,
    channels: {
      ...current.channels,
      ...(input.channels ?? {})
    },
    quietHours: {
      ...current.quietHours,
      ...(input.quietHours ?? {})
    },
    retry: {
      ...current.retry,
      ...(input.retry ?? {})
    },
    routing: {
      defaultRecipients: input.routing?.defaultRecipients
        ? trimArray(input.routing.defaultRecipients)
        : current.routing.defaultRecipients,
      criticalRecipients: input.routing?.criticalRecipients
        ? trimArray(input.routing.criticalRecipients)
        : current.routing.criticalRecipients
    },
    escalation: {
      ...current.escalation,
      ...(input.escalation ?? {}),
      additionalRecipients: input.escalation?.additionalRecipients
        ? trimArray(input.escalation.additionalRecipients)
        : current.escalation.additionalRecipients
    },
    email: {
      ...current.email,
      ...(input.email ?? {}),
      fromAddress: input.email?.fromAddress?.trim() || current.email.fromAddress,
      smtpHost: input.email?.smtpHost?.trim() || current.email.smtpHost,
      smtpUsername: input.email?.smtpUsername?.trim() || current.email.smtpUsername,
      smtpPassword: typeof input.email?.smtpPassword === "string" ? input.email.smtpPassword : current.email.smtpPassword
    },
    webhook: {
      ...current.webhook,
      ...(input.webhook ?? {}),
      url: input.webhook?.url?.trim() || current.webhook.url,
      bearerToken:
        typeof input.webhook?.bearerToken === "string" ? input.webhook.bearerToken : current.webhook.bearerToken
    },
    slo: {
      ...current.slo,
      ...(input.slo ?? {})
    }
  };

  next.retry.maxAttempts = Math.max(1, Math.round(next.retry.maxAttempts));
  next.retry.baseDelayMs = Math.max(100, Math.round(next.retry.baseDelayMs));
  next.retry.maxDelayMs = Math.max(next.retry.baseDelayMs, Math.round(next.retry.maxDelayMs));
  next.email.smtpPort = Math.max(1, Math.round(next.email.smtpPort));
  next.email.connectTimeoutMs = Math.max(500, Math.round(next.email.connectTimeoutMs));
  next.webhook.timeoutMs = Math.max(500, Math.round(next.webhook.timeoutMs));
  next.slo.p95DispatchTargetMs = Math.max(50, Math.round(next.slo.p95DispatchTargetMs));
  return next;
}

function settingsView(settings: HighRiskNotificationSettings): HighRiskNotificationSettingsView {
  return {
    ...settings,
    email: {
      ...settings.email,
      configured: Boolean(settings.email.smtpHost && settings.email.fromAddress),
      hasPassword: Boolean(settings.email.smtpPassword)
    },
    webhook: {
      ...settings.webhook,
      configured: Boolean(settings.webhook.url),
      hasBearerToken: Boolean(settings.webhook.bearerToken)
    }
  };
}

function keepLast<T>(items: T[], limit: number): T[] {
  return items.length <= limit ? items : items.slice(items.length - limit);
}

function containsAny(input: string, patterns: string[]): boolean {
  return patterns.some((pattern) => input.includes(pattern));
}

function hasCredentialExposureSignal(input: string): boolean {
  const containsCredentialPhrase = containsAny(input, ["password", "private key", "secret", "api key", "access token", "bearer", "credential"]);
  if (!containsCredentialPhrase) return false;
  const containsConcreteSecretShape = /sk-[a-z0-9_-]{8,}|bearer\s+(?!\[redacted)[a-z0-9._~+/=-]{10,}|akia[0-9a-z]{16}/i.test(input);
  if (containsConcreteSecretShape) return true;
  const safeTelemetryContext = containsAny(input, [
    "redacted",
    "masked",
    "token usage",
    "token metric",
    "token count",
    "numeric token",
    "tokens and cost",
    "tokens stay visible"
  ]);
  return !safeTelemetryContext;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function summarizeSignals(signals: DetectionSignal[]): string[] {
  return signals.map((signal) => `${signal.label} (${signal.severity})`);
}

function categoryAction(category: HighRiskCategory): string {
  switch (category) {
    case "privileged_escalation":
      return "Require explicit operator approval and verify least-privilege scope before retrying.";
    case "destructive_mutation":
      return "Pause automation and review destructive command intent with a human reviewer.";
    case "credential_exposure":
      return "Rotate exposed credentials immediately and redact sensitive payload fields.";
    case "data_exfiltration":
      return "Block outbound transfer until destination and data-class policy checks pass.";
    case "policy_bypass":
      return "Investigate denied-approval bypass path and require policy-compliant execution.";
    case "production_write":
      return "Require two-step approval for production writes and validate rollback plan.";
    case "autonomous_external_side_effect":
      return "Enable human gate for external side effects and verify recipient/resource scope.";
    case "repeated_privileged_loop":
      return "Stop repeated privileged loop and inspect planner/tool feedback mismatch.";
    default:
      return "Review event lineage and apply operator safeguards before continuing.";
  }
}

function shouldEscalate(settings: HighRiskNotificationSettings, severity: HighRiskSeverity): boolean {
  if (!settings.escalation.enabled) return false;
  if (settings.escalation.severityAtLeast === "critical") return severity === "critical";
  return severity === "critical" || severity === "high";
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isFileIngestionReplay(record: HighRiskNotificationRecord): boolean {
  return record.runId === "run:file-ingestion" || record.sourceEventId.startsWith("local-file-main:");
}

function isLiveBannerCandidate(record: HighRiskNotificationRecord, nowMs: number): boolean {
  const detectedAt = timestampMs(record.detectedAt);
  if (typeof detectedAt !== "number") return false;
  return (
    record.status === "open" &&
    record.dedupeStatus === "dispatched" &&
    (record.severity === "high" || record.severity === "critical") &&
    record.channels.some((channel) => channel.channel === "in_app_banner" && channel.status === "sent") &&
    nowMs - detectedAt >= 0 &&
    nowMs - detectedAt <= ACTIVE_BANNER_WINDOW_MS &&
    !isFileIngestionReplay(record)
  );
}

function mapCategory(signals: DetectionSignal[]): HighRiskCategory {
  if (signals.length === 0) return "policy_bypass";
  const sorted = [...signals].sort((a, b) => {
    const severityCompare = severityRank(b.severity) - severityRank(a.severity);
    if (severityCompare !== 0) return severityCompare;
    return b.weight - a.weight;
  });
  return sorted[0]?.category ?? "policy_bypass";
}

export class HighRiskNotificationEngine {
  private state: HighRiskEngineState;
  private queue: DispatchJob[] = [];
  private queueRunning = false;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;
  private readonly onMutation?: () => void;

  constructor(initialState?: Partial<HighRiskEngineState>, options?: EngineOptions) {
    this.state = {
      settings: defaultSettings(),
      records: [],
      attempts: [],
      dedupeCache: {},
      cooldownCache: {},
      dispatchEpochs: []
    };
    this.now = options?.now ?? (() => new Date());
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.onMutation = options?.onMutation;
    if (initialState) this.replaceState(initialState);
  }

  replaceState(input: Partial<HighRiskEngineState>): void {
    this.state.settings = mergeSettings(this.state.settings, input.settings);
    this.state.records = Array.isArray(input.records)
      ? keepLast(input.records.filter((record): record is HighRiskNotificationRecord => Boolean(record?.notificationId)), 500)
      : this.state.records;
    this.state.attempts = Array.isArray(input.attempts)
      ? keepLast(input.attempts.filter((attempt): attempt is HighRiskDeliveryAttempt => Boolean(attempt?.attemptId)), 1800)
      : this.state.attempts;
    this.state.dedupeCache = asRecord(input.dedupeCache) as Record<string, number>;
    this.state.cooldownCache = asRecord(input.cooldownCache) as Record<string, number>;
    this.state.dispatchEpochs = Array.isArray(input.dispatchEpochs)
      ? keepLast(input.dispatchEpochs.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0), 800)
      : this.state.dispatchEpochs;
  }

  exportState(): HighRiskEngineState {
    return {
      settings: this.state.settings,
      records: keepLast(this.state.records, 500),
      attempts: keepLast(this.state.attempts, 1800),
      dedupeCache: { ...this.state.dedupeCache },
      cooldownCache: { ...this.state.cooldownCache },
      dispatchEpochs: keepLast(this.state.dispatchEpochs, 800)
    };
  }

  getSettings(): HighRiskNotificationSettingsView {
    return settingsView(this.state.settings);
  }

  updateSettings(input: HighRiskNotificationSettingsInput): HighRiskNotificationSettingsView {
    this.state.settings = mergeSettings(this.state.settings, input);
    this.onMutation?.();
    return this.getSettings();
  }

  getTaxonomy(): HighRiskTaxonomyRule[] {
    return TAXONOMY;
  }

  listHistory(filter?: HighRiskHistoryFilter): HighRiskNotificationRecord[] {
    let rows = [...this.state.records].sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
    if (filter?.severity) rows = rows.filter((row) => row.severity === filter.severity);
    if (filter?.status) rows = rows.filter((row) => row.status === filter.status);
    if (filter?.dedupeStatus) rows = rows.filter((row) => row.dedupeStatus === filter.dedupeStatus);
    if (filter?.channel) rows = rows.filter((row) => row.channels.some((channel) => channel.channel === filter.channel));
    if (filter?.q?.trim()) {
      const q = filter.q.trim().toLowerCase();
      rows = rows.filter((row) =>
        `${row.title} ${row.explanation} ${row.agentId} ${row.runId} ${row.category}`.toLowerCase().includes(q)
      );
    }
    return rows.slice(0, Math.max(1, Math.min(300, Math.round(filter?.limit ?? 120))));
  }

  updateRecordStatus(notificationId: string, status: NotificationRecordStatus): HighRiskNotificationRecord | undefined {
    const record = this.state.records.find((row) => row.notificationId === notificationId);
    if (!record) return undefined;
    const timestamp = this.now().toISOString();
    record.status = status;
    if (status === "acknowledged") record.acknowledgedAt = timestamp;
    if (status === "resolved") record.resolvedAt = timestamp;
    if (status === "open") {
      record.acknowledgedAt = undefined;
      record.resolvedAt = undefined;
    }
    record.pipeline.push({ stage: "operator-status", at: timestamp, detail: `Status updated to ${status}` });
    this.onMutation?.();
    return record;
  }

  getActiveBanner(): HighRiskNotificationRecord | undefined {
    const nowMs = this.now().getTime();
    return [...this.state.records]
      .filter((row) => isLiveBannerCandidate(row, nowMs))
      .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())[0];
  }

  getSloSummary(): HighRiskSloSummary {
    const latencies = this.state.attempts.filter((attempt) => attempt.status === "sent").map((attempt) => attempt.latencyMs);
    const windowStart = this.now().getTime() - 24 * 60 * 60 * 1000;
    const failedDeliveryCount24h = this.state.attempts.filter(
      (attempt) => attempt.status === "failed" && new Date(attempt.completedAt).getTime() >= windowStart
    ).length;
    const measuredP95Ms = Math.round(percentile(latencies, 0.95));
    return {
      targetP95Ms: this.state.settings.slo.p95DispatchTargetMs,
      measuredP95Ms,
      measuredP50Ms: Math.round(percentile(latencies, 0.5)),
      sampleSize: latencies.length,
      withinTarget: latencies.length === 0 ? true : measuredP95Ms <= this.state.settings.slo.p95DispatchTargetMs,
      lastDispatchAt: this.state.attempts.filter((attempt) => attempt.status === "sent").slice(-1)[0]?.completedAt,
      queueDepth: this.queue.length,
      failedDeliveryCount24h
    };
  }

  getPipelineSummary(): HighRiskPipelineSummary {
    const breakdown: Record<DedupeStatus, number> = {
      dispatched: 0,
      filtered_threshold: 0,
      suppressed_dedupe: 0,
      suppressed_cooldown: 0,
      suppressed_rate_limit: 0,
      quiet_hours: 0,
      disabled: 0
    };
    const latencies: number[] = [];
    for (const record of this.state.records) {
      breakdown[record.dedupeStatus] = (breakdown[record.dedupeStatus] ?? 0) + 1;
      if (typeof record.firstDispatchLatencyMs === "number") latencies.push(record.firstDispatchLatencyMs);
    }
    const detected = this.state.records.length;
    const dispatched = breakdown.dispatched;
    return {
      detected,
      dispatched,
      suppressed: Math.max(0, detected - dispatched),
      suppressedBreakdown: breakdown,
      averageDetectionMs: latencies.length > 0 ? Math.round(latencies.reduce((sum, x) => sum + x, 0) / latencies.length) : 0,
      p95DetectionMs: Math.round(percentile(latencies, 0.95))
    };
  }

  ingestEvents(events: WorkflowEvent[]): HighRiskPipelineSummary {
    const items = events.filter((event): event is WorkflowEvent => Boolean(event?.eventId));
    if (items.length === 0) return this.getPipelineSummary();
    for (const event of items) {
      const detection = this.detect(event);
      if (detection) this.registerDetection(event, detection, false);
    }
    void this.flushQueue();
    this.onMutation?.();
    return this.getPipelineSummary();
  }

  async enqueueTestNotification(input?: {
    agentId?: string;
    runId?: string;
    severity?: HighRiskSeverity;
    confidence?: number;
    category?: HighRiskCategory;
    title?: string;
    explanation?: string;
    recommendedNextAction?: string;
  }): Promise<HighRiskNotificationRecord> {
    const nowIso = this.now().toISOString();
    const event: WorkflowEvent = {
      eventId: `theia-test:${randomUUID()}`,
      workspaceId: "ws_local_default",
      runId: input?.runId ?? "run:test-high-risk",
      agentId: input?.agentId ?? "agent:test-high-risk",
      eventType: "privileged_action.executed",
      timestamp: nowIso,
      payload: {
        command: "sudo rm -rf /tmp/theia-test",
        summary: "Synthetic high-risk test action"
      },
      source: {
        connectorId: "theia-local-core",
        objectPath: "test://high-risk"
      },
      confidence: 0.95,
      evidenceRefs: []
    };
    const category = input?.category ?? "privileged_escalation";
    const rule = TAXONOMY.find((entry) => entry.category === category);
    const detection: DetectionResult = {
      category,
      severity: input?.severity ?? "critical",
      confidence: clamp(typeof input?.confidence === "number" ? input.confidence : 0.93, 0, 1),
      triggerRule: rule?.trigger ?? "Synthetic test trigger",
      title: input?.title ?? "Test High-Risk Action",
      explanation:
        input?.explanation ??
        "Synthetic high-risk alert created from notification settings. Use this to validate routing and delivery.",
      recommendedNextAction:
        input?.recommendedNextAction ??
        "Confirm recipients/channels and acknowledge this test alert once delivery is validated.",
      signals: [{ category, severity: input?.severity ?? "critical", weight: 0.95, label: "Synthetic operator test" }],
      toolName: "theia.test.alert",
      affectedResource: "test://high-risk"
    };
    const record = this.registerDetection(event, detection, true);
    await this.flushQueue(1200);
    return record;
  }

  private detect(event: WorkflowEvent): DetectionResult | null {
    const payload = asRecord(event.payload);
    const payloadLower = payloadText(payload);
    const signals: DetectionSignal[] = [];
    const toolName = firstString(payload, TOOL_KEYS);
    const affectedResource = firstString(payload, RISK_RESOURCE_KEYS) ?? event.source.filePath ?? event.source.objectPath;

    if (
      event.eventType === "privileged_action.executed" ||
      event.eventType === "privileged_action.attempted" ||
      containsAny(payloadLower, ["sudo", "root", "admin", "elevated permission", "privileged"])
    ) {
      signals.push({
        category: "privileged_escalation",
        severity: "critical",
        weight: 0.95,
        label: "Privileged action semantics detected"
      });
    }
    if (
      containsAny(payloadLower, [
        "rm -rf",
        "drop table",
        "truncate table",
        "delete from",
        "terraform destroy",
        "kubectl delete",
        "format c:",
        "destroy"
      ])
    ) {
      signals.push({
        category: "destructive_mutation",
        severity: "critical",
        weight: 0.92,
        label: "Destructive mutation command pattern detected"
      });
    }
    if (hasCredentialExposureSignal(payloadLower)) {
      signals.push({
        category: "credential_exposure",
        severity: "high",
        weight: 0.84,
        label: "Credential exposure phrase detected"
      });
    }
    if (hasExternalUrl(payloadLower) && containsAny(payloadLower, ["upload", "export", "send", "webhook", "s3", "bucket", "external"])) {
      signals.push({
        category: "data_exfiltration",
        severity: "high",
        weight: 0.82,
        label: "External transfer signal with outbound destination detected"
      });
    }
    if (event.eventType === "approval.denied" || containsAny(payloadLower, ["bypass", "override", "ignore policy", "without approval", "force"])) {
      signals.push({
        category: "policy_bypass",
        severity: "high",
        weight: 0.78,
        label: "Policy bypass indicator detected"
      });
    }
    if (
      containsAny(payloadLower, ["production", "prod", "live environment"]) &&
      containsAny(payloadLower, ["write", "update", "delete", "migration", "deploy", "apply"])
    ) {
      signals.push({
        category: "production_write",
        severity: "high",
        weight: 0.86,
        label: "Production write mutation pattern detected"
      });
    }
    if (
      containsAny(payloadLower, ["autonomous", "auto-execute", "without human", "hands-off", "background action"]) &&
      containsAny(payloadLower, ["send", "purchase", "post", "webhook", "payment", "delete", "write"])
    ) {
      signals.push({
        category: "autonomous_external_side_effect",
        severity: "high",
        weight: 0.8,
        label: "Autonomous external side effect signal detected"
      });
    }
    const loopCount = this.state.records.filter(
      (record) =>
        record.agentId === event.agentId &&
        record.runId === event.runId &&
        record.category === "privileged_escalation" &&
        new Date(record.detectedAt).getTime() >= this.now().getTime() - 5 * 60 * 1000
    ).length;
    if (loopCount >= 3 && (event.eventType === "privileged_action.attempted" || event.eventType === "privileged_action.executed")) {
      signals.push({
        category: "repeated_privileged_loop",
        severity: "medium",
        weight: 0.68,
        label: "Repeated privileged attempts observed within cooldown window"
      });
    }
    if (signals.length === 0) return null;

    const category = mapCategory(signals);
    const severity = deriveSeverity(signals);
    const eventConfidence = typeof event.confidence === "number" ? clamp(event.confidence, 0, 1) : 0.72;
    const signalConfidence = clamp(signals.reduce((sum, signal) => sum + signal.weight, 0) / signals.length, 0, 1);
    const confidence = clamp(signalConfidence * 0.72 + eventConfidence * 0.28, 0.46, 0.995);
    const rule = TAXONOMY.find((entry) => entry.category === category);
    return {
      category,
      severity,
      confidence,
      triggerRule: rule?.trigger ?? "Risk rule match",
      title: `${rule?.label ?? "High-Risk Action"} (${confidence.toFixed(2)} confidence)`,
      explanation:
        `Detected ${rule?.label ?? category} due to ${summarizeSignals(signals).join("; ")}. ` +
        "This event can produce irreversible side effects or policy violations.",
      recommendedNextAction: categoryAction(category),
      signals,
      affectedResource,
      toolName
    };
  }

  private registerDetection(event: WorkflowEvent, detection: DetectionResult, synthetic: boolean): HighRiskNotificationRecord {
    const settings = this.state.settings;
    const detectedAt = this.now().toISOString();
    const now = this.now().getTime();
    const hasChannel = settings.channels.inAppBanner || settings.channels.email || settings.channels.webhook;
    const pipeline: HighRiskNotificationRecord["pipeline"] = [
      { stage: "ingest", at: detectedAt, detail: synthetic ? "Synthetic test event ingested" : "Workflow event ingested" },
      { stage: "detect", at: detectedAt, detail: detection.triggerRule }
    ];
    let dedupeStatus: DedupeStatus = "dispatched";
    let suppressionReason: string | undefined;
    if (!settings.enabled || !hasChannel) {
      dedupeStatus = "disabled";
      suppressionReason = !settings.enabled ? "High-risk notifications are disabled." : "All channels are disabled.";
    } else if (severityRank(detection.severity) < severityRank(settings.minimumSeverity) || detection.confidence < settings.minimumConfidence) {
      dedupeStatus = "filtered_threshold";
      suppressionReason = "Severity/confidence below configured threshold.";
    } else if (inQuietHours(this.now(), settings.quietHours) && !(settings.quietHours.allowCritical && detection.severity === "critical")) {
      dedupeStatus = "quiet_hours";
      suppressionReason = "Suppressed by quiet-hours policy.";
    }
    const dedupeKey = computeDedupeKey({
      category: detection.category,
      agentId: event.agentId,
      runId: event.runId,
      eventType: event.eventType,
      resource: detection.affectedResource,
      tool: detection.toolName
    });
    const dedupeSeenAt = this.state.dedupeCache[dedupeKey];
    if (dedupeStatus === "dispatched" && typeof dedupeSeenAt === "number" && now - dedupeSeenAt <= settings.dedupeWindowSeconds * 1000) {
      dedupeStatus = "suppressed_dedupe";
      suppressionReason = "Suppressed duplicate high-risk event within dedupe window.";
    }
    const cooldownKey = `${event.agentId}:${detection.category}`;
    const cooldownSeenAt = this.state.cooldownCache[cooldownKey];
    if (dedupeStatus === "dispatched" && typeof cooldownSeenAt === "number" && now - cooldownSeenAt <= settings.cooldownSeconds * 1000) {
      dedupeStatus = "suppressed_cooldown";
      suppressionReason = "Suppressed by per-agent/category cooldown.";
    }
    const antiSpamStart = now - settings.antiSpamWindowSeconds * 1000;
    this.state.dispatchEpochs = this.state.dispatchEpochs.filter((epoch) => epoch >= antiSpamStart);
    if (dedupeStatus === "dispatched" && this.state.dispatchEpochs.length >= settings.maxNotificationsPerWindow) {
      dedupeStatus = "suppressed_rate_limit";
      suppressionReason = "Suppressed by anti-spam rate limit policy.";
    }
    const notificationId = randomUUID();
    const riskId = createHash("sha256")
      .update(`${event.eventId}|${detection.category}|${detection.severity}|${detection.confidence.toFixed(3)}`)
      .digest("hex")
      .slice(0, 18);
    const record: HighRiskNotificationRecord = {
      notificationId,
      riskId,
      sourceEventId: event.eventId,
      sourceEventType: event.eventType,
      category: detection.category,
      severity: detection.severity,
      confidence: detection.confidence,
      triggerRule: detection.triggerRule,
      title: detection.title,
      explanation: detection.explanation,
      recommendedNextAction: detection.recommendedNextAction,
      dedupeStatus,
      suppressionReason,
      agentId: event.agentId,
      runId: event.runId,
      affectedResource: detection.affectedResource,
      toolName: detection.toolName,
      occurredAt: event.timestamp,
      detectedAt,
      status: dedupeStatus === "dispatched" ? "open" : "resolved",
      resolvedAt: dedupeStatus === "dispatched" ? undefined : detectedAt,
      channels: [],
      signals: summarizeSignals(detection.signals),
      pipeline
    };
    if (dedupeStatus === "dispatched") {
      this.state.dedupeCache[dedupeKey] = now;
      this.state.cooldownCache[cooldownKey] = now;
      this.state.dispatchEpochs.push(now);
      record.pipeline.push({ stage: "gate", at: detectedAt, detail: "Passed threshold + dedupe + cooldown + anti-spam" });
      if (settings.channels.inAppBanner) {
        const sentAt = this.now().toISOString();
        const latencyMs = Math.max(1, new Date(sentAt).getTime() - new Date(record.detectedAt).getTime());
        record.channels.push({
          channel: "in_app_banner",
          status: "sent",
          attempts: 1,
          queuedAt: detectedAt,
          lastAttemptAt: sentAt,
          sentAt,
          latencyMs
        });
        record.firstDispatchedAt = sentAt;
        record.firstDispatchLatencyMs = latencyMs;
      }
      if (settings.channels.email) {
        record.channels.push({ channel: "email", status: "queued", attempts: 0, queuedAt: detectedAt });
        this.enqueue({ notificationId, channel: "email", attempt: 1, scheduledAt: now, reason: "initial" });
      }
      if (settings.channels.webhook) {
        record.channels.push({ channel: "webhook", status: "queued", attempts: 0, queuedAt: detectedAt });
        this.enqueue({ notificationId, channel: "webhook", attempt: 1, scheduledAt: now, reason: "initial" });
      }
      if (shouldEscalate(settings, detection.severity)) {
        const delayMs = Math.max(1, settings.escalation.afterMinutes) * 60 * 1000;
        if (settings.channels.email && settings.escalation.additionalRecipients.length > 0) {
          this.enqueue({
            notificationId,
            channel: "email",
            attempt: 1,
            scheduledAt: now + delayMs,
            reason: "escalation",
            overrideRecipients: settings.escalation.additionalRecipients
          });
        }
        if (settings.channels.webhook && settings.escalation.escalateToWebhook) {
          this.enqueue({ notificationId, channel: "webhook", attempt: 1, scheduledAt: now + delayMs, reason: "escalation" });
        }
      }
    } else {
      record.pipeline.push({ stage: "suppressed", at: detectedAt, detail: suppressionReason ?? dedupeStatus });
    }
    this.state.records.push(record);
    this.state.records = keepLast(this.state.records, 500);
    return record;
  }

  private enqueue(job: DispatchJob): void {
    this.queue.push(job);
    this.queue.sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  private async flushQueue(maxWaitMs?: number): Promise<void> {
    if (this.queueRunning) return;
    this.queueRunning = true;
    const deadline = typeof maxWaitMs === "number" ? this.now().getTime() + maxWaitMs : Number.POSITIVE_INFINITY;
    try {
      while (this.queue.length > 0) {
        const job = this.queue[0];
        if (!job) break;
        const now = this.now().getTime();
        if (now > deadline) break;
        if (job.scheduledAt > now) {
          await delay(Math.min(300, job.scheduledAt - now));
          continue;
        }
        this.queue.shift();
        await this.dispatchJob(job);
      }
    } finally {
      this.queueRunning = false;
      this.onMutation?.();
    }
  }

  private async dispatchJob(job: DispatchJob): Promise<void> {
    const record = this.state.records.find((row) => row.notificationId === job.notificationId);
    if (!record) return;
    const channelState = record.channels.find((channel) => channel.channel === job.channel);
    if (!channelState) return;
    const queuedAt = channelState.queuedAt ?? record.detectedAt;
    const attemptAt = this.now().toISOString();
    channelState.lastAttemptAt = attemptAt;
    channelState.attempts = Math.max(channelState.attempts, job.attempt);
    try {
      await this.dispatchChannel(record, job);
      const completedAt = this.now().toISOString();
      const latencyMs = Math.max(1, new Date(completedAt).getTime() - new Date(queuedAt).getTime());
      channelState.status = "sent";
      channelState.sentAt = completedAt;
      channelState.latencyMs = latencyMs;
      channelState.lastError = undefined;
      channelState.nextRetryAt = undefined;
      if (!record.firstDispatchedAt) {
        record.firstDispatchedAt = completedAt;
        record.firstDispatchLatencyMs = latencyMs;
      }
      if (job.reason === "escalation") record.escalatedAt = completedAt;
      record.pipeline.push({ stage: "dispatch", at: completedAt, detail: `${job.channel} delivered (attempt ${job.attempt})` });
      this.state.attempts.push({
        attemptId: randomUUID(),
        notificationId: record.notificationId,
        channel: job.channel,
        attempt: job.attempt,
        status: "sent",
        queuedAt,
        completedAt,
        latencyMs,
        reason: job.reason
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery failed";
      const completedAt = this.now().toISOString();
      const latencyMs = Math.max(1, new Date(completedAt).getTime() - new Date(queuedAt).getTime());
      if (job.attempt < this.state.settings.retry.maxAttempts) {
        const delayMs = Math.min(
          this.state.settings.retry.maxDelayMs,
          this.state.settings.retry.baseDelayMs * 2 ** Math.max(0, job.attempt - 1)
        );
        channelState.status = "retrying";
        channelState.lastError = message;
        channelState.nextRetryAt = new Date(this.now().getTime() + delayMs).toISOString();
        this.enqueue({
          ...job,
          attempt: job.attempt + 1,
          scheduledAt: this.now().getTime() + delayMs,
          reason: "retry"
        });
        this.state.attempts.push({
          attemptId: randomUUID(),
          notificationId: record.notificationId,
          channel: job.channel,
          attempt: job.attempt,
          status: "retrying",
          queuedAt,
          completedAt,
          latencyMs,
          error: message,
          reason: job.reason
        });
      } else {
        channelState.status = "failed";
        channelState.lastError = message;
        channelState.nextRetryAt = undefined;
        this.state.attempts.push({
          attemptId: randomUUID(),
          notificationId: record.notificationId,
          channel: job.channel,
          attempt: job.attempt,
          status: "failed",
          queuedAt,
          completedAt,
          latencyMs,
          error: message,
          reason: job.reason
        });
      }
    }
    this.state.attempts = keepLast(this.state.attempts, 1800);
  }

  private async dispatchChannel(record: HighRiskNotificationRecord, job: DispatchJob): Promise<void> {
    if (job.channel === "email") {
      const settings = this.state.settings.email;
      if (!settings.smtpHost) throw new Error("SMTP host is not configured.");
      const recipients = [...new Set([...this.state.settings.routing.defaultRecipients, ...(job.overrideRecipients ?? [])])];
      if (record.severity === "critical") {
        for (const recipient of this.state.settings.routing.criticalRecipients) recipients.push(recipient);
      }
      const normalizedRecipients = [...new Set(recipients.map((item) => item.trim()).filter((item) => item.length > 0))];
      if (normalizedRecipients.length === 0) throw new Error("No email recipients configured.");
      const transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.secure,
        auth: settings.smtpUsername ? { user: settings.smtpUsername, pass: settings.smtpPassword ?? "" } : undefined,
        connectionTimeout: settings.connectTimeoutMs
      });
      await transporter.sendMail({
        from: settings.fromAddress,
        to: normalizedRecipients.join(", "),
        subject: `${settings.subjectPrefix} ${record.severity.toUpperCase()} ${record.title}`,
        text: [
          "High-risk action detected in Theia.",
          `Severity: ${record.severity}`,
          `Confidence: ${record.confidence.toFixed(2)}`,
          `Category: ${record.category}`,
          `Agent: ${record.agentId}`,
          `Run: ${record.runId}`,
          `Occurred At: ${record.occurredAt}`,
          `Detected At: ${record.detectedAt}`,
          `Why: ${record.explanation}`,
          `Recommended Next Action: ${record.recommendedNextAction}`,
          `Notification ID: ${record.notificationId}`
        ].join("\n")
      });
      return;
    }
    if (job.channel === "webhook") {
      const settings = this.state.settings.webhook;
      if (!settings.url) throw new Error("Webhook URL is not configured.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
      try {
        const response = await this.fetchImpl(settings.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(settings.bearerToken ? { Authorization: `Bearer ${settings.bearerToken}` } : {})
          },
          body: JSON.stringify({
            type: "theia.high_risk_notification",
            sentAt: this.now().toISOString(),
            notification: {
              notificationId: record.notificationId,
              riskId: record.riskId,
              severity: record.severity,
              confidence: record.confidence,
              category: record.category,
              title: record.title,
              explanation: record.explanation,
              recommendedNextAction: record.recommendedNextAction,
              agentId: record.agentId,
              runId: record.runId,
              occurredAt: record.occurredAt,
              detectedAt: record.detectedAt
            }
          }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
      } finally {
        clearTimeout(timer);
      }
      return;
    }
    throw new Error(`Unsupported channel: ${job.channel}`);
  }
}

export function createHighRiskNotificationEngine(options?: {
  initialState?: Partial<HighRiskEngineState>;
  options?: EngineOptions;
}): HighRiskNotificationEngine {
  return new HighRiskNotificationEngine(options?.initialState, options?.options);
}

export const HIGH_RISK_TAXONOMY = TAXONOMY;

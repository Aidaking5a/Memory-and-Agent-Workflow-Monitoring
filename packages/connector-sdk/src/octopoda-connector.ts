import type { Connector, ConnectorCapability, ConnectorHealth, ConnectorInitOptions } from "./types.js";
import type { WorkflowEvent } from "@theia/event-schema";
import { mapOctopodaActivityToWorkflowEvent, mapOctopodaAgentToActivityEvent, type OctopodaAgentRow } from "./octopoda-mapper.js";

interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponseLike>;

export interface OctopodaConnectorConfig {
  connectorId: string;
  baseUrl?: string;
  mode?: "local" | "cloud";
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function rowsFromAgentsPayload(payload: unknown): OctopodaAgentRow[] {
  if (Array.isArray(payload)) return payload.filter((row): row is OctopodaAgentRow => Boolean(row) && typeof row === "object");
  if (payload && typeof payload === "object" && Array.isArray((payload as { agents?: unknown }).agents)) {
    return (payload as { agents: unknown[] }).agents.filter((row): row is OctopodaAgentRow => Boolean(row) && typeof row === "object");
  }
  return [];
}

export class OctopodaConnector implements Connector {
  public readonly manifest;
  private options?: ConnectorInitOptions;
  private lastHealth: ConnectorHealth = {
    status: "offline",
    message: "Waiting for first Octopoda validation."
  };
  private lastSuccessfulPoll?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  public constructor(private readonly config: OctopodaConnectorConfig) {
    const capabilities: ConnectorCapability[] = [
      "read_agent_registry",
      "read_agent_metrics",
      "read_memory_health",
      "read_agent_messages",
      "read_loop_status",
      "read_run_events"
    ];
    this.baseUrl = trimBaseUrl(config.baseUrl ?? (config.mode === "cloud" ? "https://api.octopodas.com" : "http://localhost:7842"));
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = Math.max(1000, Math.min(30_000, config.timeoutMs ?? 5000));
    this.manifest = {
      connectorId: config.connectorId,
      name: "Octopoda Connector",
      version: "0.1.0",
      description: "Reads Octopoda local/cloud agent registry, memory health, and runtime metrics into Theia.",
      capabilities
    };
  }

  public async init(options: ConnectorInitOptions): Promise<void> {
    this.options = options;
    this.options.context.emitAudit("connector.octopoda.init", {
      connectorId: this.manifest.connectorId,
      mode: this.config.mode ?? "local",
      endpointLabel: this.baseUrl,
      hasApiKey: Boolean(this.config.apiKey)
    });
  }

  public async poll(): Promise<WorkflowEvent[]> {
    if (!this.options) {
      throw new Error("Connector must be initialized before polling.");
    }

    const started = Date.now();
    try {
      const payload = await this.fetchJson("/api/agents");
      const rows = rowsFromAgentsPayload(payload);
      const now = this.options.context.now();
      const events = rows.map((row, index) =>
        mapOctopodaActivityToWorkflowEvent(
          mapOctopodaAgentToActivityEvent({
            row,
            workspaceId: this.options!.scope.workspaceId,
            connectorId: this.manifest.connectorId,
            endpointLabel: this.baseUrl,
            now,
            sequence: index
          }),
          this.manifest.connectorId
        )
      );
      this.lastSuccessfulPoll = now.toISOString();
      this.lastHealth = {
        status: rows.length > 0 ? "healthy" : "degraded",
        lastSuccessfulPollAt: this.lastSuccessfulPoll,
        latencyMs: Date.now() - started,
        message: rows.length > 0 ? `Read ${rows.length} Octopoda agent(s).` : "Octopoda is reachable but returned no agents."
      };
      return events;
    } catch (error) {
      this.lastHealth = this.healthFromError(error, Date.now() - started);
      return [];
    }
  }

  public async health(): Promise<ConnectorHealth> {
    if (this.lastHealth.status !== "offline" || this.lastSuccessfulPoll) {
      return this.lastHealth;
    }
    const started = Date.now();
    try {
      await this.fetchJson("/api/system/status");
      this.lastHealth = {
        status: "healthy",
        latencyMs: Date.now() - started,
        message: "Octopoda system status endpoint is reachable."
      };
      return this.lastHealth;
    } catch (error) {
      this.lastHealth = this.healthFromError(error, Date.now() - started);
      return this.lastHealth;
    }
  }

  public async shutdown(): Promise<void> {
    this.options?.context.emitAudit("connector.octopoda.shutdown", {
      connectorId: this.manifest.connectorId
    });
  }

  private async fetchJson(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json"
      };
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers,
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const error = new Error(detail || `Octopoda request failed with ${response.status}.`);
        (error as Error & { statusCode?: number }).statusCode = response.status;
        throw error;
      }
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private healthFromError(error: unknown, latencyMs: number): ConnectorHealth {
    const statusCode = typeof error === "object" && error ? (error as { statusCode?: unknown }).statusCode : undefined;
    if (statusCode === 401 || statusCode === 403) {
      return {
        status: "degraded",
        latencyMs,
        errorCode: "unauthorized",
        message: "Octopoda rejected the connector request. Check THEIA_OCTOPODA_API_KEY or local server auth."
      };
    }
    return {
      status: "offline",
      latencyMs,
      errorCode: "unreachable",
      message: error instanceof Error ? error.message : "Octopoda is not reachable."
    };
  }
}

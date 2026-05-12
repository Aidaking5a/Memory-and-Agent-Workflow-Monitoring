import { randomUUID } from "node:crypto";
import { agentActivityEventSchema, type AgentActivityEvent } from "@theia/agent-protocol";

interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponseLike>;

export interface TheiaReporterConfig {
  endpoint: string;
  token: string;
  workspaceId: string;
  agent: AgentActivityEvent["agent"];
  fetchImpl?: FetchLike;
}

export interface TheiaActivityInput {
  category?: AgentActivityEvent["classification"]["category"];
  status?: AgentActivityEvent["classification"]["status"];
  riskLevel?: AgentActivityEvent["classification"]["riskLevel"];
  currentTask?: string;
  objective?: string;
  safeSummary: string;
  decisionTrace?: string[];
  toolName?: string;
  filesAccessed?: string[];
  websitesVisited?: string[];
  apiCalls?: string[];
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  runtimeMs?: number;
}

export class TheiaReporter {
  private readonly fetchImpl: FetchLike;

  public constructor(private readonly config: TheiaReporterConfig) {
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  public buildEvent(input: TheiaActivityInput): AgentActivityEvent {
    const timestamp = new Date().toISOString();
    const inputTokens = input.inputTokens ?? 0;
    const outputTokens = input.outputTokens ?? 0;
    return agentActivityEventSchema.parse({
      schemaVersion: "agent-activity/v1",
      eventId: `evt:${this.config.agent.agentId}:${randomUUID()}`,
      timestamp,
      workspaceId: this.config.workspaceId,
      runId: `run:${this.config.agent.agentId}`,
      agent: this.config.agent,
      classification: {
        category: input.category ?? "operations",
        status: input.status ?? "active",
        riskLevel: input.riskLevel ?? "low",
        confidence: 0.84
      },
      what: {
        objective: input.objective,
        currentTask: input.currentTask,
        safeSummary: input.safeSummary,
        decisionTrace: input.decisionTrace ?? ["TheiaReporter emitted a safe activity summary."]
      },
      where: {
        targets: []
      },
      how: {
        toolCalls: input.toolName
          ? [
              {
                name: input.toolName,
                kind: "tool",
                status: input.status === "failed" ? "failed" : "completed",
                safeSummary: input.safeSummary
              }
            ]
          : [],
        filesAccessed: input.filesAccessed ?? [],
        websitesVisited: input.websitesVisited ?? [],
        apiCalls: input.apiCalls ?? [],
        collaborationLinkIds: [],
        userVisibleExplanation: input.safeSummary
      },
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        model: this.config.agent.model,
        vendor: this.config.agent.vendor,
        estimatedCostUsd: input.estimatedCostUsd,
        runtimeMs: input.runtimeMs
      },
      privacy: {
        redactionApplied: true,
        sensitiveKinds: []
      },
      integrity: {}
    });
  }

  public async reportActivity(input: TheiaActivityInput): Promise<{ accepted: number; rejected: number; deduped: number }> {
    return this.post(this.config.endpoint, this.buildEvent(input));
  }

  public async heartbeat(status: "active" | "idle" | "waiting" = "active"): Promise<{ accepted: number; rejected: number; deduped: number }> {
    return this.reportActivity({
      category: status === "idle" ? "idle" : "operations",
      status,
      safeSummary: `${this.config.agent.name} heartbeat: ${status}.`,
      decisionTrace: ["Heartbeat confirms the agent can report to Theia."]
    });
  }

  public async readCommands(commandsEndpoint: string): Promise<unknown> {
    const response = await this.fetchImpl(commandsEndpoint, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "x-theia-agent-id": this.config.agent.agentId
      }
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  }

  public async ackCommand(commandsEndpoint: string, commandId: string, status = "accepted"): Promise<unknown> {
    const response = await this.fetchImpl(`${commandsEndpoint}/${encodeURIComponent(commandId)}/ack`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "x-theia-agent-id": this.config.agent.agentId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  }

  private async post(url: string, body: AgentActivityEvent): Promise<{ accepted: number; rejected: number; deduped: number }> {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "x-theia-agent-id": this.config.agent.agentId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as { accepted: number; rejected: number; deduped: number };
  }
}

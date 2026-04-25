import type { WorkflowEvent } from "@theia/event-schema";

export type ConnectorCapability =
  | "read_run_events"
  | "read_memory_files"
  | "read_tool_traces"
  | "read_task_plans"
  | "read_prompts";

export interface ConnectorScope {
  workspaceId: string;
  approvedPaths: string[];
  eventTypes?: string[];
  allowCloudSync?: boolean;
}

export interface ConnectorHealth {
  status: "healthy" | "degraded" | "offline";
  lastSuccessfulPollAt?: string;
  latencyMs?: number;
  errorCode?: string;
  message?: string;
}

export interface ConnectorManifest {
  connectorId: string;
  name: string;
  version: string;
  capabilities: ConnectorCapability[];
  description: string;
}

export interface ConnectorContext {
  workspaceId: string;
  now: () => Date;
  emitEvent: (event: WorkflowEvent) => void;
  emitAudit: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface ConnectorInitOptions {
  scope: ConnectorScope;
  context: ConnectorContext;
}

export interface Connector {
  readonly manifest: ConnectorManifest;
  init(options: ConnectorInitOptions): Promise<void>;
  poll(): Promise<WorkflowEvent[]>;
  health(): Promise<ConnectorHealth>;
  shutdown(): Promise<void>;
}
import type { WorkflowEvent } from "@theia/event-schema";

export type ConnectorCapability =
  | "read_run_events"
  | "read_memory_files"
  | "read_tool_traces"
  | "read_task_plans"
  | "read_prompts"
  | "read_agent_registry"
  | "read_agent_metrics"
  | "read_memory_health"
  | "read_agent_messages"
  | "read_loop_status"
  | "write_agent_report"
  | "read_control_commands";

export type ConnectorLane = "pull" | "push" | "mcp";
export type ConnectorMode = "local" | "cloud";
export type ConnectorAuthKind = "none" | "api_key" | "pairing_token" | "oauth" | "local_session";

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

export interface ConnectorRegistration {
  connectorId: string;
  kind: "local" | "api" | "oauth" | "openclaw" | "octopoda" | "mcp" | "terminal" | "custom";
  displayName: string;
  lane: ConnectorLane;
  mode: ConnectorMode;
  endpointLabel?: string;
  authKind: ConnectorAuthKind;
  capabilities: ConnectorCapability[];
  health: ConnectorHealth;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
  hasSecret?: boolean;
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

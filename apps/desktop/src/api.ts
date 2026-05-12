import { emptyDashboardData } from "./mock-data";
import type {
  AuthSessionPayload,
  AgentNetworkControlAction,
  AgentNetworkSnapshot,
  ConnectorDiscoveryCandidate,
  ConnectorRegistrationView,
  DashboardData,
  OpenClawPairingCommands,
  OpenClawPairingView,
  OpenClawTelemetryEventRow,
  OperatorRole,
  SetupState
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:4318";
const DEFAULT_CORE_PORT = 4318;
const OPERATOR_ROLE_STORAGE_KEY = "theia.operator.role";
const OPERATOR_ID_STORAGE_KEY = "theia.operator.id";
const AUTH_TOKEN_STORAGE_KEY = "theia.auth.token";
const AUTH_USER_STORAGE_KEY = "theia.auth.user";
const CORE_URL_STORAGE_KEY = "theia.core.url";

function coreBaseUrl(): string {
  return normalizeBaseUrl(import.meta.env.VITE_THEIA_CORE_URL ?? window.localStorage.getItem(CORE_URL_STORAGE_KEY) ?? DEFAULT_BASE_URL);
}

function envOperatorId(): string {
  return import.meta.env.VITE_THEIA_OPERATOR_ID ?? "owner@theia";
}

export function getOperatorRole(): OperatorRole {
  const stored = window.localStorage.getItem(OPERATOR_ROLE_STORAGE_KEY);
  if (stored === "owner" || stored === "operator" || stored === "reviewer" || stored === "auditor" || stored === "read_only") {
    return stored;
  }
  return "owner";
}

export function setOperatorRole(role: OperatorRole): void {
  window.localStorage.setItem(OPERATOR_ROLE_STORAGE_KEY, role);
}

export function getOperatorId(): string {
  return window.localStorage.getItem(OPERATOR_ID_STORAGE_KEY) ?? envOperatorId();
}

export function setOperatorId(value: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    window.localStorage.removeItem(OPERATOR_ID_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(OPERATOR_ID_STORAGE_KEY, trimmed);
}

function operatorHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-theia-operator-role": getOperatorRole(),
    "x-theia-operator-id": getOperatorId()
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export class ApiAuthError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "ApiAuthError";
    this.statusCode = statusCode;
  }
}

export function getAuthToken(): string | null {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function getAuthUserEmail(): string | null {
  try {
    const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string };
    return typeof parsed?.email === "string" ? parsed.email : null;
  } catch {
    return null;
  }
}

function setAuthSession(session: AuthSessionPayload): void {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.token);
  window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(session.user));
  setOperatorId(session.user.email);
  setOperatorRole(session.user.role === "owner" ? "owner" : "operator");
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function getJson<TResponse>(path: string): Promise<TResponse> {
  const response = await fetchCore(path, {
    headers: operatorHeaders()
  });
  if (isAuthStatus(response.status)) {
    throw new ApiAuthError(await readErrorMessage(response), response.status);
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as TResponse;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (typeof body.message === "string" && body.message.trim().length > 0) {
      return body.message;
    }
  } catch {
    // no-op
  }
  return `Request failed (${response.status})`;
}

async function postJson<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
  const response = await fetchCore(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...operatorHeaders()
    },
    body: JSON.stringify(body)
  });

  if (isAuthStatus(response.status)) {
    throw new ApiAuthError(await readErrorMessage(response), response.status);
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

async function putJson<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
  const response = await fetchCore(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...operatorHeaders()
    },
    body: JSON.stringify(body)
  });

  if (isAuthStatus(response.status)) {
    throw new ApiAuthError(await readErrorMessage(response), response.status);
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

async function fetchCore(path: string, init: RequestInit): Promise<Response> {
  const candidates = coreBaseUrlCandidates();
  const failures: string[] = [];
  try {
    for (const baseUrl of candidates) {
      try {
        const response = await fetch(`${baseUrl}${path}`, init);
        rememberCoreBaseUrl(baseUrl);
        return response;
      } catch (error) {
        failures.push(`${baseUrl}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }
    throw new Error("All local core candidates failed.");
  } catch (error) {
    throw new Error(connectionFailureMessage(error, candidates, failures));
  }
}

function coreBaseUrlCandidates(): string[] {
  const configured = coreBaseUrl();
  const candidates = [
    configured,
    window.localStorage.getItem(CORE_URL_STORAGE_KEY) ?? "",
    DEFAULT_BASE_URL,
    "http://127.0.0.1:4318"
  ];
  const host = window.location.hostname;
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    candidates.push(`http://${host}:${DEFAULT_CORE_PORT}`);
  }
  return Array.from(new Set(candidates.map(normalizeBaseUrl).filter(Boolean)));
}

function normalizeBaseUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return DEFAULT_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

function rememberCoreBaseUrl(value: string): void {
  try {
    window.localStorage.setItem(CORE_URL_STORAGE_KEY, normalizeBaseUrl(value));
  } catch {
    // localStorage can be unavailable in hardened webviews.
  }
}

function connectionFailureMessage(error: unknown, candidates = coreBaseUrlCandidates(), failures: string[] = []): string {
  const baseUrl = coreBaseUrl();
  const detail = error instanceof Error && error.message.trim().length > 0 ? ` Browser detail: ${error.message}` : "";
  const currentOrigin = window.location.origin;
  const httpsBlocked =
    window.location.protocol === "https:" &&
    candidates.some((candidate) => candidate.startsWith("http://localhost") || candidate.startsWith("http://127.0.0.1"));
  const mixedContentHint = httpsBlocked
    ? " This page is running over HTTPS, so the browser may block plain HTTP localhost requests. Open the local dashboard at http://localhost:5173 or run local-core behind an HTTPS tunnel and set VITE_THEIA_CORE_URL to that URL."
    : "";
  const tried = candidates.length > 1 ? ` Tried: ${candidates.join(", ")}.` : "";
  const failureDetail = failures.length > 0 ? ` Details: ${failures.slice(0, 3).join(" | ")}.` : "";
  return `Unable to reach Theia local core from ${currentOrigin}. Primary core URL: ${baseUrl}.${tried} Start it with \`cmd /d /c scripts\\start-theia-dashboard.cmd -OpenClawPath "%USERPROFILE%\\src\\openclaw"\` and make sure THEIA_ALLOWED_ORIGINS includes this dashboard URL.${mixedContentHint}${detail}${failureDetail}`;
}

export async function loadDashboardData(): Promise<DashboardData> {
  try {
    const payload = await getJson<Partial<DashboardData>>("/dashboard/snapshot");
    const connection = (payload.connection ?? {}) as Partial<DashboardData["connection"]>;
    const openClawLive = (payload.openClawLive ?? {}) as Partial<DashboardData["openClawLive"]>;
    const agentNetwork = (payload.agentNetwork ?? {}) as Partial<DashboardData["agentNetwork"]>;
    const connectorStrategy = (payload.connectorStrategy ?? {}) as Partial<DashboardData["connectorStrategy"]>;
    return {
      ...emptyDashboardData,
      ...payload,
      connection: {
        ...emptyDashboardData.connection,
        ...connection,
        discoveredSources: {
          ...emptyDashboardData.connection.discoveredSources,
          ...(connection.discoveredSources ?? {})
        },
        permissions: {
          ...emptyDashboardData.connection.permissions,
          ...(connection.permissions ?? {})
        },
        health: {
          ...emptyDashboardData.connection.health,
          ...(connection.health ?? {})
        },
        runtime: {
          ...emptyDashboardData.connection.runtime,
          ...(connection.runtime ?? {})
        }
      },
      openClawLive: {
        ...emptyDashboardData.openClawLive,
        ...openClawLive,
        runtime: {
          ...emptyDashboardData.openClawLive.runtime,
          ...(openClawLive.runtime ?? {})
        },
        sourceHealth: {
          ...emptyDashboardData.openClawLive.sourceHealth,
          ...(openClawLive.sourceHealth ?? {})
        },
        operations: {
          ...emptyDashboardData.openClawLive.operations,
          ...(openClawLive.operations ?? {})
        },
        telemetry: {
          ...emptyDashboardData.openClawLive.telemetry,
          ...(openClawLive.telemetry ?? {})
        }
      },
      agentNetwork: {
        ...emptyDashboardData.agentNetwork,
        ...agentNetwork,
        orchestrator: {
          ...emptyDashboardData.agentNetwork.orchestrator,
          ...(agentNetwork.orchestrator ?? {})
        },
        stats: {
          ...emptyDashboardData.agentNetwork.stats,
          ...(agentNetwork.stats ?? {}),
          tokens: {
            ...emptyDashboardData.agentNetwork.stats.tokens,
            ...(agentNetwork.stats?.tokens ?? {})
          },
          system: {
            ...emptyDashboardData.agentNetwork.stats.system,
            ...(agentNetwork.stats?.system ?? {})
          },
          perAgent: agentNetwork.stats?.perAgent ?? emptyDashboardData.agentNetwork.stats.perAgent
        },
        agents: agentNetwork.agents ?? emptyDashboardData.agentNetwork.agents,
        links: agentNetwork.links ?? emptyDashboardData.agentNetwork.links,
        events: agentNetwork.events ?? emptyDashboardData.agentNetwork.events,
        commands: agentNetwork.commands ?? emptyDashboardData.agentNetwork.commands
      },
      connectorStrategy: {
        ...emptyDashboardData.connectorStrategy,
        ...connectorStrategy,
        connectors: connectorStrategy.connectors ?? emptyDashboardData.connectorStrategy.connectors,
        candidates: connectorStrategy.candidates ?? emptyDashboardData.connectorStrategy.candidates,
        commands: connectorStrategy.commands ?? emptyDashboardData.connectorStrategy.commands
      },
      operator: { ...emptyDashboardData.operator, ...(payload.operator ?? {}) },
      notificationCenter: payload.notificationCenter ?? emptyDashboardData.notificationCenter
    };
  } catch (error) {
    if (error instanceof ApiAuthError) {
      throw error;
    }
    return {
      ...emptyDashboardData,
      connection: {
        ...emptyDashboardData.connection,
        health: {
          status: "offline",
          checks: [
            {
              id: "api",
              label: "Local Core Connectivity",
              status: "fail",
              detail: error instanceof Error ? error.message : "Unable to reach local-core API."
            }
          ]
        }
      }
    };
  }
}

export async function loadAgentNetworkSnapshot(): Promise<AgentNetworkSnapshot> {
  const payload = await getJson<Partial<AgentNetworkSnapshot>>("/agent-network/snapshot");
  return {
    ...emptyDashboardData.agentNetwork,
    ...payload,
    orchestrator: {
      ...emptyDashboardData.agentNetwork.orchestrator,
      ...(payload.orchestrator ?? {})
    },
    stats: {
      ...emptyDashboardData.agentNetwork.stats,
      ...(payload.stats ?? {}),
      tokens: {
        ...emptyDashboardData.agentNetwork.stats.tokens,
        ...(payload.stats?.tokens ?? {})
      },
      system: {
        ...emptyDashboardData.agentNetwork.stats.system,
        ...(payload.stats?.system ?? {})
      },
      perAgent: payload.stats?.perAgent ?? emptyDashboardData.agentNetwork.stats.perAgent
    },
    agents: payload.agents ?? [],
    links: payload.links ?? [],
    events: payload.events ?? [],
    commands: payload.commands ?? []
  };
}

export async function registerPrivateAgent(input: Record<string, unknown>): Promise<{
  agent: AgentNetworkSnapshot["agents"][number];
  telemetryToken?: string;
  telemetryEndpoint: string;
  commands?: {
    endpoint?: string;
    note?: string;
    powershell?: string[];
    bash?: string[];
  };
}> {
  return postJson("/agent-network/agents", input);
}

export async function discoverAgentNetwork(workspacePath?: string): Promise<{
  generatedAt: string;
  workspacePath: string;
  registered: AgentNetworkSnapshot["agents"];
  manual: Array<Record<string, unknown>>;
}> {
  return postJson("/agent-network/discover", workspacePath ? { workspacePath } : {});
}

export async function loadConnectorStatus(): Promise<{
  generatedAt: string;
  connectors: ConnectorRegistrationView[];
  commands: DashboardData["connectorStrategy"]["commands"];
}> {
  return getJson("/setup/connectors/status");
}

export async function discoverConnectorStrategy(): Promise<{
  generatedAt: string;
  candidates: ConnectorDiscoveryCandidate[];
  registered: ConnectorRegistrationView[];
}> {
  return postJson("/setup/connectors/discover", {});
}

export async function connectConnector(candidate: ConnectorDiscoveryCandidate): Promise<{
  connector: ConnectorRegistrationView;
  connectors: ConnectorRegistrationView[];
}> {
  return postJson("/setup/connectors/connect", {
    connectorId: candidate.connectorId,
    kind: candidate.kind,
    displayName: candidate.displayName,
    lane: candidate.lane,
    mode: candidate.mode,
    endpointLabel: candidate.endpointLabel,
    authKind: candidate.authKind
  });
}

export async function validateConnector(connectorId: string): Promise<{
  connector: ConnectorRegistrationView;
  connectors: ConnectorRegistrationView[];
  snapshot: AgentNetworkSnapshot;
  syncedEvents: number;
}> {
  return postJson(`/agent-network/connectors/${encodeURIComponent(connectorId)}/validate`, {});
}

export async function sendAgentControlCommand(input: {
  action: AgentNetworkControlAction;
  agentIds?: string[];
  linkIds?: string[];
  reason?: string;
  instruction?: string;
  taskScope?: string;
  sourceAgentId?: string;
  targetAgentId?: string;
  permissions?: string[];
  priority?: "low" | "normal" | "high";
  highRisk?: boolean;
  confirmed?: boolean;
}): Promise<{
  command: AgentNetworkSnapshot["commands"][number];
  snapshot: AgentNetworkSnapshot;
}> {
  return postJson("/agent-network/control", input as Record<string, unknown>);
}

export async function makeAgentLink(input: {
  sourceAgentId: string;
  targetAgentId: string;
  taskScope: string;
  permissions?: string[];
  priority?: "low" | "normal" | "high";
  instruction?: string;
  confirmed?: boolean;
}): Promise<{
  link: AgentNetworkSnapshot["links"][number];
}> {
  return postJson("/agent-network/links", input as Record<string, unknown>);
}

export async function breakAgentLink(linkId: string, reason?: string): Promise<{
  link: AgentNetworkSnapshot["links"][number];
  command: AgentNetworkSnapshot["commands"][number];
}> {
  return postJson(`/agent-network/links/${encodeURIComponent(linkId)}/break`, { reason });
}

export async function discoverOpenClawWorkspace(workspacePath: string): Promise<SetupState["discoveredSources"]> {
  const response = await postJson<{ discovered: SetupState["discoveredSources"] }>("/setup/openclaw/discover", {
    workspacePath
  });
  return response.discovered;
}

export async function connectOpenClawWorkspace(input: {
  connectionMethod: "workspace_scan" | "manual_paths";
  workspacePath: string;
  grantWorkspaceAccess: boolean;
  permissions: SetupState["permissions"];
  sources: {
    memoryPath?: string;
    bootstrapPath?: string;
    codexLogPaths: string[];
    customJsonLogPaths: string[];
    openClawLogPaths: string[];
  };
  runtime?: {
    enabled: boolean;
    mode: "hybrid" | "log_only" | "rpc_only";
    transport: "gateway_cli" | "event_feed";
    endpoint?: string;
    apiKey?: string;
    cliCommand?: string;
    cliTimeoutMs?: number;
  };
  pluginEnabled: Record<string, boolean>;
}): Promise<void> {
  await postJson("/setup/openclaw/connect", input as Record<string, unknown>);
}

export async function validateOpenClawSetup(): Promise<SetupState["health"]> {
  return postJson<SetupState["health"]>("/setup/openclaw/validate", {});
}

export async function togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
  await postJson(`/plugins/${encodeURIComponent(pluginId)}/toggle`, { enabled });
}

export async function updateAlertStatus(
  alertId: string,
  status: "open" | "acknowledged" | "dismissed" | "resolved",
  note?: string
): Promise<void> {
  await postJson(`/alerts/${encodeURIComponent(alertId)}/status`, {
    status,
    note
  });
}

export async function updateHighRiskNotificationSettings(input: Record<string, unknown>): Promise<void> {
  await putJson("/notifications/high-risk/settings", input);
}

export async function sendHighRiskNotificationTest(input: Record<string, unknown> = {}): Promise<void> {
  await postJson("/notifications/high-risk/test", input);
}

export async function updateHighRiskNotificationStatus(
  notificationId: string,
  status: "open" | "acknowledged" | "resolved"
): Promise<void> {
  await postJson(`/notifications/high-risk/${encodeURIComponent(notificationId)}/status`, {
    status
  });
}

export async function approveWorkflowCandidate(workflowId: string, reason?: string): Promise<void> {
  await postJson(`/workflows/${encodeURIComponent(workflowId)}/review`, {
    approved: true,
    actorId: getOperatorId(),
    reason: reason ?? "Approved in Theia desktop governance view.",
    humanApprovalProvided: true
  });
}

export async function rejectWorkflowCandidate(workflowId: string, reason?: string): Promise<void> {
  await postJson(`/workflows/${encodeURIComponent(workflowId)}/review`, {
    approved: false,
    actorId: getOperatorId(),
    reason: reason ?? "Rejected in Theia desktop governance view.",
    humanApprovalProvided: true
  });
}

export async function rollbackWorkflowCandidate(workflowId: string, reason: string): Promise<void> {
  await postJson(`/workflows/${encodeURIComponent(workflowId)}/rollback`, {
    actorId: getOperatorId(),
    reason
  });
}

export async function retireStaleWorkflowCandidates(maxAgeDays: number): Promise<number> {
  const retired = await postJson<Array<{ workflowId: string }>>("/workflows/retire-stale", {
    maxAgeDays,
    actorId: getOperatorId()
  });
  return retired.length;
}

export async function updateWorkflowPromotionPolicy(policy: DashboardData["workflowPolicy"]): Promise<void> {
  await putJson("/workflows/policy", {
    ...policy,
    actorId: getOperatorId()
  });
}

export async function signupLocalAccount(email: string, password: string): Promise<AuthSessionPayload> {
  const session = await postJson<AuthSessionPayload>("/auth/signup", {
    email,
    password
  });
  setAuthSession(session);
  return session;
}

export async function signinLocalAccount(email: string, password: string): Promise<AuthSessionPayload> {
  const session = await postJson<AuthSessionPayload>("/auth/signin", {
    email,
    password
  });
  setAuthSession(session);
  return session;
}

export async function loadAuthProfile(): Promise<{ authenticated: boolean; user?: AuthSessionPayload["user"] }> {
  try {
    const result = await getJson<{ authenticated: boolean; user?: AuthSessionPayload["user"] }>("/auth/me");
    return result;
  } catch (error) {
    if (error instanceof ApiAuthError) {
      clearAuthSession();
      return { authenticated: false };
    }
    throw error;
  }
}

export async function logoutLocalAccount(): Promise<void> {
  try {
    await postJson("/auth/logout", {});
  } finally {
    clearAuthSession();
  }
}

export async function triggerEmergencyStop(reason: string): Promise<void> {
  await postJson("/openclaw/emergency-stop", {
    reason
  });
}

export async function restartGateway(resumeAutomation = true): Promise<void> {
  await postJson("/openclaw/restart-gateway", {
    resumeAutomation
  });
}

export async function createOpenClawPairing(input: {
  label?: string;
  ttlHours?: number;
}): Promise<{
  pairingId: string;
  label: string;
  expiresAt: string;
  token: string;
  telemetryEndpoint: string;
  streamEndpoint: string;
  commands: OpenClawPairingCommands;
}> {
  return postJson("/openclaw/pairings", input as Record<string, unknown>);
}

export async function listOpenClawPairings(): Promise<{
  generatedAt: string;
  pairings: OpenClawPairingView[];
  endpoint: string;
}> {
  return getJson("/openclaw/pairings");
}

export async function revokeOpenClawPairing(pairingId: string): Promise<void> {
  await postJson(`/openclaw/pairings/${encodeURIComponent(pairingId)}/revoke`, {});
}

export async function loadOpenClawTelemetryHistory(limit = 120): Promise<OpenClawTelemetryEventRow[]> {
  const response = await getJson<{ rows?: OpenClawTelemetryEventRow[] }>(
    `/openclaw/telemetry/history?limit=${encodeURIComponent(String(limit))}`
  );
  return Array.isArray(response?.rows) ? response.rows : [];
}

type SseEventName = "ready" | "snapshot" | "update" | "ping" | "message";

function parseSseBlock(block: string): { event: SseEventName; data?: unknown } | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  let event: SseEventName = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      const value = line.slice("event:".length).trim();
      if (value === "ready" || value === "snapshot" || value === "update" || value === "ping") {
        event = value;
      }
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) {
    return { event };
  }
  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n"))
    };
  } catch {
    return {
      event,
      data: dataLines.join("\n")
    };
  }
}

export function subscribeOpenClawTelemetryStream(handlers: {
  onReady?: (payload: unknown) => void;
  onSnapshot?: (payload: unknown) => void;
  onUpdate?: (payload: unknown) => void;
  onError?: (error: Error) => void;
}): () => void {
  const controller = new AbortController();
  let closed = false;

  const run = async () => {
    try {
      const response = await fetchCore("/openclaw/telemetry/stream", {
        headers: {
          Accept: "text/event-stream",
          ...operatorHeaders()
        },
        signal: controller.signal
      });
      if (isAuthStatus(response.status)) {
        throw new ApiAuthError(await readErrorMessage(response), response.status);
      }
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      if (!response.body) {
        throw new Error("Telemetry stream response body is empty.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      while (!closed) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          if (parsed.event === "ready") {
            handlers.onReady?.(parsed.data);
          } else if (parsed.event === "snapshot") {
            handlers.onSnapshot?.(parsed.data);
          } else if (parsed.event === "update") {
            handlers.onUpdate?.(parsed.data);
          }
        }
      }
    } catch (error) {
      if (closed || controller.signal.aborted) {
        return;
      }
      handlers.onError?.(error instanceof Error ? error : new Error("Telemetry stream failed."));
    }
  };

  void run();
  return () => {
    closed = true;
    controller.abort();
  };
}

export function subscribeAgentNetworkStream(handlers: {
  onReady?: (payload: unknown) => void;
  onSnapshot?: (payload: unknown) => void;
  onUpdate?: (payload: unknown) => void;
  onError?: (error: Error) => void;
}): () => void {
  const controller = new AbortController();
  let closed = false;

  const run = async () => {
    try {
      const response = await fetchCore("/agent-network/stream", {
        headers: {
          Accept: "text/event-stream",
          ...operatorHeaders()
        },
        signal: controller.signal
      });
      if (isAuthStatus(response.status)) {
        throw new ApiAuthError(await readErrorMessage(response), response.status);
      }
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      if (!response.body) {
        throw new Error("Agent stream response body is empty.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      while (!closed) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          if (parsed.event === "ready") {
            handlers.onReady?.(parsed.data);
          } else if (parsed.event === "snapshot") {
            handlers.onSnapshot?.(parsed.data);
          } else if (parsed.event === "update") {
            handlers.onUpdate?.(parsed.data);
          }
        }
      }
    } catch (error) {
      if (closed || controller.signal.aborted) {
        return;
      }
      handlers.onError?.(error instanceof Error ? error : new Error("Agent stream failed."));
    }
  };

  void run();
  return () => {
    closed = true;
    controller.abort();
  };
}

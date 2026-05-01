import { emptyDashboardData } from "./mock-data";
import type { AuthSessionPayload, DashboardData, OperatorRole, SetupState } from "./types";

const DEFAULT_BASE_URL = "http://localhost:4318";
const OPERATOR_ROLE_STORAGE_KEY = "theia.operator.role";
const OPERATOR_ID_STORAGE_KEY = "theia.operator.id";
const AUTH_TOKEN_STORAGE_KEY = "theia.auth.token";
const AUTH_USER_STORAGE_KEY = "theia.auth.user";

function coreBaseUrl(): string {
  return import.meta.env.VITE_THEIA_CORE_URL ?? DEFAULT_BASE_URL;
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
  const response = await fetch(`${coreBaseUrl()}${path}`, {
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
  const response = await fetch(`${coreBaseUrl()}${path}`, {
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
  const response = await fetch(`${coreBaseUrl()}${path}`, {
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

export async function loadDashboardData(): Promise<DashboardData> {
  try {
    const payload = await getJson<Partial<DashboardData>>("/dashboard/snapshot");
    const connection = (payload.connection ?? {}) as Partial<DashboardData["connection"]>;
    const openClawLive = (payload.openClawLive ?? {}) as Partial<DashboardData["openClawLive"]>;
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
        }
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

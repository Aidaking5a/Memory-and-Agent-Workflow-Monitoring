import { emptyDashboardData } from "./mock-data";
import type { DashboardData, OperatorRole, SetupState } from "./types";

const DEFAULT_BASE_URL = "http://localhost:4318";
const OPERATOR_ROLE_STORAGE_KEY = "theia.operator.role";
const OPERATOR_ID_STORAGE_KEY = "theia.operator.id";

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
  return {
    "x-theia-operator-role": getOperatorRole(),
    "x-theia-operator-id": getOperatorId()
  };
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

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

export async function loadDashboardData(): Promise<DashboardData> {
  try {
    const response = await fetch(`${coreBaseUrl()}/dashboard/snapshot`, {
      headers: operatorHeaders()
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    return (await response.json()) as DashboardData;
  } catch (error) {
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
    endpoint?: string;
    apiKey?: string;
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
  const response = await fetch(`${coreBaseUrl()}/workflows/policy`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...operatorHeaders()
    },
    body: JSON.stringify({
      ...policy,
      actorId: getOperatorId()
    })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

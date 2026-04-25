import { createHash } from "node:crypto";
import type { AuditEntry, PermissionGrant } from "@theia/event-schema";

export type Role = "owner" | "operator" | "reviewer" | "auditor" | "read_only";

export interface Principal {
  principalId: string;
  role: Role;
  workspaceId: string;
}

export interface AccessRequest {
  principal: Principal;
  action: string;
  resourceType: "connector" | "file_path" | "workspace" | "event_type" | "sync_mode";
  resourceValue: string;
  rationale?: string;
  timestamp: string;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  matchingGrantId?: string;
}

const ROLE_ACTIONS: Record<Role, string[]> = {
  owner: ["*"] ,
  operator: [
    "connector.read",
    "run.inspect",
    "memory.inspect",
    "alert.review",
    "approval.request"
  ],
  reviewer: ["run.inspect", "memory.inspect", "alert.review", "approval.review"],
  auditor: ["audit.read", "run.inspect", "memory.inspect"],
  read_only: ["run.inspect", "memory.inspect"]
};

function canRolePerform(role: Role, action: string): boolean {
  const capabilities = ROLE_ACTIONS[role];
  return capabilities.includes("*") || capabilities.includes(action);
}

function hashAudit(previousHash: string | undefined, entry: Omit<AuditEntry, "chainHash">): string {
  const payload = JSON.stringify({ previousHash, ...entry });
  return createHash("sha256").update(payload).digest("hex");
}

export class PolicyEngine {
  private grants = new Map<string, PermissionGrant>();
  private auditEntries: AuditEntry[] = [];

  public registerGrant(grant: PermissionGrant): void {
    this.grants.set(grant.grantId, grant);
  }

  public revokeGrant(grantId: string, revokedAt: string): void {
    const current = this.grants.get(grantId);
    if (!current) return;
    this.grants.set(grantId, { ...current, revokedAt });
  }

  public evaluate(request: AccessRequest): AccessDecision {
    if (!canRolePerform(request.principal.role, request.action)) {
      return { allowed: false, reason: `Role ${request.principal.role} cannot perform action ${request.action}` };
    }

    const matchingGrant = [...this.grants.values()].find((grant) => {
      if (grant.workspaceId !== request.principal.workspaceId) return false;
      if (grant.subjectId !== request.principal.principalId) return false;
      if (grant.scopeType !== request.resourceType) return false;
      if (grant.scopeValue !== request.resourceValue) return false;
      if (grant.revokedAt) return false;
      if (grant.expiresAt && new Date(grant.expiresAt).getTime() < new Date(request.timestamp).getTime()) return false;
      return true;
    });

    if (!matchingGrant) {
      return { allowed: false, reason: "No active permission grant matches this request." };
    }

    return {
      allowed: true,
      reason: "Request allowed by role and active grant.",
      matchingGrantId: matchingGrant.grantId
    };
  }

  public appendAudit(
    entry: Omit<AuditEntry, "chainHash" | "previousHash">,
    metadata: Record<string, unknown> = {}
  ): AuditEntry {
    const previousHash = this.auditEntries.length > 0 ? this.auditEntries[this.auditEntries.length - 1]?.chainHash : undefined;
    const fullEntry = {
      ...entry,
      metadata: {
        ...entry.metadata,
        ...metadata
      },
      previousHash,
      chainHash: hashAudit(previousHash, {
        ...entry,
        metadata: {
          ...entry.metadata,
          ...metadata
        },
        previousHash
      })
    };

    this.auditEntries.push(fullEntry);
    return fullEntry;
  }

  public getAuditTrail(): AuditEntry[] {
    return [...this.auditEntries];
  }
}
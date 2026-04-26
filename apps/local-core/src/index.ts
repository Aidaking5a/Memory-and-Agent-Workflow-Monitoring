import Fastify from "fastify";
import { TheiaCore } from "./core.js";

const workspaceId = process.env.THEIA_WORKSPACE_ID ?? "ws_local_default";
const approvedPaths = (process.env.THEIA_APPROVED_PATHS ?? process.cwd()).split(",");
const fileSources = (process.env.THEIA_FILE_SOURCES ?? "memory.md,bootstrap.md")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const codexLogSources = (process.env.THEIA_CODEX_LOG_SOURCES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const customJsonSources = (process.env.THEIA_CUSTOM_JSON_SOURCES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const openClawSources = (process.env.THEIA_OPENCLAW_LOG_SOURCES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const core = new TheiaCore({
  workspaceId,
  approvedPaths,
  fileSources,
  codexLogSources,
  customJsonSources,
  openClawSources
});

await core.initialize();

const app = Fastify({ logger: false });

app.get("/health", async () => ({ status: "ok", service: "theia-local-core" }));

app.post("/ingest", async () => {
  return core.ingestOnce();
});

app.post<{ Body: { objective: string; agentId: string; metadata?: Record<string, unknown> } }>("/runs", async (request) => {
  return core.createRun(request.body.objective, request.body.agentId, request.body.metadata);
});

app.get("/runs", async () => core.listRuns());

app.post<{ Params: { runId: string }; Body: { status: "running" | "completed" | "failed" | "cancelled" } }>(
  "/runs/:runId/status",
  async (request, reply) => {
    try {
      return core.updateRunStatus(request.params.runId, request.body.status);
    } catch (error) {
      reply.code(404);
      return { message: (error as Error).message };
    }
  }
);

app.get<{ Params: { runId: string } }>("/runs/:runId/snapshot", async (request, reply) => {
  const snapshot = core.getRunSnapshot(request.params.runId);
  if (!snapshot) {
    reply.code(404);
    return { message: "Run not found" };
  }
  return snapshot;
});

app.get<{ Params: { runId: string } }>("/runs/:runId/alerts", async (request, reply) => {
  try {
    return core.evaluateRun(request.params.runId);
  } catch (error) {
    reply.code(404);
    return { message: (error as Error).message };
  }
});

app.get<{ Params: { runId: string } }>("/runs/:runId/timeline", async (request, reply) => {
  try {
    return core.getTimeline(request.params.runId);
  } catch (error) {
    reply.code(404);
    return { message: (error as Error).message };
  }
});

app.post<{ Params: { runId: string }; Body?: { promoteIfEligible?: boolean; forceHumanReview?: boolean; actorId?: string } }>(
  "/runs/:runId/workflows/derive",
  async (request, reply) => {
    try {
      return core.deriveWorkflowCandidate(request.params.runId, request.body ?? {});
    } catch (error) {
      reply.code(404);
      return { message: (error as Error).message };
    }
  }
);

app.get("/workflows", async () => core.listWorkflowCandidates());
app.get("/workflows/queue/pending", async () => core.listWorkflowPromotionQueue());
app.get("/workflows/decisions", async () => core.listWorkflowDecisions());
app.get("/workflows/release-gates/report", async () => core.getWorkflowReleaseGateReport());
app.get("/workflows/policy", async () => core.getWorkflowPromotionPolicy());

app.put<{ Body: Record<string, unknown> }>("/workflows/policy", async (request, reply) => {
  const actorId = typeof request.body.actorId === "string" ? request.body.actorId : "owner@theia";
  const update = { ...request.body };
  delete update.actorId;
  try {
    return core.updateWorkflowPromotionPolicy(update, actorId);
  } catch (error) {
    reply.code(400);
    return { message: (error as Error).message };
  }
});

app.get<{ Params: { workflowId: string } }>("/workflows/:workflowId", async (request, reply) => {
  const candidate = core.getWorkflowCandidate(request.params.workflowId);
  if (!candidate) {
    reply.code(404);
    return { message: "Workflow candidate not found" };
  }
  return candidate;
});

app.post<{ Params: { workflowId: string }; Body: { approved: boolean; actorId: string; reason?: string; humanApprovalProvided?: boolean } }>(
  "/workflows/:workflowId/review",
  async (request, reply) => {
    try {
      return core.reviewWorkflowCandidate(request.params.workflowId, request.body);
    } catch (error) {
      const message = (error as Error).message;
      reply.code(message.includes("not found") ? 404 : 400);
      return { message };
    }
  }
);

app.post<{ Params: { workflowId: string }; Body: { actorId: string; reason: string } }>(
  "/workflows/:workflowId/rollback",
  async (request, reply) => {
    try {
      return core.rollbackWorkflow(request.params.workflowId, request.body.actorId, request.body.reason);
    } catch (error) {
      const message = (error as Error).message;
      reply.code(message.includes("not found") ? 404 : 400);
      return { message };
    }
  }
);

app.post<{ Body?: { maxAgeDays?: number; actorId?: string } }>("/workflows/retire-stale", async (request) => {
  const maxAgeDays = typeof request.body?.maxAgeDays === "number" ? request.body.maxAgeDays : 30;
  const actorId = typeof request.body?.actorId === "string" ? request.body.actorId : "system:theia";
  return core.retireStaleWorkflows(maxAgeDays, actorId);
});

app.get("/memory", async () => core.listMemory());

app.get("/audit", async () => core.listAudit());
app.get("/connectors/health", async () => core.listConnectorHealth());

const port = Number(process.env.THEIA_CORE_PORT ?? 4318);
await app.listen({ port, host: "0.0.0.0" });

console.log(`Theia local core listening on http://localhost:${port}`);

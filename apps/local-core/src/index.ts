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

const core = new TheiaCore({
  workspaceId,
  approvedPaths,
  fileSources,
  codexLogSources,
  customJsonSources
});

await core.initialize();

const app = Fastify({ logger: false });

app.get("/health", async () => ({ status: "ok", service: "theia-local-core" }));

app.post("/ingest", async () => {
  return core.ingestOnce();
});

app.post<{ Body: { objective: string; agentId: string } }>("/runs", async (request) => {
  return core.createRun(request.body.objective, request.body.agentId);
});

app.get("/runs", async () => core.listRuns());

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

app.get("/memory", async () => core.listMemory());

app.get("/audit", async () => core.listAudit());
app.get("/connectors/health", async () => core.listConnectorHealth());

const port = Number(process.env.THEIA_CORE_PORT ?? 4318);
await app.listen({ port, host: "0.0.0.0" });

console.log(`Theia local core listening on http://localhost:${port}`);

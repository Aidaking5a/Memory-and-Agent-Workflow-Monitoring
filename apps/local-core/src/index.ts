// @ts-nocheck
import Fastify from "fastify";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateRun } from "@theia/reasoning-engine";
import { TheiaCore } from "./core.js";
const workspaceId = process.env.THEIA_WORKSPACE_ID ?? "ws_local_default";
const workspaceName = process.env.THEIA_WORKSPACE_NAME ?? "Theia Local Workspace";
const stateFilePath = path.resolve(process.env.THEIA_LOCAL_CORE_STATE_PATH ?? path.join(process.cwd(), ".theia", "local-core-state.json"));
const operatorRoleHeader = "x-theia-operator-role";
const operatorIdHeader = "x-theia-operator-id";
const defaultOperatorRole = normalizeRole(process.env.THEIA_OPERATOR_ROLE);
const roleCapabilities = {
    owner: ["setup:write", "plugin:write", "alert:write", "workflow:review", "workflow:rollback", "workflow:retire", "workflow:policy:write"],
    operator: ["setup:write", "plugin:write", "alert:write", "workflow:review", "workflow:rollback", "workflow:retire"],
    reviewer: ["alert:write", "workflow:review"],
    auditor: [],
    read_only: []
};
const runtime = {
    enabled: toBool(process.env.THEIA_OPENCLAW_RUNTIME_ENABLED) ?? false,
    mode: normalizeRuntimeMode(process.env.THEIA_OPENCLAW_RUNTIME_MODE),
    endpoint: text(process.env.THEIA_OPENCLAW_RUNTIME_URL),
    apiKey: text(process.env.THEIA_OPENCLAW_RUNTIME_API_KEY),
    cursor: text(process.env.THEIA_OPENCLAW_RUNTIME_CURSOR),
    lastSyncAt: undefined,
    lastError: undefined,
    lastEventCount: 0
};
const alertOverrides = new Map();
let runtimeSequence = 0;
const approvedPaths = new Set((process.env.THEIA_APPROVED_PATHS ?? process.cwd()).split(",").map((x) => path.resolve(x.trim())).filter(Boolean));
const sources = {
    fileSources: parseList(process.env.THEIA_FILE_SOURCES ?? "memory.md,bootstrap.md").map((x) => path.resolve(x)),
    codexLogSources: parseList(process.env.THEIA_CODEX_LOG_SOURCES ?? "").map((x) => path.resolve(x)),
    customJsonSources: parseList(process.env.THEIA_CUSTOM_JSON_SOURCES ?? "").map((x) => path.resolve(x)),
    openClawSources: parseList(process.env.THEIA_OPENCLAW_LOG_SOURCES ?? "").map((x) => path.resolve(x))
};
const pluginEnabled = {
    "local-file-main": sources.fileSources.length > 0,
    "codex-cli-main": sources.codexLogSources.length > 0,
    "custom-json-main": sources.customJsonSources.length > 0,
    "openclaw-main": sources.openClawSources.length > 0
};
const setup = {
    connected: sources.fileSources.length > 0 ||
        sources.codexLogSources.length > 0 ||
        sources.customJsonSources.length > 0 ||
        sources.openClawSources.length > 0,
    connectionMethod: "unknown",
    workspacePath: [...approvedPaths][0] ?? process.cwd(),
    discoveredSources: {
        memoryPath: sources.fileSources.find((x) => path.basename(x).toLowerCase() === "memory.md"),
        bootstrapPath: sources.fileSources.find((x) => path.basename(x).toLowerCase() === "bootstrap.md"),
        codexLogPaths: [...sources.codexLogSources],
        customJsonLogPaths: [...sources.customJsonSources],
        openClawLogPaths: [...sources.openClawSources]
    },
    permissions: {
        workspaceAccessGranted: true,
        readMemoryFiles: true,
        readWorkflowEvents: true,
        readPrompts: true
    },
    health: { status: "degraded", checks: [] },
    runtime: runtimeView()
};
await hydrateFromStateFile();
syncSetupConnectedFlag();
if (setup.connected)
    setup.lastConnectedAt = new Date().toISOString();
let core = await buildCore();
await validateSetup(false);
const app = Fastify({ logger: false });
app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    reply.header("Access-Control-Allow-Headers", `Content-Type, ${operatorRoleHeader}, ${operatorIdHeader}`);
    if (request.method === "OPTIONS") {
        reply.code(204).send();
    }
});
app.get("/health", async () => ({ status: "ok", service: "theia-local-core", workspaceId, setupConnected: setup.connected }));
app.get("/operator/context", async (request) => operatorContext(request));
app.get("/setup/openclaw/status", async (request) => ({ ...setup, runtime: runtimeView(), approvedPaths: [...approvedPaths], operator: operatorContext(request) }));
app.post("/setup/openclaw/discover", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "discover workspace")) {
        return denyCapability(operator, "setup:write");
    }
    const workspacePath = text(request.body?.workspacePath);
    if (!workspacePath) {
        reply.code(400);
        return { message: "workspacePath is required." };
    }
    const absolute = path.resolve(workspacePath);
    if (!(await isDir(absolute))) {
        reply.code(400);
        return { message: `Workspace path does not exist: ${absolute}` };
    }
    const discovered = await discover(absolute);
    setup.workspacePath = absolute;
    setup.discoveredSources = discovered;
    setup.connectionMethod = "workspace_scan";
    setup.lastDiscoveredAt = new Date().toISOString();
    await persistState("setup.discover");
    return { workspacePath: absolute, discovered, operator };
});
app.post("/setup/openclaw/connect", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "connect setup")) {
        return denyCapability(operator, "setup:write");
    }
    try {
        const body = request.body ?? {};
        const workspacePath = path.resolve(text(body.workspacePath) ?? setup.workspacePath ?? process.cwd());
        if (!(await isDir(workspacePath)))
            throw new Error(`Workspace path does not exist: ${workspacePath}`);
        const grantWorkspaceAccess = body.grantWorkspaceAccess ?? setup.permissions.workspaceAccessGranted;
        if (grantWorkspaceAccess)
            approvedPaths.add(workspacePath);
        if (!isApproved(workspacePath))
            throw new Error("Workspace path is outside approved scope.");
        const requested = body.sources ?? {};
        const memoryPath = text(requested.memoryPath) ?? setup.discoveredSources.memoryPath;
        const bootstrapPath = text(requested.bootstrapPath) ?? setup.discoveredSources.bootstrapPath;
        sources.fileSources = uniq([memoryPath, bootstrapPath].filter((x) => Boolean(x)).map((x) => path.resolve(x)));
        sources.codexLogSources = uniq((requested.codexLogPaths ?? setup.discoveredSources.codexLogPaths).map((x) => path.resolve(x)));
        sources.customJsonSources = uniq((requested.customJsonLogPaths ?? setup.discoveredSources.customJsonLogPaths).map((x) => path.resolve(x)));
        sources.openClawSources = uniq((requested.openClawLogPaths ?? setup.discoveredSources.openClawLogPaths).map((x) => path.resolve(x)));
        const allSources = [...sources.fileSources, ...sources.codexLogSources, ...sources.customJsonSources, ...sources.openClawSources];
        for (const sourcePath of allSources) {
            if (!(await exists(sourcePath)))
                throw new Error(`Missing source path: ${sourcePath}`);
            if (!isApproved(sourcePath))
                throw new Error(`Source path outside approved scope: ${sourcePath}`);
        }
        const runtimeInput = body.runtime ?? {};
        const explicitRuntimeEnabled = toBool(runtimeInput.enabled);
        if (typeof explicitRuntimeEnabled === "boolean") {
            runtime.enabled = explicitRuntimeEnabled;
        }
        runtime.mode = normalizeRuntimeMode(runtimeInput.mode ?? runtime.mode);
        runtime.endpoint = text(runtimeInput.endpoint) ?? runtime.endpoint;
        if (typeof runtimeInput.apiKey === "string") {
            runtime.apiKey = runtimeInput.apiKey.trim() || undefined;
        }
        if (typeof runtimeInput.cursor === "string") {
            runtime.cursor = runtimeInput.cursor.trim() || undefined;
        }
        if (!runtime.enabled || runtime.mode === "log_only") {
            runtime.lastError = undefined;
        }
        const toggles = body.pluginEnabled ?? {};
        for (const plugin of pluginListSync()) {
            const explicit = toggles[plugin.pluginId];
            pluginEnabled[plugin.pluginId] = typeof explicit === "boolean" ? explicit : plugin.sourceCount > 0;
        }
        setup.permissions = {
            ...setup.permissions,
            ...(body.permissions ?? {}),
            workspaceAccessGranted: grantWorkspaceAccess
        };
        setup.connectionMethod = body.connectionMethod ?? "manual_paths";
        setup.workspacePath = workspacePath;
        setup.discoveredSources = {
            memoryPath,
            bootstrapPath,
            codexLogPaths: sources.codexLogSources,
            customJsonLogPaths: sources.customJsonSources,
            openClawLogPaths: sources.openClawSources
        };
        setup.runtime = runtimeView();
        setup.connected = true;
        setup.lastConnectedAt = new Date().toISOString();
        await rebuildCore();
        await validateSetup(true);
        await persistState("setup.connect");
        return { connected: true, setup, plugins: await pluginList(), operator };
    }
    catch (error) {
        reply.code(400);
        return { message: error.message };
    }
});
app.post("/setup/openclaw/validate", async () => validateSetup(true));
app.get("/plugins", async () => pluginList());
app.post("/plugins/:pluginId/toggle", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "plugin:write", "toggle plugin")) {
        return denyCapability(operator, "plugin:write");
    }
    const enabled = request.body?.enabled;
    if (typeof enabled !== "boolean") {
        reply.code(400);
        return { message: "enabled must be a boolean." };
    }
    const plugin = pluginListSync().find((x) => x.pluginId === request.params.pluginId);
    if (!plugin) {
        reply.code(404);
        return { message: "Plugin not found." };
    }
    if (enabled && plugin.sourceCount === 0) {
        reply.code(400);
        return { message: "Cannot enable plugin with no configured source files." };
    }
    pluginEnabled[request.params.pluginId] = enabled;
    await rebuildCore();
    await validateSetup(false);
    await persistState("plugin.toggle");
    return { pluginId: request.params.pluginId, enabled, plugins: await pluginList(), operator };
});
app.post("/ingest", async () => performIngestion());
app.get("/dashboard/snapshot", async (request) => {
    const operator = operatorContext(request);
    const ingest = await performIngestion();
    const runs = deriveRuns(core.listRuns(), core.listEvents());
    const events = core.listEvents();
    const tasks = core.listTasks();
    const memory = core.listMemory();
    const workflows = core.listWorkflowCandidates();
    const pluginRows = await pluginList();
    const connectorHealth = healthRatio(pluginRows);
    const rawAlerts = runs.flatMap((run) => {
        const snapshot = toSnapshot(run, tasks, events, memory.versions, workflows);
        return snapshot ? evaluateRun(snapshot) : [];
    });
    const alerts = rawAlerts.map((alert) => applyAlertOverride(alert));
    const agents = buildAgents(runs, events, alerts, connectorHealth);
    const tokenSeries = buildTokenSeries(events);
    const workloadSeries = buildWorkloadSeries(events);
    const memoryRows = memory.objects.map((obj) => ({
        memoryId: obj.memoryId,
        sourcePath: obj.sourcePath,
        sectionKey: obj.sectionKey,
        heading: heading(obj.sectionKey),
        latestVersionId: obj.latestVersionId,
        updatedAt: memory.versions.find((v) => v.versionId === obj.latestVersionId)?.createdAt,
        contentPreview: (memory.versions.find((v) => v.versionId === obj.latestVersionId)?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 180)
    }));
    return {
        generatedAt: new Date().toISOString(),
        workspaceId,
        workspaceName,
        timeRange: "Last 12 hours",
        connection: { ...setup, runtime: runtimeView() },
        operator,
        metrics: buildMetrics(agents, runs, alerts, tokenSeries, connectorHealth, pluginRows, memoryRows),
        agents,
        runs: runs.map((run) => summarizeRun(run, events)),
        timeline: [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 60).map((event) => ({
            eventId: event.eventId,
            ts: event.timestamp,
            eventType: event.eventType,
            agent: event.agentId,
            runId: event.runId,
            confidence: event.confidence,
            summary: summarize(event)
        })),
        memory: memoryRows,
        memoryDocuments: groupMemoryDocs(memoryRows),
        memoryChanges: [...events].filter((e) => e.eventType === "memory.changed").sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 40).map((event) => ({
            eventId: event.eventId,
            sourcePath: text(event.payload.filePath) ?? event.source.filePath ?? "unknown",
            ts: event.timestamp,
            summary: summarize(event),
            runId: event.runId,
            agentId: event.agentId
        })),
        memoryImpactLinks: buildMemoryImpactLinks(alerts, memoryRows, memory.versions, events),
        alerts: alerts.map((alert) => ({
            alertId: alert.alertId,
            category: alert.category,
            severity: alert.severity,
            confidence: alert.confidence,
            title: alert.title,
            explanation: alert.explanation,
            runId: alert.runId,
            agentId: alert.agentId,
            status: alert.status,
            createdAt: alert.createdAt,
            evidenceCount: alert.evidenceRefs.length
        })),
        tokenSeries,
        workloadSeries,
        plugins: pluginRows,
        connectors: pluginRows.map((plugin) => ({
            connectorId: plugin.pluginId,
            scope: plugin.capabilities.join(", "),
            status: plugin.status,
            lastSync: plugin.lastSync ?? setup.lastValidatedAt ?? new Date().toISOString(),
            enabled: plugin.enabled,
            syncHealth: plugin.syncHealth
        })),
        comparison: compareAgents(agents),
        audit: core.listAudit().slice(0, 120).map((entry) => ({
            ts: entry.timestamp,
            actor: entry.actorId,
            action: entry.action,
            target: `${entry.targetType}:${entry.targetId}`,
            result: "logged"
        })),
        workflowCandidates: workflows.map((w) => ({
            workflowId: w.workflowId,
            title: w.title,
            status: w.status,
            impactLevel: w.impactLevel,
            namespace: `tenant:${w.namespace.tenantId ?? "local"} / ${w.namespace.domain} / ${w.namespace.taskFamily}`,
            confidenceScore: w.gateMetrics.confidenceScore,
            utilityRate: w.gateMetrics.utilityRate,
            overlapRate: w.gateMetrics.overlapRate,
            contradictionRate: w.gateMetrics.contradictionRate,
            staleUseRate: w.gateMetrics.staleUseRate,
            conflictCount: w.conflictWithWorkflowIds.length,
            updatedAt: w.updatedAt
        })),
        workflowReport: core.getWorkflowReleaseGateReport(),
        workflowPolicy: core.getWorkflowPromotionPolicy(),
        ingestSummary: {
            latestEventCount: ingest.events.length,
            latestMemoryObjects: ingest.memoryObjects.length,
            latestMemoryVersions: ingest.memoryVersions.length
        }
    };
});
app.get("/alerts", async () => {
    const runs = deriveRuns(core.listRuns(), core.listEvents());
    const events = core.listEvents();
    const tasks = core.listTasks();
    const memory = core.listMemory();
    const workflows = core.listWorkflowCandidates();
    const rawAlerts = runs.flatMap((run) => {
        const snapshot = toSnapshot(run, tasks, events, memory.versions, workflows);
        return snapshot ? evaluateRun(snapshot) : [];
    });
    return rawAlerts.map((alert) => applyAlertOverride(alert));
});
app.post("/alerts/:alertId/status", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "alert:write", "update alert status")) {
        return denyCapability(operator, "alert:write");
    }
    const status = text(request.body?.status);
    if (!status || !["open", "acknowledged", "dismissed", "resolved"].includes(status)) {
        reply.code(400);
        return { message: "status must be one of open|acknowledged|dismissed|resolved." };
    }
    const alertId = request.params.alertId;
    const note = text(request.body?.note);
    const actorId = text(request.body?.actorId) ?? operator.actorId;
    alertOverrides.set(alertId, {
        status,
        note,
        actorId,
        updatedAt: new Date().toISOString()
    });
    await persistState("alerts.status");
    return { alertId, status, note, actorId, updatedAt: alertOverrides.get(alertId)?.updatedAt };
});
app.post("/runs", async (request) => core.createRun(request.body.objective, request.body.agentId, request.body.metadata));
app.get("/runs", async () => core.listRuns());
app.post("/runs/:runId/status", async (request, reply) => {
    try {
        return core.updateRunStatus(request.params.runId, request.body.status);
    }
    catch (error) {
        reply.code(404);
        return { message: error.message };
    }
});
app.get("/runs/:runId/snapshot", async (request, reply) => {
    const snapshot = core.getRunSnapshot(request.params.runId);
    if (!snapshot) {
        reply.code(404);
        return { message: "Run not found" };
    }
    return snapshot;
});
app.get("/runs/:runId/alerts", async (request, reply) => {
    try {
        return core.evaluateRun(request.params.runId).map((alert) => applyAlertOverride(alert));
    }
    catch (error) {
        reply.code(404);
        return { message: error.message };
    }
});
app.get("/runs/:runId/timeline", async (request, reply) => {
    try {
        return core.getTimeline(request.params.runId);
    }
    catch (error) {
        reply.code(404);
        return { message: error.message };
    }
});
app.post("/runs/:runId/workflows/derive", async (request, reply) => {
    try {
        return core.deriveWorkflowCandidate(request.params.runId, request.body ?? {});
    }
    catch (error) {
        reply.code(404);
        return { message: error.message };
    }
});
app.get("/workflows", async () => core.listWorkflowCandidates());
app.get("/workflows/queue/pending", async () => core.listWorkflowPromotionQueue());
app.get("/workflows/decisions", async () => core.listWorkflowDecisions());
app.get("/workflows/release-gates/report", async () => core.getWorkflowReleaseGateReport());
app.get("/workflows/policy", async () => core.getWorkflowPromotionPolicy());
app.put("/workflows/policy", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "workflow:policy:write", "update workflow policy")) {
        return denyCapability(operator, "workflow:policy:write");
    }
    const actorId = typeof request.body.actorId === "string" ? request.body.actorId : operator.actorId;
    const update = { ...request.body };
    delete update.actorId;
    try {
        return core.updateWorkflowPromotionPolicy(update, actorId);
    }
    catch (error) {
        reply.code(400);
        return { message: error.message };
    }
});
app.get("/workflows/:workflowId", async (request, reply) => {
    const candidate = core.getWorkflowCandidate(request.params.workflowId);
    if (!candidate) {
        reply.code(404);
        return { message: "Workflow candidate not found" };
    }
    return candidate;
});
app.post("/workflows/:workflowId/review", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "workflow:review", "review workflow")) {
        return denyCapability(operator, "workflow:review");
    }
    try {
        return core.reviewWorkflowCandidate(request.params.workflowId, {
            ...request.body,
            actorId: text(request.body?.actorId) ?? operator.actorId
        });
    }
    catch (error) {
        const message = error.message;
        reply.code(message.includes("not found") ? 404 : 400);
        return { message };
    }
});
app.post("/workflows/:workflowId/rollback", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "workflow:rollback", "rollback workflow")) {
        return denyCapability(operator, "workflow:rollback");
    }
    try {
        return core.rollbackWorkflow(request.params.workflowId, text(request.body?.actorId) ?? operator.actorId, text(request.body?.reason) ?? "Rollback initiated by operator.");
    }
    catch (error) {
        const message = error.message;
        reply.code(message.includes("not found") ? 404 : 400);
        return { message };
    }
});
app.post("/workflows/retire-stale", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "workflow:retire", "retire stale workflows")) {
        return denyCapability(operator, "workflow:retire");
    }
    return core.retireStaleWorkflows(typeof request.body?.maxAgeDays === "number" ? request.body.maxAgeDays : 30, text(request.body?.actorId) ?? operator.actorId);
});
app.get("/memory", async () => core.listMemory());
app.get("/audit", async () => core.listAudit());
app.get("/connectors/health", async () => core.listConnectorHealth());
const port = Number(process.env.THEIA_CORE_PORT ?? 4318);
await app.listen({ port, host: "0.0.0.0" });
console.log(`Theia local core listening on http://localhost:${port}`);
async function buildCore() {
    const next = new TheiaCore({
        workspaceId,
        approvedPaths: [...approvedPaths],
        fileSources: pluginEnabled["local-file-main"] ? sources.fileSources : [],
        codexLogSources: pluginEnabled["codex-cli-main"] ? sources.codexLogSources : [],
        customJsonSources: pluginEnabled["custom-json-main"] ? sources.customJsonSources : [],
        openClawSources: pluginEnabled["openclaw-main"] && runtime.mode !== "rpc_only" ? sources.openClawSources : []
    });
    await next.initialize();
    return next;
}
async function rebuildCore() {
    core = await buildCore();
}
async function validateSetup(runIngest) {
    const checks = [];
    checks.push({ id: "workspace", label: "Workspace Registration", status: setup.workspacePath && (await isDir(setup.workspacePath)) ? "pass" : "fail", detail: setup.workspacePath ?? "No workspace set." });
    checks.push({ id: "memory", label: "Memory Sources", status: sources.fileSources.length > 0 ? "pass" : "warn", detail: `${sources.fileSources.length} source(s)` });
    checks.push({ id: "telemetry", label: "Workflow Sources", status: sources.codexLogSources.length + sources.customJsonSources.length + sources.openClawSources.length > 0 ? "pass" : "warn", detail: `${sources.codexLogSources.length + sources.customJsonSources.length + sources.openClawSources.length} source(s)` });
    if (runIngest) {
        const ingest = await performIngestion();
        checks.push({ id: "ingest", label: "Validation Ingest", status: ingest.events.length > 0 ? "pass" : "warn", detail: `${ingest.events.length} event(s)` });
    }
    checks.push({
        id: "runtime",
        label: "OpenClaw Runtime RPC",
        status: runtime.enabled
            ? runtime.mode === "log_only"
                ? "warn"
                : runtime.lastError
                    ? "warn"
                    : runtime.lastSyncAt
                        ? "pass"
                        : "warn"
            : "warn",
        detail: runtime.enabled
            ? runtime.lastError ?? `${runtime.mode} mode (${runtime.endpoint ?? "endpoint missing"})`
            : "Runtime RPC disabled"
    });
    const pluginRows = await pluginList();
    const enabled = pluginRows.filter((plugin) => plugin.enabled).length;
    const healthy = pluginRows.filter((plugin) => plugin.enabled && plugin.status === "healthy").length;
    checks.push({ id: "connectors", label: "Connector Health", status: enabled === 0 ? "warn" : healthy === enabled ? "pass" : "warn", detail: `${healthy}/${enabled} healthy` });
    setup.health = { status: checks.some((c) => c.status === "fail") ? "offline" : checks.some((c) => c.status === "warn") ? "degraded" : "healthy", checks };
    setup.lastValidatedAt = new Date().toISOString();
    setup.runtime = runtimeView();
    return setup.health;
}
async function pluginList() {
    const connectorHealth = await core.listConnectorHealth();
    const byId = new Map(connectorHealth.map((item) => [item.connectorId, item]));
    return pluginListSync().map((plugin) => {
        const health = byId.get(plugin.pluginId)?.health;
        let status = plugin.enabled ? health?.status ?? "offline" : "disabled";
        let syncHealth = plugin.enabled ? health?.message ?? (status === "healthy" ? "Synchronized" : "Not synchronized") : "Disabled";
        let lastSync = health?.lastSuccessfulPollAt;
        if (plugin.pluginId === "openclaw-main" && plugin.enabled && runtime.enabled && runtime.mode !== "log_only") {
            status = runtime.lastError ? "degraded" : runtime.lastSyncAt ? "healthy" : status === "offline" ? "degraded" : status;
            syncHealth = runtime.lastError
                ? `Runtime RPC warning: ${runtime.lastError}`
                : runtime.lastSyncAt
                    ? `Runtime RPC synchronized (${runtime.mode})`
                    : `Runtime RPC configured (${runtime.mode})`;
            lastSync = runtime.lastSyncAt ?? lastSync;
        }
        return {
            ...plugin,
            status,
            syncHealth,
            lastSync
        };
    });
}
function pluginListSync() {
    const openclawSourceCount = sources.openClawSources.length + (runtime.enabled && runtime.mode !== "log_only" && runtime.endpoint ? 1 : 0);
    return [
        { pluginId: "local-file-main", name: "Local File Connector", description: "Reads memory.md/bootstrap.md", capabilities: ["read_memory_files", "read_run_events"], enabled: pluginEnabled["local-file-main"], sourceCount: sources.fileSources.length },
        { pluginId: "codex-cli-main", name: "Codex CLI Connector", description: "Reads Codex logs", capabilities: ["read_run_events", "read_tool_traces", "read_task_plans"], enabled: pluginEnabled["codex-cli-main"], sourceCount: sources.codexLogSources.length },
        { pluginId: "custom-json-main", name: "Custom JSON Connector", description: "Reads custom JSON telemetry", capabilities: ["read_run_events", "read_tool_traces", "read_task_plans"], enabled: pluginEnabled["custom-json-main"], sourceCount: sources.customJsonSources.length },
        { pluginId: "openclaw-main", name: "OpenClaw Connector", description: "Reads OpenClaw traces and optional runtime API", capabilities: ["read_run_events", "read_tool_traces", "read_task_plans", "read_prompts"], enabled: pluginEnabled["openclaw-main"], sourceCount: openclawSourceCount }
    ];
}
async function performIngestion() {
    const ingest = await core.ingestOnce();
    const runtimeEvents = await pollOpenClawRuntime();
    if (runtimeEvents.length > 0) {
        for (const event of runtimeEvents) {
            core.addEvent(event);
        }
    }
    return {
        ...ingest,
        events: [...ingest.events, ...runtimeEvents],
        runtimeEvents
    };
}
async function pollOpenClawRuntime() {
    if (!pluginEnabled["openclaw-main"]) {
        return [];
    }
    if (!runtime.enabled || runtime.mode === "log_only") {
        return [];
    }
    if (!runtime.endpoint) {
        runtime.lastError = "Runtime endpoint is missing.";
        setup.runtime = runtimeView();
        return [];
    }
    try {
        const url = new URL(runtime.endpoint);
        if (runtime.cursor) {
            url.searchParams.set("cursor", runtime.cursor);
        }
        url.searchParams.set("workspaceId", workspaceId);
        url.searchParams.set("limit", "250");
        const headers = { Accept: "application/json" };
        if (runtime.apiKey) {
            headers.Authorization = `Bearer ${runtime.apiKey}`;
        }
        const response = await fetch(url, { headers, method: "GET" });
        if (!response.ok) {
            throw new Error(`Runtime endpoint request failed (${response.status}).`);
        }
        const payload = await response.json();
        const records = normalizeRuntimePayload(payload);
        const events = [];
        for (const record of records) {
            const event = buildRuntimeEvent(record, runtime.endpoint);
            if (event) {
                events.push(event);
            }
        }
        runtime.lastEventCount = events.length;
        runtime.lastSyncAt = new Date().toISOString();
        runtime.lastError = undefined;
        if (typeof payload?.nextCursor === "string" && payload.nextCursor.trim().length > 0) {
            runtime.cursor = payload.nextCursor.trim();
        }
        else if (records.length > 0) {
            const tail = records[records.length - 1];
            runtime.cursor = text(tail?.cursor) ?? text(tail?.id) ?? text(tail?.eventId) ?? text(tail?.timestamp) ?? runtime.cursor;
        }
        setup.runtime = runtimeView();
        await persistState("runtime.poll");
        return events;
    }
    catch (error) {
        runtime.lastError = error instanceof Error ? error.message : "Runtime poll failed.";
        setup.runtime = runtimeView();
        await persistState("runtime.poll.error");
        return [];
    }
}
function normalizeRuntimePayload(payload) {
    if (Array.isArray(payload)) {
        return payload.filter((entry) => entry && typeof entry === "object");
    }
    if (payload && typeof payload === "object") {
        if (Array.isArray(payload.events)) {
            return payload.events.filter((entry) => entry && typeof entry === "object");
        }
        if (Array.isArray(payload.data)) {
            return payload.data.filter((entry) => entry && typeof entry === "object");
        }
        return [payload];
    }
    return [];
}
function buildRuntimeEvent(record, endpoint) {
    const eventType = inferOpenClawRuntimeEventType(record);
    if (!eventType) {
        return undefined;
    }
    const timestamp = text(record.timestamp) ?? text(record.ts) ?? text(record.created_at) ?? text(record.createdAt) ?? new Date().toISOString();
    const runId = text(record.runId) ?? text(record.run_id) ?? text(record.sessionId) ?? text(record.session_id) ?? "run:openclaw-runtime";
    const agentId = text(record.agentId) ?? text(record.agent_id) ?? text(record.worker) ?? text(record.actor) ?? "agent:openclaw-runtime";
    const taskId = text(record.taskId) ?? text(record.task_id) ?? text(record.step_id);
    const confidenceRaw = num(record.confidence) ?? num(record.reasoning_confidence) ?? num(record.score);
    runtimeSequence += 1;
    return {
        eventId: `openclaw-runtime:${Date.now()}:${runtimeSequence}`,
        workspaceId,
        runId,
        agentId,
        taskId,
        eventType,
        timestamp,
        payload: {
            ...record,
            sourceSystem: "openclaw-runtime"
        },
        source: {
            connectorId: "openclaw-runtime",
            objectPath: endpoint
        },
        confidence: typeof confidenceRaw === "number" ? clamp(confidenceRaw) : 0.78,
        evidenceRefs: []
    };
}
function inferOpenClawRuntimeEventType(record) {
    const explicit = text(record.eventType) ?? text(record.event_type) ?? text(record.type) ?? text(record.action_type);
    if (explicit && [
        "run.started",
        "run.completed",
        "run.failed",
        "task.created",
        "task.updated",
        "task.completed",
        "tool_call.started",
        "tool_call.completed",
        "tool_call.failed",
        "memory.read",
        "memory.changed",
        "checkpoint.created",
        "reasoning.claim",
        "reasoning.conclusion",
        "approval.requested",
        "approval.granted",
        "approval.denied",
        "privileged_action.attempted",
        "privileged_action.blocked",
        "privileged_action.executed",
        "workflow.derived_decision",
        "workflow.candidate_created",
        "workflow.promotion_requested",
        "workflow.promoted",
        "workflow.rejected",
        "workflow.rollback",
        "workflow.compatibility_conflict",
        "workflow.retired",
        "workflow.expired"
    ].includes(explicit)) {
        return explicit;
    }
    const joined = JSON.stringify(record).toLowerCase();
    if (joined.includes("tool") && joined.includes("start"))
        return "tool_call.started";
    if (joined.includes("tool") && (joined.includes("complete") || joined.includes("success") || joined.includes("result")))
        return "tool_call.completed";
    if (joined.includes("tool") && (joined.includes("error") || joined.includes("fail")))
        return "tool_call.failed";
    if (joined.includes("memory") && (joined.includes("read") || joined.includes("retrieve")))
        return "memory.read";
    if (joined.includes("memory") && (joined.includes("write") || joined.includes("change") || joined.includes("update")))
        return "memory.changed";
    if (joined.includes("checkpoint") || joined.includes("plan"))
        return "checkpoint.created";
    if (joined.includes("conclusion") || joined.includes("final"))
        return "reasoning.conclusion";
    if (joined.includes("reasoning") || joined.includes("assumption"))
        return "reasoning.claim";
    if (joined.includes("approval") && joined.includes("grant"))
        return "approval.granted";
    if (joined.includes("approval") && joined.includes("deny"))
        return "approval.denied";
    if (joined.includes("privileged") && joined.includes("attempt"))
        return "privileged_action.attempted";
    if (joined.includes("run") && joined.includes("start"))
        return "run.started";
    if (joined.includes("run") && (joined.includes("complete") || joined.includes("finished")))
        return "run.completed";
    if (joined.includes("run") && joined.includes("fail"))
        return "run.failed";
    return undefined;
}
function runtimeView() {
    return {
        enabled: runtime.enabled,
        mode: runtime.mode,
        endpoint: runtime.endpoint,
        hasApiKey: Boolean(runtime.apiKey),
        cursor: runtime.cursor,
        lastSyncAt: runtime.lastSyncAt,
        lastError: runtime.lastError,
        lastEventCount: runtime.lastEventCount
    };
}
function normalizeRole(input) {
    const value = text(input)?.toLowerCase();
    if (!value) {
        return "owner";
    }
    if (["owner", "operator", "reviewer", "auditor", "read_only"].includes(value)) {
        return value;
    }
    if (value === "readonly") {
        return "read_only";
    }
    return "owner";
}
function operatorContext(request) {
    const headerRole = request?.headers?.[operatorRoleHeader];
    const role = normalizeRole(Array.isArray(headerRole) ? headerRole[0] : headerRole) ?? defaultOperatorRole;
    const actorHeader = request?.headers?.[operatorIdHeader];
    const actorId = text(Array.isArray(actorHeader) ? actorHeader[0] : actorHeader) ?? process.env.THEIA_OPERATOR_ID ?? `${role}@theia`;
    const capabilities = roleCapabilities[role] ?? [];
    return {
        role,
        actorId,
        capabilities: [...capabilities]
    };
}
function requireCapability(reply, operator, capability, actionLabel) {
    if ((operator.capabilities ?? []).includes(capability)) {
        return true;
    }
    reply.code(403);
    return false;
}
function denyCapability(operator, capability) {
    return {
        message: `Role "${operator.role}" is not permitted for capability "${capability}".`,
        role: operator.role,
        capability
    };
}
function applyAlertOverride(alert) {
    const override = alertOverrides.get(alert.alertId);
    if (!override) {
        return alert;
    }
    return {
        ...alert,
        status: override.status,
        updatedAt: override.updatedAt
    };
}
function buildMemoryImpactLinks(alerts, memoryRows, versions, events) {
    const eventById = new Map(events.map((event) => [event.eventId, event]));
    const memoryById = new Map(memoryRows.map((row) => [row.memoryId, row]));
    const memoryBySource = new Map(memoryRows.map((row) => [path.resolve(row.sourcePath), row]));
    const versionById = new Map(versions.map((version) => [version.versionId, version]));
    const links = [];
    const seen = new Set();
    for (const alert of alerts) {
        for (const ref of alert.evidenceRefs ?? []) {
            let sourcePath;
            let sectionKey;
            let explanation = alert.explanation;
            if (ref.memoryVersionId && versionById.has(ref.memoryVersionId)) {
                const version = versionById.get(ref.memoryVersionId);
                const memory = memoryById.get(version.memoryId);
                sourcePath = memory?.sourcePath ?? version.provenance?.filePath;
                sectionKey = memory?.sectionKey;
            }
            if ((!sourcePath || !sectionKey) && ref.eventId) {
                const event = eventById.get(ref.eventId);
                if (event) {
                    const versionId = text(event.payload.memoryVersionId);
                    const memoryId = text(event.payload.memoryId);
                    const eventFilePath = text(event.payload.filePath) ?? event.source?.filePath;
                    if (versionId && versionById.has(versionId)) {
                        const version = versionById.get(versionId);
                        const memory = memoryById.get(version.memoryId);
                        sourcePath = memory?.sourcePath ?? version.provenance?.filePath;
                        sectionKey = memory?.sectionKey ?? sectionKey;
                    }
                    if ((!sourcePath || !sectionKey) && memoryId && memoryById.has(memoryId)) {
                        const memory = memoryById.get(memoryId);
                        sourcePath = memory?.sourcePath;
                        sectionKey = memory?.sectionKey;
                    }
                    if ((!sourcePath || !sectionKey) && eventFilePath) {
                        const memory = memoryBySource.get(path.resolve(eventFilePath));
                        sourcePath = memory?.sourcePath ?? eventFilePath;
                        sectionKey = memory?.sectionKey ?? sectionKey;
                    }
                    explanation = `${alert.explanation} (evidence: ${event.eventType})`;
                }
            }
            if (!sourcePath || !sectionKey) {
                continue;
            }
            const key = `${alert.alertId}:${sourcePath}:${sectionKey}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            links.push({
                alertId: alert.alertId,
                category: alert.category,
                severity: alert.severity,
                runId: alert.runId,
                sourcePath,
                sectionKey,
                explanation
            });
        }
    }
    return links;
}
function syncSetupConnectedFlag() {
    setup.connected = sources.fileSources.length > 0 ||
        sources.codexLogSources.length > 0 ||
        sources.customJsonSources.length > 0 ||
        sources.openClawSources.length > 0;
    setup.runtime = runtimeView();
}
async function hydrateFromStateFile() {
    try {
        const raw = await readFile(stateFilePath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return;
        }
        if (Array.isArray(parsed.approvedPaths)) {
            for (const approved of parsed.approvedPaths) {
                const resolved = text(approved);
                if (resolved) {
                    approvedPaths.add(path.resolve(resolved));
                }
            }
        }
        if (parsed.sources && typeof parsed.sources === "object") {
            if (Array.isArray(parsed.sources.fileSources))
                sources.fileSources = uniq(parsed.sources.fileSources.map((item) => path.resolve(String(item))));
            if (Array.isArray(parsed.sources.codexLogSources))
                sources.codexLogSources = uniq(parsed.sources.codexLogSources.map((item) => path.resolve(String(item))));
            if (Array.isArray(parsed.sources.customJsonSources))
                sources.customJsonSources = uniq(parsed.sources.customJsonSources.map((item) => path.resolve(String(item))));
            if (Array.isArray(parsed.sources.openClawSources))
                sources.openClawSources = uniq(parsed.sources.openClawSources.map((item) => path.resolve(String(item))));
        }
        if (parsed.pluginEnabled && typeof parsed.pluginEnabled === "object") {
            for (const plugin of Object.keys(pluginEnabled)) {
                if (typeof parsed.pluginEnabled[plugin] === "boolean") {
                    pluginEnabled[plugin] = parsed.pluginEnabled[plugin];
                }
            }
        }
        if (parsed.setup && typeof parsed.setup === "object") {
            setup.connectionMethod = text(parsed.setup.connectionMethod) ?? setup.connectionMethod;
            setup.workspacePath = text(parsed.setup.workspacePath) ?? setup.workspacePath;
            if (parsed.setup.permissions && typeof parsed.setup.permissions === "object") {
                setup.permissions = {
                    ...setup.permissions,
                    ...parsed.setup.permissions
                };
            }
            if (parsed.setup.discoveredSources && typeof parsed.setup.discoveredSources === "object") {
                setup.discoveredSources = {
                    memoryPath: text(parsed.setup.discoveredSources.memoryPath) ?? setup.discoveredSources.memoryPath,
                    bootstrapPath: text(parsed.setup.discoveredSources.bootstrapPath) ?? setup.discoveredSources.bootstrapPath,
                    codexLogPaths: Array.isArray(parsed.setup.discoveredSources.codexLogPaths)
                        ? uniq(parsed.setup.discoveredSources.codexLogPaths.map((item) => path.resolve(String(item))))
                        : setup.discoveredSources.codexLogPaths,
                    customJsonLogPaths: Array.isArray(parsed.setup.discoveredSources.customJsonLogPaths)
                        ? uniq(parsed.setup.discoveredSources.customJsonLogPaths.map((item) => path.resolve(String(item))))
                        : setup.discoveredSources.customJsonLogPaths,
                    openClawLogPaths: Array.isArray(parsed.setup.discoveredSources.openClawLogPaths)
                        ? uniq(parsed.setup.discoveredSources.openClawLogPaths.map((item) => path.resolve(String(item))))
                        : setup.discoveredSources.openClawLogPaths
                };
            }
            setup.lastConnectedAt = text(parsed.setup.lastConnectedAt) ?? setup.lastConnectedAt;
            setup.lastValidatedAt = text(parsed.setup.lastValidatedAt) ?? setup.lastValidatedAt;
            setup.lastDiscoveredAt = text(parsed.setup.lastDiscoveredAt) ?? setup.lastDiscoveredAt;
        }
        if (parsed.runtime && typeof parsed.runtime === "object") {
            runtime.enabled = toBool(parsed.runtime.enabled) ?? runtime.enabled;
            runtime.mode = normalizeRuntimeMode(parsed.runtime.mode ?? runtime.mode);
            runtime.endpoint = text(parsed.runtime.endpoint) ?? runtime.endpoint;
            runtime.apiKey = text(parsed.runtime.apiKey) ?? runtime.apiKey;
            runtime.cursor = text(parsed.runtime.cursor) ?? runtime.cursor;
            runtime.lastSyncAt = text(parsed.runtime.lastSyncAt);
            runtime.lastError = text(parsed.runtime.lastError);
            runtime.lastEventCount = num(parsed.runtime.lastEventCount) ?? runtime.lastEventCount;
        }
        if (parsed.alertOverrides && typeof parsed.alertOverrides === "object") {
            for (const [alertId, value] of Object.entries(parsed.alertOverrides)) {
                if (!value || typeof value !== "object")
                    continue;
                const status = text(value.status);
                if (!status || !["open", "acknowledged", "dismissed", "resolved"].includes(status))
                    continue;
                alertOverrides.set(alertId, {
                    status,
                    note: text(value.note),
                    actorId: text(value.actorId) ?? "system:restore",
                    updatedAt: text(value.updatedAt) ?? new Date().toISOString()
                });
            }
        }
        setup.runtime = runtimeView();
    }
    catch {
    }
}
function statePayload(reason) {
    return {
        version: 2,
        reason,
        updatedAt: new Date().toISOString(),
        workspaceId,
        approvedPaths: [...approvedPaths],
        sources: {
            fileSources: sources.fileSources,
            codexLogSources: sources.codexLogSources,
            customJsonSources: sources.customJsonSources,
            openClawSources: sources.openClawSources
        },
        pluginEnabled,
        setup: {
            connected: setup.connected,
            connectionMethod: setup.connectionMethod,
            workspacePath: setup.workspacePath,
            discoveredSources: setup.discoveredSources,
            permissions: setup.permissions,
            lastConnectedAt: setup.lastConnectedAt,
            lastValidatedAt: setup.lastValidatedAt,
            lastDiscoveredAt: setup.lastDiscoveredAt
        },
        runtime: {
            enabled: runtime.enabled,
            mode: runtime.mode,
            endpoint: runtime.endpoint,
            apiKey: runtime.apiKey,
            cursor: runtime.cursor,
            lastSyncAt: runtime.lastSyncAt,
            lastError: runtime.lastError,
            lastEventCount: runtime.lastEventCount
        },
        alertOverrides: Object.fromEntries(alertOverrides.entries())
    };
}
async function persistState(reason) {
    const payload = statePayload(reason);
    const parent = path.dirname(stateFilePath);
    await mkdir(parent, { recursive: true });
    await writeFile(stateFilePath, JSON.stringify(payload, null, 2), "utf8");
}
function parseList(value) {
    return uniq(value.split(",").map((x) => x.trim()).filter(Boolean));
}
function toBool(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "y", "on"].includes(normalized))
            return true;
        if (["0", "false", "no", "n", "off"].includes(normalized))
            return false;
    }
    return undefined;
}
function normalizeRuntimeMode(value) {
    const normalized = text(value)?.toLowerCase();
    if (!normalized)
        return "hybrid";
    if (normalized === "log_only" || normalized === "rpc_only" || normalized === "hybrid")
        return normalized;
    return "hybrid";
}
function uniq(values) {
    return [...new Set(values)];
}
function text(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
async function exists(target) {
    try {
        await access(target);
        return true;
    }
    catch {
        return false;
    }
}
async function isDir(target) {
    try {
        const details = await stat(target);
        return details.isDirectory();
    }
    catch {
        return false;
    }
}
function isApproved(target) {
    const absolute = path.resolve(target);
    return [...approvedPaths].some((approved) => absolute.startsWith(path.resolve(approved)));
}
async function discover(workspacePath) {
    const queue = [{ dir: workspacePath, depth: 0 }];
    const memoryPaths = [];
    const bootstrapPaths = [];
    const codexLogs = [];
    const customLogs = [];
    const openclawLogs = [];
    const ignored = new Set([".git", "node_modules", "dist", "build", ".next", ".cache", ".idea", ".vscode", "coverage"]);
    let scanned = 0;
    while (queue.length > 0 && scanned < 3000) {
        const current = queue.shift();
        if (!current)
            break;
        scanned += 1;
        let entries;
        try {
            entries = await readdir(current.dir, { withFileTypes: true, encoding: "utf8" });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const absolute = path.join(current.dir, entry.name);
            const lower = entry.name.toLowerCase();
            if (entry.isDirectory()) {
                if (current.depth < 6 && !ignored.has(lower))
                    queue.push({ dir: absolute, depth: current.depth + 1 });
                continue;
            }
            if (!entry.isFile())
                continue;
            if (lower === "memory.md")
                memoryPaths.push(absolute);
            else if (lower === "bootstrap.md")
                bootstrapPaths.push(absolute);
            else if (lower.includes("codex") || lower.includes("theia-desktop-dev"))
                codexLogs.push(absolute);
            else if (["openclaw", "trajectory", "trace", "rollout", "episode"].some((k) => lower.includes(k)))
                openclawLogs.push(absolute);
            else if (path.extname(lower) === ".json" && ["workflow", "agent", "session", "event", "trace"].some((k) => lower.includes(k)))
                customLogs.push(absolute);
        }
    }
    return {
        memoryPath: uniq(memoryPaths)[0],
        bootstrapPath: uniq(bootstrapPaths)[0],
        codexLogPaths: uniq(codexLogs).slice(0, 24),
        customJsonLogPaths: uniq(customLogs).slice(0, 24),
        openClawLogPaths: uniq(openclawLogs).slice(0, 24)
    };
}
function deriveRuns(existing, events) {
    const map = new Map(existing.map((run) => [run.runId, run]));
    for (const event of events) {
        if (map.has(event.runId))
            continue;
        map.set(event.runId, {
            runId: event.runId,
            workspaceId,
            agentId: event.agentId,
            objective: text(event.payload.objective) ?? `Observed workflow session ${event.runId}`,
            status: "running",
            startedAt: event.timestamp,
            metadata: { source: "connector_observed" }
        });
    }
    return [...map.values()].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
function toSnapshot(run, tasks, events, versions, workflows) {
    const runEvents = events.filter((event) => event.runId === run.runId);
    if (runEvents.length === 0)
        return undefined;
    return { run, tasks: tasks.filter((task) => task.runId === run.runId), events: runEvents, memoryVersions: versions, workflowCandidates: workflows.filter((w) => w.sourceRunId === run.runId) };
}
function summarize(event) {
    return text(event.payload.summary) ?? text(event.payload.message) ?? text(event.payload.objective) ?? text(event.payload.filePath) ?? event.eventType;
}
function heading(sectionKey) {
    const base = sectionKey.includes(":") ? sectionKey.split(":").slice(1).join(":") : sectionKey;
    return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function healthRatio(plugins) {
    const enabled = plugins.filter((plugin) => plugin.enabled);
    if (enabled.length === 0)
        return 1;
    return enabled.filter((plugin) => plugin.status === "healthy").length / Math.max(1, enabled.length);
}
function tokenUsage(event) {
    const payload = event.payload;
    const prompt = num(payload.promptTokens) ?? num(payload.prompt_tokens) ?? num(payload.inputTokens) ?? num(payload.input_tokens) ?? 0;
    const completion = num(payload.completionTokens) ?? num(payload.completion_tokens) ?? num(payload.outputTokens) ?? num(payload.output_tokens) ?? 0;
    const total = num(payload.totalTokens) ?? num(payload.total_tokens) ?? num(payload.tokens) ?? prompt + completion;
    return { promptTokens: Math.max(0, Math.floor(prompt)), completionTokens: Math.max(0, Math.floor(completion)), totalTokens: Math.max(0, Math.floor(total)) };
}
function num(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
function buildTokenSeries(events) {
    return buildBuckets(events, true);
}
function buildWorkloadSeries(events) {
    return buildBuckets(events, false);
}
function buildBuckets(events, tokenMode) {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() - 11);
    const buckets = new Map();
    for (let i = 0; i < 12; i += 1) {
        const tick = new Date(start);
        tick.setHours(start.getHours() + i);
        buckets.set(tick.toISOString(), tokenMode ? { promptTokens: 0, completionTokens: 0, totalTokens: 0 } : { events: 0, tokens: 0 });
    }
    for (const event of events) {
        const key = new Date(new Date(event.timestamp).setMinutes(0, 0, 0)).toISOString();
        const bucket = buckets.get(key);
        if (!bucket)
            continue;
        const usage = tokenUsage(event);
        if (tokenMode) {
            bucket.promptTokens = (bucket.promptTokens ?? 0) + usage.promptTokens;
            bucket.completionTokens = (bucket.completionTokens ?? 0) + usage.completionTokens;
            bucket.totalTokens = (bucket.totalTokens ?? 0) + usage.totalTokens;
        }
        else {
            bucket.events = (bucket.events ?? 0) + 1;
            bucket.tokens = (bucket.tokens ?? 0) + usage.totalTokens;
        }
    }
    return [...buckets.entries()].map(([bucket, value]) => ({ bucket, label: `${String(new Date(bucket).getHours()).padStart(2, "0")}:00`, ...value }));
}
function buildAgents(runs, events, alerts, connectorHealth) {
    return runs
        .map((run) => {
        const runEvents = events.filter((event) => event.runId === run.runId);
        const runAlerts = alerts.filter((alert) => alert.runId === run.runId);
        const stale = runAlerts.filter((alert) => alert.category === "stale_memory").length;
        const high = runAlerts.filter((alert) => alert.severity === "high" || alert.severity === "critical").length;
        const tokens = runEvents.reduce((sum, event) => sum + tokenUsage(event).totalTokens, 0);
        const workload = clamp(runEvents.length / 80 + tokens / 100000 + (run.status === "running" ? 0.2 : 0));
        const freshness = clamp(1 - stale / Math.max(1, runAlerts.length));
        const risk = clamp(workload * 0.35 + (1 - freshness) * 0.3 + clamp(high / Math.max(1, runAlerts.length)) * 0.2 + (1 - connectorHealth) * 0.15);
        return {
            agentId: run.agentId,
            name: run.agentId.replace(/[-_:/]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            status: run.status === "failed" ? "failed" : run.status === "completed" ? "completed" : "running",
            activeRunId: run.status === "running" ? run.runId : undefined,
            riskScore: risk,
            staleMemoryCount: stale,
            openAlerts: runAlerts.length,
            tokens24h: tokens,
            workloadPressure: workload,
            memoryFreshness: freshness,
            connectorStability: connectorHealth,
            currentObjective: run.objective,
            lastEventAt: runEvents[runEvents.length - 1]?.timestamp
        };
    })
        .sort((a, b) => b.riskScore - a.riskScore);
}
function summarizeRun(run, events) {
    const runEvents = events.filter((event) => event.runId === run.runId);
    return {
        runId: run.runId,
        agentId: run.agentId,
        objective: run.objective,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        eventCount: runEvents.length,
        tokenTotal: runEvents.reduce((sum, event) => sum + tokenUsage(event).totalTokens, 0),
        lastEventAt: runEvents[runEvents.length - 1]?.timestamp
    };
}
function buildMetrics(agents, runs, alerts, tokenSeries, connectorHealth, plugins, memoryRows) {
    const tokens = tokenSeries.reduce((sum, point) => sum + point.totalTokens, 0);
    const runningRuns = runs.filter((run) => run.status === "running").length;
    const activeAgents = agents.filter((agent) => agent.status === "running").length;
    const critical = alerts.filter((alert) => alert.severity === "high" || alert.severity === "critical").length;
    return [
        { label: "Setup Status", value: setup.connected ? "Connected" : "Not connected", trend: setup.health.status },
        { label: "Active Agents", value: `${activeAgents}`, trend: `${agents.length} observed` },
        { label: "Running Runs", value: `${runningRuns}`, trend: `${runs.length} total` },
        { label: "24h Token Burn", value: tokens.toLocaleString(), trend: tokens > 0 ? "live telemetry" : "no token telemetry" },
        { label: "Open Alerts", value: `${alerts.length}`, trend: critical > 0 ? "high severity present" : "no high severity" },
        { label: "Connector Health", value: `${Math.round(connectorHealth * 100)}%`, trend: `${plugins.filter((p) => p.enabled).length} enabled` },
        { label: "Memory Coverage", value: `${memoryRows.length}`, trend: memoryRows.length > 0 ? "mapped sections" : "no memory files" }
    ];
}
function groupMemoryDocs(rows) {
    const grouped = new Map();
    for (const row of rows) {
        const current = grouped.get(row.sourcePath);
        if (current) {
            current.sections.push(row);
            current.sectionCount += 1;
            if (!current.lastUpdatedAt || (row.updatedAt && new Date(row.updatedAt).getTime() > new Date(current.lastUpdatedAt).getTime()))
                current.lastUpdatedAt = row.updatedAt;
        }
        else {
            grouped.set(row.sourcePath, { sourcePath: row.sourcePath, sectionCount: 1, lastUpdatedAt: row.updatedAt, sections: [row] });
        }
    }
    return [...grouped.values()];
}
function compareAgents(agents) {
    const sorted = [...agents].sort((a, b) => b.tokens24h - a.tokens24h);
    const alpha = sorted[0];
    const beta = sorted[1];
    if (!alpha || !beta)
        return [];
    return [
        { metric: "24h Tokens", alphaAgent: `${alpha.tokens24h}`, betaAgent: `${beta.tokens24h}` },
        { metric: "Open Alerts", alphaAgent: `${alpha.openAlerts}`, betaAgent: `${beta.openAlerts}` },
        { metric: "Risk Score", alphaAgent: alpha.riskScore.toFixed(2), betaAgent: beta.riskScore.toFixed(2) },
        { metric: "Workload Pressure", alphaAgent: `${Math.round(alpha.workloadPressure * 100)}%`, betaAgent: `${Math.round(beta.workloadPressure * 100)}%` },
        { metric: "Memory Freshness", alphaAgent: `${Math.round(alpha.memoryFreshness * 100)}%`, betaAgent: `${Math.round(beta.memoryFreshness * 100)}%` }
    ];
}
function clamp(value) {
    return Math.max(0, Math.min(1, value));
}
//# sourceMappingURL=index.js.map

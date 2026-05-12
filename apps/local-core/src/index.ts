// @ts-nocheck
import Fastify from "fastify";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { agentActivityEventSchema, agentControlCommandSchema, agentProfileSchema, collaborationLinkSchema } from "@theia/agent-protocol";
import { evaluateRun } from "@theia/reasoning-engine";
import { TheiaCore } from "./core.js";
import { createHighRiskNotificationEngine } from "./high-risk-notifications.js";
import { createCorsPolicy, evaluateCorsOrigin } from "./http-security.js";
import { LocalAuthStore } from "./local-auth.js";
import { OpsEmailNotifier } from "./ops-email.js";
import { buildOpenClawPairingCreatedResponse } from "./openclaw-pairing-routes.js";
import { OpenClawTelemetryHub } from "./openclaw-telemetry.js";
const execFileAsync = promisify(execFile);
const workspaceId = process.env.THEIA_WORKSPACE_ID ?? "ws_local_default";
const workspaceName = process.env.THEIA_WORKSPACE_NAME ?? "Theia Local Workspace";
const stateFilePath = path.resolve(process.env.THEIA_LOCAL_CORE_STATE_PATH ?? path.join(process.cwd(), ".theia", "local-core-state.json"));
const localAuthFilePath = path.resolve(process.env.THEIA_LOCAL_AUTH_PATH ?? path.join(process.cwd(), ".theia", "local-auth.json"));
const opsEmailFilePath = path.resolve(process.env.THEIA_LOCAL_OPS_EMAIL_PATH ?? path.join(process.cwd(), ".theia", "ops-email.json"));
const emergencyAuditLogPath = path.resolve(process.env.THEIA_EMERGENCY_AUDIT_PATH ?? path.join(process.cwd(), ".theia", "emergency-audit-log.json"));
const openClawTelemetryRetentionHours = Math.max(1, Math.min(24 * 30, num(process.env.THEIA_OPENCLAW_TELEMETRY_RETENTION_HOURS) ?? 7 * 24));
const openClawTelemetryMaxEvents = Math.max(200, Math.min(20000, num(process.env.THEIA_OPENCLAW_TELEMETRY_MAX_EVENTS) ?? 4000));
const openClawTelemetryMaxPayloadBytes = Math.max(4096, Math.min(1024 * 1024, num(process.env.THEIA_OPENCLAW_TELEMETRY_MAX_PAYLOAD_BYTES) ?? 128 * 1024));
const openClawTelemetryMaxEventsPerRequest = Math.max(1, Math.min(1000, num(process.env.THEIA_OPENCLAW_TELEMETRY_MAX_EVENTS_PER_REQUEST) ?? 200));
const openClawTelemetryPairingTtlHours = Math.max(1, Math.min(24 * 7, num(process.env.THEIA_OPENCLAW_TELEMETRY_PAIRING_TTL_HOURS) ?? 24));
const openClawTelemetryDedupeWindowSeconds = Math.max(2, Math.min(120, num(process.env.THEIA_OPENCLAW_TELEMETRY_DEDUPE_WINDOW_SECONDS) ?? 20));
const trustedGatewayStopCommand = process.env.THEIA_OPENCLAW_STOP_COMMAND?.trim() || "openclaw";
const trustedGatewayRestartCommand = process.env.THEIA_OPENCLAW_RESTART_COMMAND?.trim() || "openclaw";
const defaultOpsAdminEmail = process.env.THEIA_OPS_ADMIN_EMAIL?.trim() || "windsurf345@outlook.com";
const localCorePort = Number(process.env.THEIA_CORE_PORT ?? 4318);
const localCoreBaseUrl = text(process.env.THEIA_LOCAL_CORE_BASE_URL) ?? `http://localhost:${localCorePort}`;
const corsPolicy = createCorsPolicy({
    allowedOrigins: process.env.THEIA_ALLOWED_ORIGINS
});
const operatorRoleHeader = "x-theia-operator-role";
const operatorIdHeader = "x-theia-operator-id";
const defaultOperatorRole = normalizeRole(process.env.THEIA_OPERATOR_ROLE);
const defaultOpenClawInstallPath = path.resolve(text(process.env.THEIA_OPENCLAW_WORKSPACE_PATH) ?? path.join(os.homedir(), "src", "openclaw"));
const openClawDiscoveryPaths = uniq([
    defaultOpenClawInstallPath,
    ...parseList(process.env.THEIA_OPENCLAW_DISCOVERY_PATHS ?? "")
].map((entry) => path.resolve(entry)));
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
    transport: normalizeRuntimeTransport(process.env.THEIA_OPENCLAW_RUNTIME_TRANSPORT),
    endpoint: text(process.env.THEIA_OPENCLAW_RUNTIME_URL),
    apiKey: text(process.env.THEIA_OPENCLAW_RUNTIME_API_KEY),
    cursor: text(process.env.THEIA_OPENCLAW_RUNTIME_CURSOR),
    cliCommand: text(process.env.THEIA_OPENCLAW_CLI_COMMAND) ?? (process.platform === "win32" ? "openclaw.cmd" : "openclaw"),
    cliTimeoutMs: num(process.env.THEIA_OPENCLAW_CLI_TIMEOUT_MS) ?? 9000,
    lastSyncAt: undefined,
    lastError: undefined,
    lastEventCount: 0
};
const runtimeEventDedup = new Map();
const eventFeedCursorCache = new Set();
const openClawDiagnosticsState = {
    sourceHealth: {
        totalConfigured: 0,
        existing: [],
        missing: [],
        directories: []
    },
    gateway: undefined,
    status: undefined,
    health: undefined,
    recentLogMeta: undefined
};
const openClawTelemetry = new OpenClawTelemetryHub({
    workspaceId,
    retentionMs: openClawTelemetryRetentionHours * 60 * 60 * 1000,
    maxEvents: openClawTelemetryMaxEvents,
    maxPayloadBytes: openClawTelemetryMaxPayloadBytes,
    maxEventsPerRequest: openClawTelemetryMaxEventsPerRequest,
    dedupeWindowMs: openClawTelemetryDedupeWindowSeconds * 1000
});
const openClawSseSubscribers = new Set();
const agentNetworkMaxEvents = Math.max(500, Math.min(50000, num(process.env.THEIA_AGENT_NETWORK_MAX_EVENTS) ?? 8000));
const agentRegistry = new Map();
const agentSecrets = new Map();
const agentActivityEvents = [];
const collaborationLinks = new Map();
const agentControlCommands = [];
const agentSseSubscribers = new Set();
const agentEventDedupe = new Map();
const emergencyState = {
    status: "ready",
    isStopped: false,
    stopping: false,
    restartAvailable: false,
    triggeredBy: undefined,
    reason: undefined,
    lastRequestedAt: undefined,
    lastUpdatedAt: undefined,
    lastResult: undefined,
    lastError: undefined
};
const alertOverrides = new Map();
const highRiskEngine = createHighRiskNotificationEngine({
    options: {
        onMutation: () => scheduleStatePersist("high-risk.notification")
    }
});
applyHighRiskEnvDefaults();
let runtimeSequence = 0;
let scheduledPersistTimer = undefined;
const authAttemptCache = new Map();
const authRateLimitWindowMs = Math.max(10_000, Math.min(30 * 60_000, (num(process.env.THEIA_AUTH_RATE_LIMIT_WINDOW_SECONDS) ?? 300) * 1000));
const authRateLimitMaxAttempts = Math.max(3, Math.min(30, num(process.env.THEIA_AUTH_RATE_LIMIT_MAX_ATTEMPTS) ?? 8));
const approvedPaths = new Set(uniq([
    ...parseList(process.env.THEIA_APPROVED_PATHS ?? process.cwd()).map((x) => path.resolve(x)),
    ...openClawDiscoveryPaths
]));
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
    runtime: runtimeView(),
    knownOpenClawPaths: [...openClawDiscoveryPaths]
};
const localAuth = new LocalAuthStore(localAuthFilePath, {
    sessionTtlHours: num(process.env.THEIA_AUTH_SESSION_TTL_HOURS) ?? 72
});
const opsEmail = new OpsEmailNotifier(opsEmailFilePath);
await localAuth.init();
await opsEmail.init();
await hydrateFromStateFile();
ensureBuiltinOrchestratorAgent();
syncSetupConnectedFlag();
if (setup.connected)
    setup.lastConnectedAt = new Date().toISOString();
let core = await buildCore();
await validateSetup(false);
const app = Fastify({ logger: false });
app.addHook("onRequest", async (request, reply) => {
    const cors = evaluateCorsOrigin(request.headers?.origin, corsPolicy);
    if (!cors.allowed) {
        reply.code(403);
        return reply.send({ message: cors.reason ?? "Origin is not allowed." });
    }
    if (cors.origin) {
        reply.header("Access-Control-Allow-Origin", cors.origin);
        reply.header("Vary", "Origin");
    }
    reply.header("Access-Control-Allow-Methods", corsPolicy.methods);
    reply.header("Access-Control-Allow-Headers", corsPolicy.headers);
    if (request.method === "OPTIONS") {
        return reply.code(204).send();
    }
});
app.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS") {
        return;
    }
    const url = request.url.split("?")[0] ?? request.url;
    if (url === "/health" || url.startsWith("/auth/") || url === "/openclaw/telemetry/events" || url === "/agent-network/telemetry/events") {
        return;
    }
    const token = bearerToken(request.headers?.authorization);
    if (!token) {
        reply.code(401);
        return reply.send({ message: "Authentication required." });
    }
    const user = await localAuth.authenticateToken(token);
    if (!user) {
        reply.code(401);
        return reply.send({ message: "Session invalid or expired. Sign in again." });
    }
    request.theiaUser = user;
    request.theiaAuthToken = token;
});
app.get("/health", async () => ({
    status: "ok",
    service: "theia-local-core",
    workspaceId,
    setupConnected: setup.connected,
    authRequired: true,
    emergencyStopped: emergencyState.isStopped,
    opsEmailHistory: (await opsEmail.listRecent(1))[0]?.status ?? "none",
    openClawTelemetry: openClawTelemetry.health()
}));
app.post("/auth/signup", async (request, reply) => {
    const email = text(request.body?.email);
    const password = text(request.body?.password);
    if (!email || !password) {
        reply.code(400);
        return { message: "email and password are required." };
    }
    const rateKey = `${request.ip}:${email.toLowerCase()}`;
    if (!consumeAuthAttempt(rateKey)) {
        reply.code(429);
        return { message: "Too many auth attempts. Please retry shortly." };
    }
    try {
        const session = await localAuth.signup({ email, password });
        await notifyOpsEmail(session.user.email, "Welcome to Theia local control center", [
            "Your Theia local account has been created.",
            `Workspace: ${workspaceName} (${workspaceId})`,
            `Signed in as: ${session.user.email}`,
            `Session expires: ${session.expiresAt}`
        ]);
        return {
            token: session.token,
            expiresAt: session.expiresAt,
            user: session.user
        };
    }
    catch (error) {
        reply.code(400);
        return { message: error instanceof Error ? error.message : "Unable to create account." };
    }
});
app.post("/auth/signin", async (request, reply) => {
    const email = text(request.body?.email);
    const password = text(request.body?.password);
    if (!email || !password) {
        reply.code(400);
        return { message: "email and password are required." };
    }
    const rateKey = `${request.ip}:${email.toLowerCase()}`;
    if (!consumeAuthAttempt(rateKey)) {
        reply.code(429);
        return { message: "Too many auth attempts. Please retry shortly." };
    }
    try {
        const session = await localAuth.signin({ email, password });
        return {
            token: session.token,
            expiresAt: session.expiresAt,
            user: session.user
        };
    }
    catch (error) {
        reply.code(401);
        return { message: error instanceof Error ? error.message : "Unable to sign in." };
    }
});
app.get("/auth/me", async (request, reply) => {
    const user = authenticatedUser(request) ??
        (await localAuth.authenticateToken(bearerToken(request.headers?.authorization) ?? ""));
    if (!user) {
        reply.code(401);
        return { message: "Authentication required." };
    }
    return { authenticated: true, user };
});
app.post("/auth/logout", async (request, reply) => {
    const token = request.theiaAuthToken ?? bearerToken(request.headers?.authorization);
    if (!token) {
        reply.code(401);
        return { message: "Authentication required." };
    }
    await localAuth.logout(token);
    return { loggedOut: true };
});
app.get("/operator/context", async (request) => operatorContext(request));
app.get("/setup/openclaw/status", async (request) => ({
    ...setup,
    runtime: runtimeView(),
    diagnostics: {
        sourceHealth: openClawDiagnosticsState.sourceHealth,
        gateway: openClawDiagnosticsState.gateway,
        status: openClawDiagnosticsState.status,
        health: openClawDiagnosticsState.health,
        telemetry: openClawTelemetry.health(),
        emergencyState: {
            ...emergencyState
        }
    },
    approvedPaths: [...approvedPaths],
    operator: operatorContext(request)
}));
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
        sources.openClawSources = await normalizeOpenClawSourcePaths(uniq((requested.openClawLogPaths ?? setup.discoveredSources.openClawLogPaths).map((x) => path.resolve(x))));
        const requiredSources = [...sources.fileSources, ...sources.codexLogSources, ...sources.customJsonSources];
        const openClawMissing = [];
        for (const sourcePath of requiredSources) {
            if (!(await exists(sourcePath)))
                throw new Error(`Missing source path: ${sourcePath}`);
            if (!isApproved(sourcePath))
                throw new Error(`Source path outside approved scope: ${sourcePath}`);
        }
        for (const sourcePath of sources.openClawSources) {
            if (!isApproved(sourcePath))
                throw new Error(`Source path outside approved scope: ${sourcePath}`);
            if (!(await exists(sourcePath))) {
                openClawMissing.push(sourcePath);
            }
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
        runtime.transport = normalizeRuntimeTransport(runtimeInput.transport ?? runtime.transport);
        if (typeof runtimeInput.cliCommand === "string") {
            runtime.cliCommand = runtimeInput.cliCommand.trim() || runtime.cliCommand;
        }
        if (typeof runtimeInput.cliTimeoutMs === "number" && Number.isFinite(runtimeInput.cliTimeoutMs)) {
            runtime.cliTimeoutMs = Math.max(2000, Math.floor(runtimeInput.cliTimeoutMs));
        }
        if (runtime.enabled && runtime.mode !== "log_only" && runtime.transport === "event_feed" && !runtime.endpoint) {
            throw new Error("Runtime endpoint is required when transport is event_feed.");
        }
        if (!runtime.enabled || runtime.mode === "log_only") {
            runtime.lastError = undefined;
            runtime.cursor = undefined;
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
        if (openClawMissing.length > 0) {
            runtime.lastError = `OpenClaw source paths currently missing (${openClawMissing.length}). The connector will suppress noisy run.failed spam and continue probing healthy sources.`;
        }
        await rebuildCore();
        await validateSetup(true);
        await persistState("setup.connect");
        return { connected: true, setup, plugins: await pluginList(), openClawMissing, operator };
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
    const openClawLive = buildOpenClawLive(events, runs, pluginRows);
    const agentNetwork = buildAgentNetworkSnapshot();
    const notificationCenter = {
        settings: highRiskEngine.getSettings(),
        taxonomy: highRiskEngine.getTaxonomy(),
        history: highRiskEngine.listHistory({ limit: 120 }),
        banner: highRiskEngine.getActiveBanner(),
        pipeline: highRiskEngine.getPipelineSummary(),
        slo: highRiskEngine.getSloSummary()
    };
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
        openClawLive,
        agentNetwork,
        metrics: buildMetrics(agents, runs, alerts, tokenSeries, connectorHealth, pluginRows, memoryRows, notificationCenter),
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
        notificationCenter,
        workflowReport: core.getWorkflowReleaseGateReport(),
        workflowPolicy: core.getWorkflowPromotionPolicy(),
        ingestSummary: {
            latestEventCount: ingest.events.length,
            latestMemoryObjects: ingest.memoryObjects.length,
            latestMemoryVersions: ingest.memoryVersions.length
        }
    };
});
app.get("/openclaw/operations", async (request) => {
    const operator = operatorContext(request);
    const ingest = await performIngestion();
    const runs = deriveRuns(core.listRuns(), core.listEvents());
    const events = core.listEvents();
    const plugins = await pluginList();
    return {
        generatedAt: new Date().toISOString(),
        workspaceId,
        workspaceName,
        operator,
        runtime: runtimeView(),
        openClawLive: buildOpenClawLive(events, runs, plugins),
        telemetryHealth: openClawTelemetry.health(),
        connectors: plugins,
        ingestSummary: {
            latestEventCount: ingest.events.length,
            runtimeEventCount: ingest.runtimeEvents.length
        }
    };
});
app.get("/openclaw/pairings", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "view OpenClaw pairings")) {
        return denyCapability(operator, "setup:write");
    }
    return {
        generatedAt: new Date().toISOString(),
        pairings: openClawTelemetry.listPairings(),
        health: openClawTelemetry.health(),
        endpoint: `${localCoreBaseUrl}/openclaw/telemetry/events`
    };
});
app.post("/openclaw/pairings", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "create OpenClaw pairing")) {
        return denyCapability(operator, "setup:write");
    }
    const actor = authenticatedUser(request);
    if (!actor) {
        reply.code(401);
        return { message: "Authenticated operator is required." };
    }
    const ttlHours = Math.max(1, Math.min(24 * 7, num(request.body?.ttlHours) ?? openClawTelemetryPairingTtlHours));
    const label = text(request.body?.label) ?? `OpenClaw pairing for ${actor.email}`;
    const created = openClawTelemetry.createPairing({
        label,
        ttlHours,
        userId: actor.userId,
        userEmail: actor.email,
        sessionId: actor.sessionId
    });
    await persistState("openclaw.telemetry.pairing.create");
    core.addOperationalAudit("openclaw.telemetry.pairing.create", operator.actorId, created.pairing.pairingId, {
        ttlHours,
        label
    });
    broadcastOpenClawSse({
        type: "pairing_created",
        generatedAt: new Date().toISOString(),
        pairingId: created.pairing.pairingId,
        snapshot: buildOpenClawSseSnapshot()
    });
    return buildOpenClawPairingCreatedResponse({
        localCoreBaseUrl,
        pairing: created.pairing,
        token: created.token
    });
});
app.post("/openclaw/pairings/:pairingId/revoke", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "revoke OpenClaw pairing")) {
        return denyCapability(operator, "setup:write");
    }
    const pairingId = text(request.params?.pairingId);
    if (!pairingId) {
        reply.code(400);
        return { message: "pairingId is required." };
    }
    const revoked = openClawTelemetry.revokePairing(pairingId, operator.actorId);
    if (!revoked) {
        reply.code(404);
        return { message: "Pairing not found." };
    }
    await persistState("openclaw.telemetry.pairing.revoke");
    core.addOperationalAudit("openclaw.telemetry.pairing.revoke", operator.actorId, pairingId, {});
    broadcastOpenClawSse({
        type: "pairing_revoked",
        generatedAt: new Date().toISOString(),
        pairingId,
        snapshot: buildOpenClawSseSnapshot()
    });
    return { revoked: true, pairingId };
});
app.get("/openclaw/telemetry/health", async (request) => {
    const operator = operatorContext(request);
    return {
        generatedAt: new Date().toISOString(),
        operator,
        ...openClawTelemetry.health()
    };
});
app.get("/openclaw/telemetry/history", async (request) => {
    const limit = Math.max(1, Math.min(1000, num(request.query?.limit) ?? 160));
    return {
        generatedAt: new Date().toISOString(),
        rows: openClawTelemetry.history(limit)
    };
});
app.get("/openclaw/telemetry/raw", async (request, reply) => {
    const operator = operatorContext(request);
    if (!canReadRawTelemetry(operator)) {
        reply.code(403);
        return {
            message: "Raw telemetry is restricted to owner/operator/reviewer roles."
        };
    }
    const limit = Math.max(1, Math.min(2000, num(request.query?.limit) ?? 300));
    return {
        generatedAt: new Date().toISOString(),
        rows: openClawTelemetry.history(limit)
    };
});
app.post("/openclaw/telemetry/events", async (request, reply) => {
    const pairing = openClawTelemetry.authenticatePairing({
        token: extractPairingToken(request),
        pairingId: text(request.headers?.["x-theia-pairing-id"]) ?? text(request.body?.pairingId)
    });
    if (!pairing) {
        reply.code(401);
        return { message: "Telemetry authentication failed. Pairing token invalid or expired." };
    }
    const ingest = openClawTelemetry.ingest({
        pairing,
        body: request.body ?? {},
        requestRateKey: `${request.ip}:${pairing.pairingId}`
    });
    if (!ingest.ok) {
        reply.code(ingest.statusCode);
        await persistState("openclaw.telemetry.ingest.rejected");
        return {
            message: ingest.message,
            issues: ingest.issues
        };
    }
    if (ingest.acceptedEvents.length > 0) {
        const mappedWorkflowEvents = [];
        for (const event of ingest.acceptedEvents) {
            const mapped = toWorkflowEvent(event);
            mappedWorkflowEvents.push(mapped);
            core.addEvent(mapped);
        }
        highRiskEngine.ingestEvents(mappedWorkflowEvents);
    }
    await persistState("openclaw.telemetry.ingest");
    const snapshot = buildOpenClawSseSnapshot();
    broadcastOpenClawSse({
        type: "telemetry_ingest",
        generatedAt: new Date().toISOString(),
        acceptedCount: ingest.acceptedCount,
        rejectedCount: ingest.rejectedCount,
        dedupedCount: ingest.dedupedCount,
        lastEventAt: ingest.acceptedEvents.at(-1)?.timestamp,
        snapshot
    });
    return {
        accepted: ingest.acceptedCount,
        rejected: ingest.rejectedCount,
        deduped: ingest.dedupedCount,
        message: ingest.message
    };
});
app.get("/openclaw/telemetry/stream", async (request, reply) => {
    const operator = operatorContext(request);
    reply.hijack();
    const raw = reply.raw;
    raw.statusCode = 200;
    raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    raw.setHeader("Cache-Control", "no-cache, no-transform");
    raw.setHeader("Connection", "keep-alive");
    raw.setHeader("X-Accel-Buffering", "no");
    raw.write(`event: ready\ndata: ${JSON.stringify({ generatedAt: new Date().toISOString(), operator })}\n\n`);
    raw.write(`event: snapshot\ndata: ${JSON.stringify(buildOpenClawSseSnapshot())}\n\n`);
    const subscriber = (payload) => {
        try {
            raw.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
        }
        catch {
            // disconnected
        }
    };
    openClawSseSubscribers.add(subscriber);
    const telemetryUnsubscribe = openClawTelemetry.subscribe((record) => {
        subscriber({
            type: "telemetry_event",
            generatedAt: new Date().toISOString(),
            event: record,
            snapshot: buildOpenClawSseSnapshot()
        });
    });
    const keepAlive = setInterval(() => {
        try {
            raw.write(`event: ping\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
        }
        catch {
            // disconnected
        }
    }, 15000);
    const close = () => {
        clearInterval(keepAlive);
        telemetryUnsubscribe();
        openClawSseSubscribers.delete(subscriber);
        try {
            raw.end();
        }
        catch {
            // no-op
        }
    };
    request.raw.on("close", close);
    request.raw.on("end", close);
});
app.post("/openclaw/emergency-stop", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "trigger emergency stop")) {
        return denyCapability(operator, "setup:write");
    }
    const reason = text(request.body?.reason) ?? "Emergency stop triggered by operator.";
    if (emergencyState.stopping) {
        reply.code(409);
        return { message: "Emergency stop is already in progress.", emergencyState };
    }
    emergencyState.stopping = true;
    emergencyState.status = "stopping";
    emergencyState.lastRequestedAt = new Date().toISOString();
    emergencyState.lastUpdatedAt = emergencyState.lastRequestedAt;
    emergencyState.triggeredBy = operator.actorId;
    emergencyState.reason = reason;
    emergencyState.lastResult = undefined;
    emergencyState.lastError = undefined;
    await persistState("openclaw.emergency.stop.start");
    const commandResult = await executeGatewayControl("stop");
    if (commandResult.ok || commandResult.alreadyInDesiredState) {
        const now = new Date().toISOString();
        emergencyState.stopping = false;
        emergencyState.isStopped = true;
        emergencyState.restartAvailable = true;
        emergencyState.status = "stopped";
        emergencyState.lastUpdatedAt = now;
        emergencyState.lastResult = commandResult.summary;
        emergencyState.lastError = undefined;
        runtime.enabled = false;
        runtime.lastError = "Stopped by emergency stop. Restart required before runtime polling resumes.";
        pluginEnabled["openclaw-main"] = false;
        await rebuildCore();
        await validateSetup(false);
        core.addOperationalAudit("openclaw.emergency_stop", operator.actorId, "openclaw.gateway", {
            reason,
            result: commandResult.summary,
            services: ["openclaw gateway", "runtime poller", "openclaw connector"]
        });
        await appendEmergencyAuditEntry({
            actorId: operator.actorId,
            action: "openclaw.emergency_stop",
            status: "success",
            reason,
            result: commandResult.summary,
            affectedServices: ["openclaw gateway", "runtime poller", "openclaw connector"]
        });
        await persistState("openclaw.emergency.stop.success");
        broadcastOpenClawSse({
            type: "emergency_stop",
            generatedAt: new Date().toISOString(),
            status: "stopped",
            actorId: operator.actorId,
            reason,
            snapshot: buildOpenClawSseSnapshot()
        });
        await notifyOpsEmail(operator.actorId, "[Theia] Emergency stop completed", [
            `Actor: ${operator.actorId}`,
            `Workspace: ${workspaceName} (${workspaceId})`,
            `Reason: ${reason}`,
            `Result: ${commandResult.summary}`,
            `Timestamp: ${now}`
        ], {
            includeAdminCopy: true
        });
        return {
            stopped: true,
            message: commandResult.summary,
            emergencyState
        };
    }
    const failureAt = new Date().toISOString();
    emergencyState.stopping = false;
    emergencyState.isStopped = false;
    emergencyState.restartAvailable = true;
    emergencyState.status = "failed";
    emergencyState.lastUpdatedAt = failureAt;
    emergencyState.lastResult = "Gateway stop failed.";
    emergencyState.lastError = commandResult.error ?? "Unknown gateway stop failure.";
    core.addOperationalAudit("openclaw.emergency_stop", operator.actorId, "openclaw.gateway", {
        reason,
        result: "failed",
        error: emergencyState.lastError
    });
    await appendEmergencyAuditEntry({
        actorId: operator.actorId,
        action: "openclaw.emergency_stop",
        status: "failed",
        reason,
        result: "Gateway stop failed.",
        error: emergencyState.lastError,
        affectedServices: ["openclaw gateway"]
    });
    await persistState("openclaw.emergency.stop.failed");
    broadcastOpenClawSse({
        type: "emergency_stop",
        generatedAt: new Date().toISOString(),
        status: "failed",
        actorId: operator.actorId,
        reason,
        error: emergencyState.lastError,
        snapshot: buildOpenClawSseSnapshot()
    });
    await notifyOpsEmail(operator.actorId, "[Theia] Emergency stop failed", [
        `Actor: ${operator.actorId}`,
        `Workspace: ${workspaceName} (${workspaceId})`,
        `Reason: ${reason}`,
        `Error: ${emergencyState.lastError}`,
        `Timestamp: ${failureAt}`
    ], {
        includeAdminCopy: true
    });
    reply.code(502);
    return {
        stopped: false,
        message: "Unable to stop OpenClaw gateway.",
        error: emergencyState.lastError,
        emergencyState
    };
});
app.post("/openclaw/restart-gateway", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "restart gateway")) {
        return denyCapability(operator, "setup:write");
    }
    const resumeAutomation = toBool(request.body?.resumeAutomation) ?? true;
    const commandResult = await executeGatewayControl("start");
    if (!(commandResult.ok || commandResult.alreadyInDesiredState)) {
        emergencyState.status = "failed";
        emergencyState.lastError = commandResult.error ?? "Gateway restart failed.";
        emergencyState.lastUpdatedAt = new Date().toISOString();
        await persistState("openclaw.gateway.restart.failed");
        core.addOperationalAudit("openclaw.gateway_restart", operator.actorId, "openclaw.gateway", {
            result: "failed",
            error: emergencyState.lastError
        });
        await appendEmergencyAuditEntry({
            actorId: operator.actorId,
            action: "openclaw.gateway_restart",
            status: "failed",
            result: "Gateway start failed.",
            error: emergencyState.lastError,
            affectedServices: ["openclaw gateway"]
        });
        await notifyOpsEmail(operator.actorId, "[Theia] Gateway restart failed", [
            `Actor: ${operator.actorId}`,
            `Workspace: ${workspaceName} (${workspaceId})`,
            `Error: ${emergencyState.lastError}`,
            `Timestamp: ${new Date().toISOString()}`
        ], {
            includeAdminCopy: true
        });
        broadcastOpenClawSse({
            type: "gateway_restart",
            generatedAt: new Date().toISOString(),
            status: "failed",
            actorId: operator.actorId,
            error: emergencyState.lastError,
            snapshot: buildOpenClawSseSnapshot()
        });
        reply.code(502);
        return { restarted: false, message: "Gateway restart failed.", error: emergencyState.lastError, emergencyState };
    }
    if (resumeAutomation) {
        pluginEnabled["openclaw-main"] = sources.openClawSources.length > 0 || runtime.mode !== "log_only";
        runtime.enabled = true;
        runtime.lastError = undefined;
        await rebuildCore();
    }
    await validateSetup(false);
    emergencyState.stopping = false;
    emergencyState.isStopped = false;
    emergencyState.status = "ready";
    emergencyState.restartAvailable = false;
    emergencyState.lastError = undefined;
    emergencyState.lastResult = commandResult.summary;
    emergencyState.lastUpdatedAt = new Date().toISOString();
    await persistState("openclaw.gateway.restart.success");
    broadcastOpenClawSse({
        type: "gateway_restart",
        generatedAt: new Date().toISOString(),
        status: "ready",
        actorId: operator.actorId,
        snapshot: buildOpenClawSseSnapshot()
    });
    core.addOperationalAudit("openclaw.gateway_restart", operator.actorId, "openclaw.gateway", {
        result: commandResult.summary,
        resumeAutomation
    });
    await appendEmergencyAuditEntry({
        actorId: operator.actorId,
        action: "openclaw.gateway_restart",
        status: "success",
        result: commandResult.summary,
        affectedServices: ["openclaw gateway", ...(resumeAutomation ? ["runtime poller", "openclaw connector"] : [])]
    });
    await notifyOpsEmail(operator.actorId, "[Theia] Gateway restarted", [
        `Actor: ${operator.actorId}`,
        `Workspace: ${workspaceName} (${workspaceId})`,
        `Result: ${commandResult.summary}`,
        `Automation resumed: ${resumeAutomation ? "yes" : "no"}`,
        `Timestamp: ${new Date().toISOString()}`
    ], {
        includeAdminCopy: true
    });
    return {
        restarted: true,
        message: commandResult.summary,
        emergencyState
    };
});
app.get("/openclaw/emergency-audit", async (request) => {
    const limit = Math.max(1, Math.min(500, num(request.query?.limit) ?? 100));
    try {
        const raw = await readFile(emergencyAuditLogPath, "utf8");
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed?.events) ? parsed.events : [];
        return rows
            .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
            .slice(0, limit);
    }
    catch {
        return [];
    }
});
app.get("/agent-network/snapshot", async (request) => {
    return {
        ...buildAgentNetworkSnapshot(),
        operator: operatorContext(request)
    };
});
app.get("/agent-network/agents", async (request) => {
    return {
        generatedAt: new Date().toISOString(),
        operator: operatorContext(request),
        agents: serializeAgentRegistry()
    };
});
app.post("/agent-network/agents", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "register private agent")) {
        return denyCapability(operator, "setup:write");
    }
    try {
        const created = registerAgentProfile(request.body ?? {}, operator);
        await persistState("agent-network.agent.register");
        broadcastAgentSse({
            type: "agent_registered",
            generatedAt: new Date().toISOString(),
            agentId: created.profile.agentId,
            snapshot: buildAgentNetworkSnapshot()
        });
        core.addOperationalAudit("agent_network.agent.register", operator.actorId, created.profile.agentId, {
            connectionKind: created.profile.connectionKind,
            controlLevel: created.profile.controlLevel
        });
        return {
            agent: decorateAgentProfile(created.profile),
            telemetryToken: created.telemetryToken,
            telemetryEndpoint: `${localCoreBaseUrl}/agent-network/telemetry/events`,
            commands: buildAgentTelemetryCommands(created.profile, created.telemetryToken),
            operator
        };
    }
    catch (error) {
        reply.code(400);
        return { message: error instanceof Error ? error.message : "Unable to register agent." };
    }
});
app.post("/agent-network/discover", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "discover private agents")) {
        return denyCapability(operator, "setup:write");
    }
    const workspacePath = path.resolve(text(request.body?.workspacePath) ?? setup.workspacePath ?? process.cwd());
    if (!(await isDir(workspacePath))) {
        reply.code(400);
        return { message: `Workspace path does not exist: ${workspacePath}` };
    }
    if (!isApproved(workspacePath)) {
        reply.code(403);
        return { message: "Workspace path is outside approved scope." };
    }
    const candidates = await discoverAgentCandidates(workspacePath);
    const now = new Date().toISOString();
    for (const candidate of candidates.autoRegisterable) {
        if (agentRegistry.has(candidate.agentId)) {
            const current = agentRegistry.get(candidate.agentId);
            agentRegistry.set(candidate.agentId, {
                ...current,
                ...candidate,
                updatedAt: now
            });
        }
        else {
            const profile = agentProfileSchema.parse({
                ...candidate,
                registeredAt: now,
                updatedAt: now
            });
            agentRegistry.set(profile.agentId, profile);
        }
    }
    await persistState("agent-network.discover");
    broadcastAgentSse({
        type: "agent_discovery",
        generatedAt: now,
        registeredCount: candidates.autoRegisterable.length,
        manualCount: candidates.manual.length,
        snapshot: buildAgentNetworkSnapshot()
    });
    return {
        generatedAt: now,
        workspacePath,
        registered: candidates.autoRegisterable.map((candidate) => decorateAgentProfile(agentRegistry.get(candidate.agentId))),
        manual: candidates.manual,
        operator
    };
});
app.post("/agent-network/telemetry/events", async (request, reply) => {
    const records = normalizeAgentTelemetryBody(request.body ?? {});
    if (records.length === 0) {
        reply.code(400);
        return { message: "At least one agent activity event is required." };
    }
    const accepted = [];
    const rejected = [];
    const deduped = [];
    for (const raw of records) {
        const parsed = agentActivityEventSchema.safeParse(raw);
        if (!parsed.success) {
            rejected.push({
                eventId: text(raw?.eventId),
                message: "Invalid agent activity event.",
                issues: parsed.error.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: issue.message
                }))
            });
            continue;
        }
        const event = parsed.data;
        const auth = authenticateAgentTelemetry(request, event);
        if (!auth.ok) {
            rejected.push({
                eventId: event.eventId,
                agentId: event.agent.agentId,
                message: auth.message
            });
            continue;
        }
        const dedupeKey = `${event.agent.agentId}:${event.eventId}`;
        if (agentEventDedupe.has(dedupeKey)) {
            deduped.push(event.eventId);
            continue;
        }
        cacheAgentEventKey(dedupeKey);
        const sanitized = sanitizeAgentActivityEvent(event);
        accepted.push(sanitized);
        ingestAgentActivityEvent(sanitized);
    }
    if (accepted.length > 0) {
        const mapped = accepted.map((event) => agentActivityToWorkflowEvent(event));
        for (const workflowEvent of mapped) {
            core.addEvent(workflowEvent);
        }
        highRiskEngine.ingestEvents(mapped);
        await persistState("agent-network.telemetry.ingest");
        broadcastAgentSse({
            type: "agent_telemetry",
            generatedAt: new Date().toISOString(),
            acceptedCount: accepted.length,
            rejectedCount: rejected.length,
            dedupedCount: deduped.length,
            snapshot: buildAgentNetworkSnapshot()
        });
    }
    else if (rejected.length > 0) {
        await persistState("agent-network.telemetry.rejected");
    }
    return {
        accepted: accepted.length,
        rejected: rejected.length,
        deduped: deduped.length,
        issues: rejected.slice(0, 20)
    };
});
app.get("/agent-network/stream", async (request, reply) => {
    const operator = operatorContext(request);
    reply.hijack();
    const raw = reply.raw;
    raw.statusCode = 200;
    raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    raw.setHeader("Cache-Control", "no-cache, no-transform");
    raw.setHeader("Connection", "keep-alive");
    raw.setHeader("X-Accel-Buffering", "no");
    raw.write(`event: ready\ndata: ${JSON.stringify({ generatedAt: new Date().toISOString(), operator })}\n\n`);
    raw.write(`event: snapshot\ndata: ${JSON.stringify(buildAgentNetworkSnapshot())}\n\n`);
    const subscriber = (payload) => {
        try {
            raw.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
        }
        catch {
            // disconnected
        }
    };
    agentSseSubscribers.add(subscriber);
    const keepAlive = setInterval(() => {
        try {
            raw.write(`event: ping\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
        }
        catch {
            // disconnected
        }
    }, 15000);
    const close = () => {
        clearInterval(keepAlive);
        agentSseSubscribers.delete(subscriber);
        try {
            raw.end();
        }
        catch {
            // no-op
        }
    };
    request.raw.on("close", close);
    request.raw.on("end", close);
});
app.post("/agent-network/control", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "control private agent")) {
        return denyCapability(operator, "setup:write");
    }
    try {
        const result = await executeAgentControlCommand(request.body ?? {}, operator);
        await persistState("agent-network.control");
        broadcastAgentSse({
            type: "agent_control",
            generatedAt: new Date().toISOString(),
            command: result.command,
            snapshot: buildAgentNetworkSnapshot()
        });
        return result;
    }
    catch (error) {
        reply.code(400);
        return { message: error instanceof Error ? error.message : "Unable to apply control command." };
    }
});
app.post("/agent-network/links", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "link private agents")) {
        return denyCapability(operator, "setup:write");
    }
    try {
        const link = makeAgentCollaborationLink(request.body ?? {}, operator);
        await persistState("agent-network.link.make");
        broadcastAgentSse({
            type: "agent_link",
            generatedAt: new Date().toISOString(),
            link,
            snapshot: buildAgentNetworkSnapshot()
        });
        return { link, operator };
    }
    catch (error) {
        reply.code(400);
        return { message: error instanceof Error ? error.message : "Unable to create collaboration link." };
    }
});
app.post("/agent-network/links/:linkId/break", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "setup:write", "break private agent link")) {
        return denyCapability(operator, "setup:write");
    }
    const linkId = text(request.params?.linkId);
    const link = linkId ? collaborationLinks.get(linkId) : undefined;
    if (!link) {
        reply.code(404);
        return { message: "Collaboration link not found." };
    }
    const now = new Date().toISOString();
    const updated = {
        ...link,
        status: "broken",
        updatedAt: now
    };
    collaborationLinks.set(updated.linkId, updated);
    const command = createAgentControlAuditCommand({
        action: "break_link",
        actorId: operator.actorId,
        linkIds: [updated.linkId],
        agentIds: [updated.sourceAgentId, updated.targetAgentId],
        reason: text(request.body?.reason) ?? "Collaboration link broken by operator.",
        resultSummary: "Collaboration link is broken. Shared task execution is blocked until a new scoped link is made.",
        affectedResources: [`link:${updated.linkId}`]
    });
    agentControlCommands.unshift(command);
    trimAgentControlCommands();
    core.addOperationalAudit("agent_network.link.break", operator.actorId, updated.linkId, {
        agentIds: command.agentIds,
        reason: command.reason
    });
    await persistState("agent-network.link.break");
    broadcastAgentSse({
        type: "agent_link_broken",
        generatedAt: now,
        link: updated,
        command,
        snapshot: buildAgentNetworkSnapshot()
    });
    return { link: updated, command, operator };
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
app.get("/notifications/high-risk/settings", async () => highRiskEngine.getSettings());
app.put("/notifications/high-risk/settings", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "alert:write", "update high-risk notification settings")) {
        return denyCapability(operator, "alert:write");
    }
    const settings = highRiskEngine.updateSettings(request.body ?? {});
    await persistState("notifications.high-risk.settings");
    return { settings, operator };
});
app.post("/notifications/high-risk/test", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "alert:write", "send test high-risk notification")) {
        return denyCapability(operator, "alert:write");
    }
    const record = await highRiskEngine.enqueueTestNotification(request.body ?? {});
    await persistState("notifications.high-risk.test");
    return { record, operator };
});
app.get("/notifications/high-risk/history", async (request) => {
    const query = request.query ?? {};
    return highRiskEngine.listHistory({
        q: text(query.q),
        severity: text(query.severity),
        status: text(query.status),
        channel: text(query.channel),
        dedupeStatus: text(query.dedupeStatus),
        limit: num(query.limit)
    });
});
app.post("/notifications/high-risk/:notificationId/status", async (request, reply) => {
    const operator = operatorContext(request);
    if (!requireCapability(reply, operator, "alert:write", "update high-risk notification status")) {
        return denyCapability(operator, "alert:write");
    }
    const status = text(request.body?.status);
    if (!status || !["open", "acknowledged", "resolved"].includes(status)) {
        reply.code(400);
        return { message: "status must be one of open|acknowledged|resolved." };
    }
    const updated = highRiskEngine.updateRecordStatus(request.params.notificationId, status);
    if (!updated) {
        reply.code(404);
        return { message: "Notification not found." };
    }
    await persistState("notifications.high-risk.status");
    return updated;
});
app.get("/notifications/high-risk/pipeline", async () => highRiskEngine.getPipelineSummary());
app.get("/notifications/high-risk/slo", async () => highRiskEngine.getSloSummary());
app.get("/notifications/high-risk/banner", async () => highRiskEngine.getActiveBanner());
app.get("/notifications/high-risk/taxonomy", async () => highRiskEngine.getTaxonomy());
app.get("/notifications/ops-email/history", async (request) => {
    const limit = num(request.query?.limit) ?? 120;
    return opsEmail.listRecent(limit);
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
await app.listen({ port: localCorePort, host: "0.0.0.0" });
console.log(`Theia local core listening on http://localhost:${localCorePort}`);
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
        label: "OpenClaw Runtime Telemetry",
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
            ? runtime.lastError ??
                (runtime.transport === "event_feed"
                    ? `${runtime.mode} mode via event-feed (${runtime.endpoint ?? "endpoint missing"})`
                    : `${runtime.mode} mode via OpenClaw CLI (${runtime.cliCommand})`)
            : "Runtime telemetry disabled"
    });
    const telemetryHealth = openClawTelemetry.health();
    checks.push({
        id: "openclaw_push",
        label: "OpenClaw Push Telemetry",
        status: telemetryHealth.activePairings > 0
            ? telemetryHealth.metrics.lastIngestAt
                ? "pass"
                : "warn"
            : "warn",
        detail: telemetryHealth.activePairings > 0
            ? telemetryHealth.metrics.lastIngestAt
                ? `Active pairings: ${telemetryHealth.activePairings}, latest ingest: ${telemetryHealth.metrics.lastIngestAt}`
                : `Active pairings: ${telemetryHealth.activePairings}, waiting for first push event`
            : "No active push pairings configured"
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
            const transportLabel = runtime.transport === "event_feed" ? "event-feed" : "gateway-cli";
            syncHealth = runtime.lastError
                ? `Runtime ${transportLabel} warning: ${runtime.lastError}`
                : runtime.lastSyncAt
                    ? `Runtime ${transportLabel} synchronized (${runtime.mode})`
                    : `Runtime ${transportLabel} configured (${runtime.mode})`;
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
    const openclawSourceCount = sources.openClawSources.length + (runtime.enabled && runtime.mode !== "log_only" ? 1 : 0);
    return [
        { pluginId: "local-file-main", name: "Local File Connector", description: "Reads memory.md/bootstrap.md", capabilities: ["read_memory_files", "read_run_events"], enabled: pluginEnabled["local-file-main"], sourceCount: sources.fileSources.length },
        { pluginId: "codex-cli-main", name: "Codex CLI Connector", description: "Reads Codex logs", capabilities: ["read_run_events", "read_tool_traces", "read_task_plans"], enabled: pluginEnabled["codex-cli-main"], sourceCount: sources.codexLogSources.length },
        { pluginId: "custom-json-main", name: "Custom JSON Connector", description: "Reads custom JSON telemetry", capabilities: ["read_run_events", "read_tool_traces", "read_task_plans"], enabled: pluginEnabled["custom-json-main"], sourceCount: sources.customJsonSources.length },
        { pluginId: "openclaw-main", name: "OpenClaw Connector", description: "Reads OpenClaw traces and optional gateway telemetry", capabilities: ["read_run_events", "read_tool_traces", "read_task_plans", "read_prompts"], enabled: pluginEnabled["openclaw-main"], sourceCount: openclawSourceCount }
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
    const mergedEvents = [...ingest.events, ...runtimeEvents];
    const highRisk = highRiskEngine.ingestEvents(runtimeEvents);
    return {
        ...ingest,
        events: mergedEvents,
        runtimeEvents,
        highRisk
    };
}
async function pollOpenClawRuntime() {
    if (emergencyState.isStopped || emergencyState.stopping) {
        return [];
    }
    if (!pluginEnabled["openclaw-main"]) {
        return [];
    }
    await refreshOpenClawSourcesIfNeeded();
    openClawDiagnosticsState.sourceHealth = await inspectOpenClawSources(sources.openClawSources);
    if (!runtime.enabled || runtime.mode === "log_only") {
        setup.runtime = runtimeView();
        return [];
    }
    try {
        const events = runtime.transport === "event_feed" ? await pollOpenClawRuntimeEventFeed() : await pollOpenClawRuntimeCli();
        runtime.lastEventCount = events.length;
        runtime.lastSyncAt = new Date().toISOString();
        runtime.lastError = undefined;
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
async function refreshOpenClawSourcesIfNeeded() {
    if (sources.openClawSources.length === 0) {
        return;
    }
    const next = [];
    let changed = false;
    for (const configured of sources.openClawSources) {
        const absolute = path.resolve(configured);
        if (await exists(absolute)) {
            next.push(absolute);
            continue;
        }
        const parent = path.dirname(absolute);
        const extension = path.extname(absolute).toLowerCase();
        const inOpenClawSessions = absolute.toLowerCase().includes(`${path.sep}.openclaw${path.sep}agents${path.sep}`.toLowerCase()) &&
            absolute.toLowerCase().includes(`${path.sep}sessions${path.sep}`.toLowerCase());
        if ((extension === ".jsonl" || extension === ".log" || extension === ".ndjson" || extension === ".txt") && (await isDir(parent))) {
            next.push(parent);
            changed = true;
            continue;
        }
        if (inOpenClawSessions && (await isDir(parent))) {
            next.push(parent);
            changed = true;
            continue;
        }
        next.push(absolute);
    }
    const normalized = uniq(next);
    if (changed || normalized.length !== sources.openClawSources.length || normalized.some((entry, idx) => entry !== sources.openClawSources[idx])) {
        sources.openClawSources = normalized;
        setup.discoveredSources.openClawLogPaths = normalized;
        await rebuildCore();
        await persistState("openclaw.sources.refresh");
    }
}
async function pollOpenClawRuntimeEventFeed() {
    if (!runtime.endpoint) {
        throw new Error("Runtime event-feed endpoint is missing.");
    }
    if (/\/v1\/?$/i.test(runtime.endpoint)) {
        throw new Error("Runtime endpoint appears to be an OpenAI-compatible inference endpoint (/v1). Switch runtime transport to gateway_cli or provide a true workflow event-feed URL.");
    }
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
        const dedupeKey = text(record.cursor) ?? text(record.id) ?? text(record.eventId) ?? text(record.timestamp);
        if (dedupeKey && eventFeedCursorCache.has(dedupeKey)) {
            continue;
        }
        if (dedupeKey) {
            cacheRuntimeDedupKey(dedupeKey);
        }
        const event = buildRuntimeEvent(record, runtime.endpoint, "openclaw-runtime-event-feed");
        if (event) {
            events.push(event);
        }
    }
    if (typeof payload?.nextCursor === "string" && payload.nextCursor.trim().length > 0) {
        runtime.cursor = payload.nextCursor.trim();
    }
    else if (records.length > 0) {
        const tail = records[records.length - 1];
        runtime.cursor = text(tail?.cursor) ?? text(tail?.id) ?? text(tail?.eventId) ?? text(tail?.timestamp) ?? runtime.cursor;
    }
    openClawDiagnosticsState.gateway = {
        mode: "event_feed",
        endpoint: runtime.endpoint,
        ok: true
    };
    openClawDiagnosticsState.status = undefined;
    openClawDiagnosticsState.health = undefined;
    openClawDiagnosticsState.recentLogMeta = undefined;
    return events;
}
async function pollOpenClawRuntimeCli() {
    const command = text(runtime.cliCommand);
    if (!command) {
        throw new Error("OpenClaw CLI command is missing.");
    }
    const [gatewayResult, statusResult, healthResult, logsResult] = await Promise.all([
        runOpenClawJsonCommand(["gateway", "status", "--json"]),
        runOpenClawJsonCommand(["status", "--json"]),
        runOpenClawJsonCommand(["health", "--json"]),
        runOpenClawLogsCommand(["logs", "--limit", "40", "--json"])
    ]);
    if (!gatewayResult.ok && !statusResult.ok && !healthResult.ok && !logsResult.ok) {
        throw new Error(gatewayResult.error ?? statusResult.error ?? healthResult.error ?? logsResult.error ?? "OpenClaw CLI probe failed.");
    }
    const gateway = gatewayResult.ok ? gatewayResult.value : undefined;
    const status = statusResult.ok ? statusResult.value : undefined;
    const health = healthResult.ok ? healthResult.value : undefined;
    openClawDiagnosticsState.gateway = gateway;
    openClawDiagnosticsState.status = status;
    openClawDiagnosticsState.health = health;
    const events = [];
    const nowIso = new Date().toISOString();
    if (gateway && typeof gateway === "object") {
        const gatewayHealthy = Boolean(gateway?.rpc?.ok ?? gateway?.health?.healthy);
        events.push({
            eventId: `openclaw-cli:gateway:${Date.now()}:${++runtimeSequence}`,
            workspaceId,
            agentId: "agent:openclaw",
            runId: "run:openclaw",
            eventType: gatewayHealthy ? "run.started" : "run.failed",
            timestamp: nowIso,
            payload: {
                sourceSystem: "openclaw-runtime-cli",
                summary: gatewayHealthy ? "OpenClaw gateway status probe healthy." : "OpenClaw gateway status probe degraded.",
                gateway
            },
            source: {
                connectorId: "openclaw-runtime-cli",
                objectPath: "openclaw gateway status --json"
            },
            confidence: gatewayHealthy ? 0.92 : 0.88,
            evidenceRefs: []
        });
    }
    const sessionCount = num(status?.sessions?.count) ?? num(status?.agents?.totalSessions) ?? 0;
    if (status && typeof status === "object") {
        events.push({
            eventId: `openclaw-cli:status:${Date.now()}:${++runtimeSequence}`,
            workspaceId,
            agentId: "agent:openclaw",
            runId: "run:openclaw",
            eventType: "checkpoint.created",
            timestamp: nowIso,
            payload: {
                sourceSystem: "openclaw-runtime-cli",
                summary: `OpenClaw status reports ${sessionCount} stored session(s).`,
                status
            },
            source: {
                connectorId: "openclaw-runtime-cli",
                objectPath: "openclaw status --json"
            },
            confidence: 0.8,
            evidenceRefs: []
        });
    }
    const healthIsOk = Boolean(health?.ok);
    if (health && typeof health === "object") {
        events.push({
            eventId: `openclaw-cli:health:${Date.now()}:${++runtimeSequence}`,
            workspaceId,
            agentId: "agent:openclaw",
            runId: "run:openclaw",
            eventType: healthIsOk ? "checkpoint.created" : "run.failed",
            timestamp: nowIso,
            payload: {
                sourceSystem: "openclaw-runtime-cli",
                summary: healthIsOk ? "OpenClaw health probe is healthy." : "OpenClaw health probe is degraded.",
                health
            },
            source: {
                connectorId: "openclaw-runtime-cli",
                objectPath: "openclaw health --json"
            },
            confidence: healthIsOk ? 0.85 : 0.9,
            evidenceRefs: []
        });
    }
    const parsedLogRecords = [];
    if (logsResult.ok) {
        for (const line of logsResult.value) {
            const parsed = safeJsonParse(line);
            if (parsed && typeof parsed === "object") {
                parsedLogRecords.push(parsed);
            }
        }
    }
    openClawDiagnosticsState.recentLogMeta = parsedLogRecords.find((entry) => text(entry.type) === "meta") ?? undefined;
    for (const entry of parsedLogRecords) {
        if (text(entry.type) !== "log") {
            continue;
        }
        const timestamp = text(entry.time) ?? nowIso;
        const level = text(entry.level)?.toLowerCase() ?? "info";
        const moduleName = text(entry.module) ?? "openclaw";
        const message = text(entry.message) ?? "";
        const dedupeKey = `${timestamp}:${level}:${moduleName}:${message.slice(0, 180)}`;
        if (runtimeEventDedup.has(dedupeKey)) {
            continue;
        }
        cacheRuntimeDedupKey(dedupeKey);
        events.push({
            eventId: `openclaw-cli:log:${Date.now()}:${++runtimeSequence}`,
            workspaceId,
            agentId: "agent:openclaw",
            runId: "run:openclaw",
            eventType: level === "error" || level === "fatal" ? "run.failed" : "task.updated",
            timestamp,
            payload: {
                sourceSystem: "openclaw-runtime-cli-log",
                summary: message.length > 0 ? message : `${moduleName} ${level}`,
                module: moduleName,
                level,
                log: entry
            },
            source: {
                connectorId: "openclaw-runtime-cli",
                objectPath: "openclaw logs --json"
            },
            confidence: level === "error" || level === "fatal" ? 0.86 : 0.6,
            evidenceRefs: []
        });
    }
    return events;
}
async function runOpenClawJsonCommand(args) {
    try {
        const { stdout } = await execFileAsync(runtime.cliCommand, args, {
            timeout: runtime.cliTimeoutMs,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 5
        });
        const parsed = safeJsonParse(stdout);
        if (!parsed || typeof parsed !== "object") {
            return {
                ok: false,
                error: `Invalid JSON response from '${runtime.cliCommand} ${args.join(" ")}'.`
            };
        }
        return { ok: true, value: parsed };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : `Failed to run ${args.join(" ")}` };
    }
}
async function runOpenClawLogsCommand(args) {
    try {
        const { stdout } = await execFileAsync(runtime.cliCommand, args, {
            timeout: runtime.cliTimeoutMs,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 8
        });
        return {
            ok: true,
            value: stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
        };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : `Failed to run ${args.join(" ")}` };
    }
}
function cacheRuntimeDedupKey(key) {
    const now = Date.now();
    runtimeEventDedup.set(key, now);
    eventFeedCursorCache.add(key);
    if (runtimeEventDedup.size <= 950) {
        return;
    }
    const oldest = [...runtimeEventDedup.entries()].sort((a, b) => a[1] - b[1]).slice(0, 220);
    for (const [staleKey] of oldest) {
        runtimeEventDedup.delete(staleKey);
        eventFeedCursorCache.delete(staleKey);
    }
}
function safeJsonParse(input) {
    if (typeof input !== "string" || input.trim().length === 0) {
        return undefined;
    }
    try {
        return JSON.parse(input);
    }
    catch {
        return undefined;
    }
}
async function inspectOpenClawSources(paths) {
    const report = {
        totalConfigured: paths.length,
        existing: [],
        missing: [],
        directories: []
    };
    for (const sourcePath of paths) {
        try {
            const details = await stat(sourcePath);
            if (details.isDirectory()) {
                report.directories.push(sourcePath);
            }
            else {
                report.existing.push(sourcePath);
            }
        }
        catch {
            report.missing.push(sourcePath);
        }
    }
    return report;
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
function buildRuntimeEvent(record, endpoint, connectorId = "openclaw-runtime") {
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
            sourceSystem: connectorId
        },
        source: {
            connectorId,
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
        transport: runtime.transport,
        endpoint: runtime.endpoint,
        hasApiKey: Boolean(runtime.apiKey),
        cursor: runtime.cursor,
        cliCommand: runtime.cliCommand,
        cliTimeoutMs: runtime.cliTimeoutMs,
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
function authRoleToOperatorRole(role) {
    if (role === "owner")
        return "owner";
    if (role === "member")
        return "operator";
    return "read_only";
}
function bearerToken(authorizationHeader) {
    const raw = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
    if (typeof raw !== "string")
        return undefined;
    const match = raw.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();
    return token && token.length > 0 ? token : undefined;
}
function authenticatedUser(request) {
    return request?.theiaUser;
}
function operatorContext(request) {
    const authUser = authenticatedUser(request);
    if (authUser) {
        const role = authRoleToOperatorRole(authUser.role);
        const capabilities = roleCapabilities[role] ?? [];
        return {
            role,
            actorId: authUser.email,
            capabilities: [...capabilities],
            userId: authUser.userId,
            sessionId: authUser.sessionId
        };
    }
    const headerRole = request?.headers?.[operatorRoleHeader];
    const role = normalizeRole(Array.isArray(headerRole) ? headerRole[0] : headerRole) ?? defaultOperatorRole;
    const actorHeader = request?.headers?.[operatorIdHeader];
    const actorId = text(Array.isArray(actorHeader) ? actorHeader[0] : actorHeader) ?? process.env.THEIA_OPERATOR_ID ?? `${role}@theia`;
    const capabilities = roleCapabilities[role] ?? [];
    return {
        role,
        actorId,
        capabilities: [...capabilities],
        userId: undefined,
        sessionId: undefined
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
function canReadRawTelemetry(operator) {
    return ["owner", "operator", "reviewer"].includes(operator.role);
}
function extractPairingToken(request) {
    const fromHeader = bearerToken(request.headers?.authorization) ??
        text(request.headers?.["x-theia-pairing-token"]) ??
        text(request.headers?.["x-openclaw-pairing-token"]);
    if (fromHeader) {
        return fromHeader;
    }
    return text(request.body?.token) ?? text(request.body?.pairingToken);
}
function toWorkflowEvent(telemetryEvent) {
    const inferredType = inferOpenClawRuntimeEventType({
        eventType: telemetryEvent.eventType,
        status: telemetryEvent.status,
        message: telemetryEvent.message,
        metadata: telemetryEvent.metadata
    });
    const mappedType = inferredType ?? (telemetryEvent.status === "failed" ? "run.failed" : "task.updated");
    const payload = {
        ...telemetryEvent.metadata,
        sourceSystem: "openclaw-telemetry",
        summary: telemetryEvent.message,
        status: telemetryEvent.status,
        severity: telemetryEvent.severity,
        telemetrySource: telemetryEvent.source
    };
    if (telemetryEvent.memorySummary?.filePathHint) {
        payload.filePath = telemetryEvent.memorySummary.filePathHint;
        payload.memorySummary = telemetryEvent.memorySummary;
    }
    if (telemetryEvent.logSummary?.filePathHint) {
        payload.logSummary = telemetryEvent.logSummary;
        if (!payload.filePath) {
            payload.filePath = telemetryEvent.logSummary.filePathHint;
        }
    }
    return {
        eventId: `openclaw-telemetry:${telemetryEvent.id}`,
        workspaceId,
        runId: telemetryEvent.runId,
        agentId: telemetryEvent.agentId,
        taskId: telemetryEvent.taskId,
        eventType: mappedType,
        timestamp: telemetryEvent.timestamp,
        payload,
        source: {
            connectorId: "openclaw-telemetry",
            objectPath: telemetryEvent.pairingId
        },
        confidence: clamp(telemetryEvent.confidence ?? 0.78),
        evidenceRefs: []
    };
}
function quickPluginRows() {
    return pluginListSync().map((plugin) => ({
        ...plugin,
        status: plugin.enabled ? "degraded" : "disabled",
        syncHealth: plugin.enabled ? "Telemetry in progress" : "Disabled",
        lastSync: setup.lastValidatedAt ?? setup.lastConnectedAt
    }));
}
function buildOpenClawSseSnapshot() {
    const events = core.listEvents();
    const runs = deriveRuns(core.listRuns(), events);
    const live = buildOpenClawLive(events, runs, quickPluginRows());
    return {
        generatedAt: new Date().toISOString(),
        openClawLive: live,
        telemetryHealth: openClawTelemetry.health()
    };
}
function broadcastOpenClawSse(payload) {
    for (const subscriber of openClawSseSubscribers) {
        try {
            subscriber(payload);
        }
        catch {
            // no-op
        }
    }
}
function ensureBuiltinOrchestratorAgent() {
    const now = new Date().toISOString();
    const existing = agentRegistry.get("agent:theia-orchestrator");
    const profile = agentProfileSchema.parse({
        agentId: "agent:theia-orchestrator",
        name: "Theia Orchestrator",
        role: "Main Orchestrator",
        domain: "command_center",
        model: "policy-orchestrator",
        vendor: "Theia",
        connectionKind: "local",
        status: emergencyState.isStopped ? "blocked" : "active",
        endpointLabel: "local-core",
        tools: ["agent registry", "policy engine", "audit log", "dashboard update"],
        skills: ["activity classification", "safe reasoning summaries", "collaboration routing"],
        connectors: ["local-core", "openclaw", "agent-network"],
        memorySummary: "Tracks registered private agents, collaboration links, operator commands, and recent telemetry summaries.",
        soulSummary: "Coordinate private agents through explicit links, validated telemetry, redacted summaries, and visible operator controls. Never expose hidden chain-of-thought.",
        controlLevel: "full",
        canCollaborate: true,
        canEmergencyStop: false,
        trustLevel: "trusted",
        registeredAt: existing?.registeredAt ?? now,
        updatedAt: now
    });
    agentRegistry.set(profile.agentId, {
        ...profile,
        lastSeenAt: now,
        system: true
    });
}
function registerAgentProfile(input, operator) {
    const now = new Date().toISOString();
    const name = text(input.name) ?? text(input.agentName) ?? "Private Agent";
    const requestedId = text(input.agentId) ?? `agent:${slugifyAgentName(name)}:${randomUUID().slice(0, 8)}`;
    const existing = agentRegistry.get(requestedId);
    const candidate = {
        agentId: requestedId,
        name,
        role: text(input.role) ?? text(input.domain) ?? existing?.role ?? "Agent",
        domain: text(input.domain) ?? existing?.domain ?? "general",
        model: text(input.model) ?? existing?.model,
        vendor: text(input.vendor) ?? existing?.vendor,
        connectionKind: normalizeAgentConnectionKind(input.connectionKind ?? input.kind ?? input.type),
        status: normalizeAgentStatus(input.status) ?? existing?.status ?? "idle",
        endpointLabel: text(input.endpointLabel) ?? text(input.endpoint) ?? existing?.endpointLabel,
        tools: stringList(input.tools ?? input.installedTools),
        skills: stringList(input.skills ?? input.installedSkills),
        connectors: stringList(input.connectors ?? input.apiConnectors),
        memorySummary: text(input.memorySummary) ?? existing?.memorySummary,
        soulSummary: text(input.soulSummary) ?? existing?.soulSummary,
        controlLevel: normalizeControlLevel(input.controlLevel) ?? existing?.controlLevel ?? "observe_only",
        canCollaborate: toBool(input.canCollaborate) ?? existing?.canCollaborate ?? false,
        canEmergencyStop: toBool(input.canEmergencyStop) ?? existing?.canEmergencyStop ?? false,
        trustLevel: normalizeTrustLevel(input.trustLevel) ?? existing?.trustLevel ?? "standard",
        registeredAt: existing?.registeredAt ?? now,
        updatedAt: now
    };
    const profile = agentProfileSchema.parse(candidate);
    agentRegistry.set(profile.agentId, {
        ...existing,
        ...profile,
        lastSeenAt: existing?.lastSeenAt,
        userIntroduced: true
    });
    let telemetryToken;
    const rotate = toBool(input.rotateTelemetryToken) ?? !agentSecrets.has(profile.agentId);
    if (rotate) {
        telemetryToken = createAgentTelemetryToken();
        agentSecrets.set(profile.agentId, {
            tokenHash: sha256(telemetryToken),
            createdAt: now,
            createdBy: operator.actorId,
            revokedAt: undefined
        });
    }
    return {
        profile: agentRegistry.get(profile.agentId),
        telemetryToken
    };
}
function buildAgentTelemetryCommands(profile, token) {
    const endpoint = `${localCoreBaseUrl}/agent-network/telemetry/events`;
    if (!token) {
        return {
            endpoint,
            note: "Existing telemetry token is not shown again. Rotate the token to generate new setup commands."
        };
    }
    const event = {
        schemaVersion: "agent-activity/v1",
        eventId: "evt:" + Date.now(),
        timestamp: new Date().toISOString(),
        workspaceId,
        agent: {
            agentId: profile.agentId,
            name: profile.name,
            role: profile.role,
            domain: profile.domain,
            model: profile.model,
            vendor: profile.vendor,
            connectionKind: profile.connectionKind
        },
        classification: {
            category: "idle",
            status: "idle",
            riskLevel: "low",
            confidence: 0.95
        },
        what: {
            safeSummary: "Agent connected to Theia command center.",
            decisionTrace: ["Connection test event only."]
        },
        where: {
            targets: []
        },
        how: {
            toolCalls: [],
            filesAccessed: [],
            websitesVisited: [],
            apiCalls: [],
            collaborationLinkIds: [],
            userVisibleExplanation: "This verifies the telemetry token and event schema."
        },
        usage: {
            model: profile.model,
            vendor: profile.vendor
        },
        privacy: {
            redactionApplied: true,
            sensitiveKinds: []
        }
    };
    const json = JSON.stringify(event).replace(/'/g, "''");
    return {
        endpoint,
        powershell: [
            `$env:THEIA_AGENT_ID='${profile.agentId}'`,
            `$env:THEIA_AGENT_TOKEN='${token}'`,
            `$env:THEIA_AGENT_TELEMETRY_ENDPOINT='${endpoint}'`,
            `Invoke-RestMethod -Method Post -Uri $env:THEIA_AGENT_TELEMETRY_ENDPOINT -Headers @{ Authorization = "Bearer $env:THEIA_AGENT_TOKEN"; "x-theia-agent-id" = $env:THEIA_AGENT_ID } -ContentType "application/json" -Body '${json}'`
        ],
        bash: [
            `export THEIA_AGENT_ID='${profile.agentId}'`,
            `export THEIA_AGENT_TOKEN='${token}'`,
            `export THEIA_AGENT_TELEMETRY_ENDPOINT='${endpoint}'`,
            `curl -X POST "$THEIA_AGENT_TELEMETRY_ENDPOINT" -H "Authorization: Bearer $THEIA_AGENT_TOKEN" -H "x-theia-agent-id: $THEIA_AGENT_ID" -H "Content-Type: application/json" -d '${JSON.stringify(event)}'`
        ]
    };
}
function normalizeAgentTelemetryBody(body) {
    if (Array.isArray(body)) {
        return body.filter(Boolean);
    }
    if (Array.isArray(body?.events)) {
        return body.events.filter(Boolean);
    }
    if (body && typeof body === "object") {
        return [body];
    }
    return [];
}
function authenticateAgentTelemetry(request, event) {
    if (event.workspaceId !== workspaceId) {
        return { ok: false, message: "Telemetry workspace does not match this local core." };
    }
    const headerAgentId = text(request.headers?.["x-theia-agent-id"]);
    if (headerAgentId && headerAgentId !== event.agent.agentId) {
        return { ok: false, message: "Telemetry agent header does not match event agent." };
    }
    const profile = agentRegistry.get(event.agent.agentId);
    if (!profile) {
        return { ok: false, message: "Agent is not registered. Add it in the dashboard first." };
    }
    if (profile.status === "emergency-stopped") {
        return { ok: false, message: "Agent is emergency-stopped and cannot report until an operator re-enables it." };
    }
    const secret = agentSecrets.get(event.agent.agentId);
    if (!secret || secret.revokedAt) {
        return { ok: false, message: "Agent telemetry token is missing or revoked." };
    }
    const token = readAgentTelemetryToken(request);
    if (!token || sha256(token) !== secret.tokenHash) {
        return { ok: false, message: "Agent telemetry authentication failed." };
    }
    return { ok: true };
}
function readAgentTelemetryToken(request) {
    return bearerToken(request.headers?.authorization) ??
        text(request.headers?.["x-theia-agent-token"]) ??
        text(request.body?.token) ??
        text(request.body?.agentToken);
}
function ingestAgentActivityEvent(event) {
    const now = new Date().toISOString();
    const current = agentRegistry.get(event.agent.agentId);
    const profile = agentProfileSchema.parse({
        agentId: event.agent.agentId,
        name: event.agent.name,
        role: event.agent.role,
        domain: event.agent.domain,
        model: event.agent.model ?? current?.model,
        vendor: event.agent.vendor ?? current?.vendor,
        connectionKind: event.agent.connectionKind,
        status: event.classification.status,
        endpointLabel: current?.endpointLabel,
        tools: current?.tools ?? [],
        skills: current?.skills ?? [],
        connectors: current?.connectors ?? [],
        memorySummary: current?.memorySummary,
        soulSummary: current?.soulSummary,
        controlLevel: current?.controlLevel ?? "observe_only",
        canCollaborate: current?.canCollaborate ?? false,
        canEmergencyStop: current?.canEmergencyStop ?? false,
        trustLevel: current?.trustLevel ?? "standard",
        registeredAt: current?.registeredAt ?? now,
        updatedAt: event.timestamp
    });
    agentRegistry.set(profile.agentId, {
        ...current,
        ...profile,
        lastSeenAt: event.timestamp,
        lastRiskLevel: event.classification.riskLevel
    });
    agentActivityEvents.unshift(event);
    if (agentActivityEvents.length > agentNetworkMaxEvents) {
        agentActivityEvents.length = agentNetworkMaxEvents;
    }
    for (const linkId of event.how.collaborationLinkIds ?? []) {
        const link = collaborationLinks.get(linkId);
        if (!link)
            continue;
        collaborationLinks.set(linkId, {
            ...link,
            lastActivityAt: event.timestamp,
            updatedAt: now
        });
    }
}
function sanitizeAgentActivityEvent(event) {
    const redacted = redactSensitive(event);
    return {
        ...redacted,
        privacy: {
            ...redacted.privacy,
            redactionApplied: true
        }
    };
}
function agentActivityToWorkflowEvent(event) {
    const category = event.classification.category;
    const status = event.classification.status;
    const eventType = status === "failed" || category === "error"
        ? "run.failed"
        : status === "blocked" || category === "blocked"
            ? "approval.requested"
            : category === "tool_execution"
                ? "tool_call.completed"
                : category === "memory_update"
                    ? "memory.changed"
                    : status === "idle"
                        ? "checkpoint.created"
                        : "task.updated";
    return {
        eventId: `agent-network:${event.eventId}`,
        workspaceId,
        runId: event.runId ?? `run:${event.agent.agentId}`,
        agentId: event.agent.agentId,
        taskId: event.taskId,
        eventType,
        timestamp: event.timestamp,
        payload: {
            sourceSystem: "agent-network",
            category,
            customCategory: event.classification.customCategory,
            status,
            riskLevel: event.classification.riskLevel,
            summary: event.what.safeSummary,
            currentTask: event.what.currentTask,
            objective: event.what.objective,
            decisionTrace: event.what.decisionTrace,
            userVisibleExplanation: event.how.userVisibleExplanation,
            filesAccessed: event.how.filesAccessed,
            websitesVisited: event.how.websitesVisited,
            apiCalls: event.how.apiCalls,
            promptTokens: event.usage.inputTokens,
            completionTokens: event.usage.outputTokens,
            totalTokens: event.usage.totalTokens,
            estimatedCostUsd: event.usage.estimatedCostUsd,
            model: event.usage.model ?? event.agent.model,
            vendor: event.usage.vendor ?? event.agent.vendor
        },
        source: {
            connectorId: "agent-network",
            objectPath: event.privacy.rawLogRef ?? event.where.targets[0]?.ref ?? event.agent.connectionKind
        },
        confidence: clamp(event.classification.confidence ?? 0.75),
        evidenceRefs: []
    };
}
function buildAgentNetworkSnapshot() {
    ensureBuiltinOrchestratorAgent();
    const generatedAt = new Date().toISOString();
    const profiles = serializeAgentRegistry();
    const events = [...agentActivityEvents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const activeLinks = [...collaborationLinks.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const decoratedAgents = profiles.map((profile, index) => {
        const agentEvents = events.filter((event) => event.agent.agentId === profile.agentId);
        const stats = buildAgentStats(profile, agentEvents);
        const latest = agentEvents[0];
        const activityScore = computeAgentActivityScore(profile, agentEvents);
        const activeLinkCount = activeLinks.filter((link) => link.status === "active" && (link.sourceAgentId === profile.agentId || link.targetAgentId === profile.agentId)).length;
        return {
            ...profile,
            stats,
            latestEvent: latest ? summarizeAgentEvent(latest) : undefined,
            activityScore,
            bubbleSize: Math.round(44 + activityScore * 72),
            bubbleState: bubbleState(profile, latest, stats),
            networkPosition: networkPosition(index, profiles.length),
            activeLinkCount,
            tokenUsage: stats.tokens,
            costEstimateUsd: stats.estimatedCostUsd,
            currentTool: latest?.how.toolCalls[0]?.name ?? latest?.where.targets[0]?.label,
            currentTarget: latest?.where.targets[0],
            currentTask: latest?.what.currentTask ?? latest?.what.safeSummary,
            safeReasoningSummary: latest?.what.decisionTrace?.slice(0, 4) ?? []
        };
    });
    const totals = decoratedAgents.reduce((acc, agent) => {
        acc.inputTokens += agent.stats.tokens.inputTokens;
        acc.outputTokens += agent.stats.tokens.outputTokens;
        acc.totalTokens += agent.stats.tokens.totalTokens;
        acc.estimatedCostUsd += agent.stats.estimatedCostUsd;
        acc.runtimeMs += agent.stats.runtimeMs;
        acc.logBytes += agent.stats.logBytes;
        return acc;
    }, {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        runtimeMs: 0,
        logBytes: 0
    });
    const activeAgents = decoratedAgents.filter((agent) => ["active", "collaborating", "waiting", "blocked"].includes(agent.status)).length;
    const stoppedAgents = decoratedAgents.filter((agent) => agent.status === "stopped" || agent.status === "emergency-stopped").length;
    const system = {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        loadAverage: os.loadavg(),
        totalRamBytes: os.totalmem(),
        freeRamBytes: os.freemem(),
        usedRamBytes: os.totalmem() - os.freemem(),
        processRamBytes: process.memoryUsage().rss,
        uptimeSeconds: Math.round(os.uptime())
    };
    const categories = [
        "coding",
        "research",
        "browsing",
        "planning",
        "writing",
        "design",
        "finance",
        "operations",
        "customer_support",
        "file_management",
        "memory_update",
        "tool_execution",
        "idle",
        "blocked",
        "error"
    ];
    return {
        generatedAt,
        workspaceId,
        workspaceName,
        protocolVersion: "agent-activity/v1",
        orchestrator: {
            agentId: "agent:theia-orchestrator",
            name: "Theia Orchestrator",
            status: agentRegistry.get("agent:theia-orchestrator")?.status ?? "active",
            soulSummary: agentRegistry.get("agent:theia-orchestrator")?.soulSummary,
            memorySummary: agentRegistry.get("agent:theia-orchestrator")?.memorySummary,
            telemetryEndpoint: `${localCoreBaseUrl}/agent-network/telemetry/events`,
            streamEndpoint: `${localCoreBaseUrl}/agent-network/stream`,
            categories,
            customCategoryPattern: "^[a-z][a-z0-9_]{2,31}$"
        },
        stats: {
            activeAgents,
            totalAgents: decoratedAgents.length,
            stoppedAgents,
            activeLinks: activeLinks.filter((link) => link.status === "active").length,
            blockedLinks: activeLinks.filter((link) => link.status === "blocked" || link.status === "broken").length,
            recentEvents: events.length,
            tokens: totals,
            estimatedSpendUsd: Number(totals.estimatedCostUsd.toFixed(4)),
            runtimeMs: totals.runtimeMs,
            logBytes: totals.logBytes,
            system,
            perAgent: decoratedAgents.map((agent) => ({
                agentId: agent.agentId,
                name: agent.name,
                status: agent.status,
                tokens: agent.stats.tokens.totalTokens,
                estimatedCostUsd: agent.stats.estimatedCostUsd,
                runtimeMs: agent.stats.runtimeMs,
                cpuPercent: agent.stats.cpuPercent,
                ramBytes: agent.stats.ramBytes,
                activityScore: agent.activityScore
            }))
        },
        agents: decoratedAgents,
        links: activeLinks,
        events: events.slice(0, 160).map(summarizeAgentEvent),
        commands: agentControlCommands.slice(0, 80)
    };
}
function serializeAgentRegistry() {
    return [...agentRegistry.values()].map(decorateAgentProfile).sort((a, b) => {
        if (a.agentId === "agent:theia-orchestrator")
            return -1;
        if (b.agentId === "agent:theia-orchestrator")
            return 1;
        return String(a.name).localeCompare(String(b.name));
    });
}
function decorateAgentProfile(profile) {
    const secret = agentSecrets.get(profile.agentId);
    return {
        ...profile,
        hasTelemetryToken: Boolean(secret && !secret.revokedAt),
        telemetryRevokedAt: secret?.revokedAt,
        tokenCreatedAt: secret?.createdAt
    };
}
function buildAgentStats(profile, events) {
    return events.reduce((acc, event) => {
        acc.eventCount += 1;
        acc.tokens.inputTokens += event.usage.inputTokens ?? 0;
        acc.tokens.outputTokens += event.usage.outputTokens ?? 0;
        acc.tokens.totalTokens += event.usage.totalTokens ?? (event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0);
        acc.estimatedCostUsd += event.usage.estimatedCostUsd ?? 0;
        acc.runtimeMs += event.usage.runtimeMs ?? 0;
        acc.logBytes += event.usage.logBytes ?? 0;
        acc.cpuPercent = Math.max(acc.cpuPercent ?? 0, event.usage.cpuPercent ?? 0);
        acc.ramBytes = Math.max(acc.ramBytes ?? 0, event.usage.ramBytes ?? 0);
        acc.gpuPercent = Math.max(acc.gpuPercent ?? 0, event.usage.gpuPercent ?? 0);
        acc.vramBytes = Math.max(acc.vramBytes ?? 0, event.usage.vramBytes ?? 0);
        acc.memoryFiles = uniq([...acc.memoryFiles, ...(event.usage.memoryFiles ?? [])]);
        acc.paidServices = uniq([...acc.paidServices, ...(event.usage.paidServices ?? [])]);
        if (!acc.lastEventAt || new Date(event.timestamp).getTime() > new Date(acc.lastEventAt).getTime()) {
            acc.lastEventAt = event.timestamp;
        }
        return acc;
    }, {
        eventCount: 0,
        tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        estimatedCostUsd: 0,
        runtimeMs: 0,
        cpuPercent: 0,
        ramBytes: 0,
        gpuPercent: 0,
        vramBytes: 0,
        memoryFiles: [],
        paidServices: [],
        logBytes: 0,
        lastEventAt: profile.lastSeenAt
    });
}
function summarizeAgentEvent(event) {
    return {
        eventId: event.eventId,
        timestamp: event.timestamp,
        sequence: event.sequence,
        agentId: event.agent.agentId,
        agentName: event.agent.name,
        category: event.classification.category,
        customCategory: event.classification.customCategory,
        status: event.classification.status,
        riskLevel: event.classification.riskLevel,
        confidence: event.classification.confidence,
        objective: event.what.objective,
        currentTask: event.what.currentTask,
        safeSummary: event.what.safeSummary,
        decisionTrace: event.what.decisionTrace,
        targets: event.where.targets,
        toolCalls: event.how.toolCalls,
        filesAccessed: event.how.filesAccessed,
        websitesVisited: event.how.websitesVisited,
        apiCalls: event.how.apiCalls,
        collaborationLinkIds: event.how.collaborationLinkIds,
        userVisibleExplanation: event.how.userVisibleExplanation,
        usage: event.usage,
        privacy: event.privacy
    };
}
function computeAgentActivityScore(profile, events) {
    const latest = events[0];
    if (!latest) {
        return profile.status === "active" ? 0.35 : 0.08;
    }
    const ageMinutes = Math.max(0, (Date.now() - new Date(latest.timestamp).getTime()) / 60000);
    const recency = clamp(1 - ageMinutes / 90);
    const eventPressure = clamp(events.filter((event) => Date.now() - new Date(event.timestamp).getTime() <= 60 * 60 * 1000).length / 28);
    const tokenPressure = clamp(events.reduce((sum, event) => sum + (event.usage.totalTokens ?? 0), 0) / 250000);
    const statusBoost = ["active", "collaborating", "waiting", "blocked"].includes(profile.status) ? 0.22 : 0;
    return clamp(recency * 0.4 + eventPressure * 0.25 + tokenPressure * 0.2 + statusBoost);
}
function bubbleState(profile, latest, stats) {
    if (profile.status === "emergency-stopped")
        return "emergency-stopped";
    if (profile.status === "stopped" || profile.status === "disconnected")
        return "stopped";
    if (latest?.classification.riskLevel === "critical" || latest?.classification.riskLevel === "high")
        return "warning";
    if (stats.estimatedCostUsd >= 5)
        return "high-cost";
    if (profile.status === "blocked" || latest?.classification.status === "blocked")
        return "blocked";
    if (profile.status === "collaborating")
        return "collaborating";
    if (profile.status === "active")
        return "active";
    return "idle";
}
function networkPosition(index, count) {
    if (index === 0) {
        return { x: 50, y: 50 };
    }
    const ring = count <= 6 ? 34 : index % 2 === 0 ? 38 : 26;
    const angle = ((index - 1) / Math.max(1, count - 1)) * Math.PI * 2 - Math.PI / 2;
    return {
        x: Math.round(50 + Math.cos(angle) * ring),
        y: Math.round(50 + Math.sin(angle) * ring)
    };
}
function makeAgentCollaborationLink(input, operator) {
    const sourceAgentId = text(input.sourceAgentId) ?? text(input.agentAId) ?? stringList(input.agentIds)[0];
    const targetAgentId = text(input.targetAgentId) ?? text(input.agentBId) ?? stringList(input.agentIds)[1];
    if (!sourceAgentId || !targetAgentId || sourceAgentId === targetAgentId) {
        throw new Error("Two different agent IDs are required to make a collaboration link.");
    }
    const source = agentRegistry.get(sourceAgentId);
    const target = agentRegistry.get(targetAgentId);
    if (!source || !target) {
        throw new Error("Both agents must be registered before linking.");
    }
    if (!source.canCollaborate || !target.canCollaborate) {
        throw new Error("Both agents must allow collaboration before a link can be made.");
    }
    const taskScope = text(input.taskScope) ?? text(input.scope) ?? text(input.instruction);
    if (!taskScope) {
        throw new Error("A task scope is required for collaboration links.");
    }
    const now = new Date().toISOString();
    const link = collaborationLinkSchema.parse({
        linkId: text(input.linkId) ?? `link:${randomUUID()}`,
        sourceAgentId,
        targetAgentId,
        status: "active",
        taskScope,
        permissions: stringList(input.permissions).slice(0, 12),
        priority: ["low", "normal", "high"].includes(text(input.priority)) ? text(input.priority) : "normal",
        createdBy: operator.actorId,
        createdAt: now,
        updatedAt: now,
        expiresAt: text(input.expiresAt),
        lastActivityAt: undefined
    });
    collaborationLinks.set(link.linkId, link);
    agentRegistry.set(source.agentId, { ...source, status: "collaborating", updatedAt: now });
    agentRegistry.set(target.agentId, { ...target, status: "collaborating", updatedAt: now });
    const command = createAgentControlAuditCommand({
        action: "make_link",
        actorId: operator.actorId,
        agentIds: [sourceAgentId, targetAgentId],
        linkIds: [link.linkId],
        reason: taskScope,
        instruction: text(input.instruction),
        highRisk: toBool(input.highRisk) ?? false,
        resultSummary: "Collaboration link created with explicit task scope and permissions.",
        affectedResources: [`link:${link.linkId}`]
    });
    agentControlCommands.unshift(command);
    trimAgentControlCommands();
    core.addOperationalAudit("agent_network.link.make", operator.actorId, link.linkId, {
        sourceAgentId,
        targetAgentId,
        taskScope,
        permissions: link.permissions,
        priority: link.priority
    });
    return link;
}
async function executeAgentControlCommand(input, operator) {
    const action = normalizeAgentControlAction(input.action);
    if (!action) {
        throw new Error("Control action is required.");
    }
    const agentIds = stringList(input.agentIds ?? input.agents ?? input.agentId).filter((agentId) => agentRegistry.has(agentId));
    const linkIds = stringList(input.linkIds ?? input.linkId).filter((linkId) => collaborationLinks.has(linkId));
    const highRisk = toBool(input.highRisk) ?? ["emergency_stop", "make_link", "focus_together"].includes(action);
    const confirmed = toBool(input.confirmed) ?? false;
    if (highRisk && !confirmed) {
        throw new Error("This high-risk control requires explicit confirmation.");
    }
    const now = new Date().toISOString();
    let status = "completed";
    let resultSummary = "Command accepted.";
    const affectedResources = [];
    if (action === "query") {
        const summaries = agentIds.map((agentId) => {
            const latest = agentActivityEvents.find((event) => event.agent.agentId === agentId);
            const profile = agentRegistry.get(agentId);
            return `${profile?.name ?? agentId}: ${latest?.how.userVisibleExplanation ?? latest?.what.safeSummary ?? "No recent activity report is available."}`;
        });
        resultSummary = summaries.join(" ");
    }
    else if (action === "emergency_stop") {
        if (agentIds.length === 0) {
            throw new Error("At least one registered agent is required for emergency stop.");
        }
        const denied = agentIds.filter((agentId) => !canControlAgent(agentRegistry.get(agentId), "emergency_stop"));
        if (denied.length > 0) {
            throw new Error(`Agent control level does not allow emergency stop: ${denied.join(", ")}`);
        }
        const openClawAgents = agentIds.map((agentId) => agentRegistry.get(agentId)).filter((profile) => profile?.connectionKind === "openclaw");
        let gatewayResult;
        if (openClawAgents.length > 0) {
            gatewayResult = await executeGatewayControl("stop");
            if (gatewayResult.ok || gatewayResult.alreadyInDesiredState) {
                runtime.enabled = false;
                runtime.lastError = "Stopped by agent-network emergency stop.";
                pluginEnabled["openclaw-main"] = false;
                emergencyState.status = "stopped";
                emergencyState.isStopped = true;
                emergencyState.restartAvailable = true;
                emergencyState.triggeredBy = operator.actorId;
                emergencyState.reason = text(input.reason) ?? "Agent emergency stop.";
                emergencyState.lastUpdatedAt = now;
                emergencyState.lastResult = gatewayResult.summary;
                await rebuildCore();
            }
            else {
                status = "failed";
                resultSummary = gatewayResult.error ?? "OpenClaw gateway stop failed.";
            }
        }
        for (const agentId of agentIds) {
            const profile = agentRegistry.get(agentId);
            if (!profile)
                continue;
            agentRegistry.set(agentId, {
                ...profile,
                status: "emergency-stopped",
                updatedAt: now,
                emergencyStoppedAt: now,
                emergencyStoppedBy: operator.actorId
            });
            const secret = agentSecrets.get(agentId);
            if (secret) {
                agentSecrets.set(agentId, {
                    ...secret,
                    revokedAt: now,
                    revokedBy: operator.actorId
                });
            }
            affectedResources.push(`agent:${agentId}`);
            for (const link of collaborationLinks.values()) {
                if (link.sourceAgentId === agentId || link.targetAgentId === agentId) {
                    collaborationLinks.set(link.linkId, {
                        ...link,
                        status: "blocked",
                        updatedAt: now
                    });
                    affectedResources.push(`link:${link.linkId}`);
                }
            }
        }
        if (status !== "failed") {
            resultSummary = openClawAgents.length > 0
                ? `Emergency stop applied. ${gatewayResult?.summary ?? "OpenClaw gateway stop command completed."}`
                : "Emergency stop applied as a local control lock. Adapter-level hard stop is not available for this agent type.";
        }
        await appendEmergencyAuditEntry({
            actorId: operator.actorId,
            action: "agent_network.emergency_stop",
            status: status === "failed" ? "failed" : "success",
            reason: text(input.reason) ?? "Agent emergency stop.",
            result: resultSummary,
            affectedServices: affectedResources
        });
        await notifyOpsEmail(operator.actorId, status === "failed" ? "[Theia] Agent emergency stop failed" : "[Theia] Agent emergency stop completed", [
            `Actor: ${operator.actorId}`,
            `Workspace: ${workspaceName} (${workspaceId})`,
            `Agents: ${agentIds.join(", ")}`,
            `Reason: ${text(input.reason) ?? "Agent emergency stop."}`,
            `Result: ${resultSummary}`,
            `Timestamp: ${now}`
        ], {
            includeAdminCopy: true
        });
    }
    else if (action === "steer") {
        if (agentIds.length === 0) {
            throw new Error("At least one registered agent is required for steering.");
        }
        const denied = agentIds.filter((agentId) => !canControlAgent(agentRegistry.get(agentId), "steer"));
        if (denied.length > 0) {
            throw new Error(`Agent control level does not allow steering: ${denied.join(", ")}`);
        }
        resultSummary = "Steering instruction recorded and visible. No shell command was executed.";
        for (const agentId of agentIds) {
            const profile = agentRegistry.get(agentId);
            if (profile) {
                agentRegistry.set(agentId, { ...profile, updatedAt: now, lastSteeringInstruction: text(input.instruction) });
                affectedResources.push(`agent:${agentId}`);
            }
        }
    }
    else if (action === "pause" || action === "disconnect") {
        for (const agentId of agentIds) {
            const profile = agentRegistry.get(agentId);
            if (!profile)
                continue;
            agentRegistry.set(agentId, {
                ...profile,
                status: action === "pause" ? "stopped" : "disconnected",
                updatedAt: now
            });
            if (action === "disconnect") {
                const secret = agentSecrets.get(agentId);
                if (secret) {
                    agentSecrets.set(agentId, { ...secret, revokedAt: now, revokedBy: operator.actorId });
                }
            }
            affectedResources.push(`agent:${agentId}`);
        }
        resultSummary = action === "pause" ? "Agent paused locally." : "Agent disconnected and telemetry token revoked.";
    }
    else if (action === "resume") {
        for (const agentId of agentIds) {
            const profile = agentRegistry.get(agentId);
            if (!profile)
                continue;
            if (profile.status === "emergency-stopped" && !confirmed) {
                throw new Error("Resuming an emergency-stopped agent requires confirmation.");
            }
            agentRegistry.set(agentId, {
                ...profile,
                status: "idle",
                updatedAt: now,
                emergencyStoppedAt: undefined,
                emergencyStoppedBy: undefined
            });
            affectedResources.push(`agent:${agentId}`);
        }
        resultSummary = "Agent local control lock cleared. Rotate telemetry token if it was revoked.";
    }
    else if (action === "break_link") {
        for (const linkId of linkIds) {
            const link = collaborationLinks.get(linkId);
            if (!link)
                continue;
            collaborationLinks.set(linkId, { ...link, status: "broken", updatedAt: now });
            affectedResources.push(`link:${linkId}`);
        }
        resultSummary = "Collaboration link broken.";
    }
    else if (action === "make_link") {
        const link = makeAgentCollaborationLink({
            ...input,
            sourceAgentId: input.sourceAgentId ?? agentIds[0],
            targetAgentId: input.targetAgentId ?? agentIds[1],
            taskScope: input.taskScope ?? input.instruction
        }, operator);
        linkIds.push(link.linkId);
        affectedResources.push(`link:${link.linkId}`);
        resultSummary = "Collaboration link created.";
    }
    else if (action === "focus_together") {
        if (agentIds.length < 2) {
            throw new Error("Focus Together requires at least two agents.");
        }
        const scope = text(input.taskScope) ?? text(input.instruction) ?? "Shared operator-prioritized task.";
        for (let i = 0; i < agentIds.length - 1; i += 1) {
            const link = makeAgentCollaborationLink({
                sourceAgentId: agentIds[i],
                targetAgentId: agentIds[i + 1],
                taskScope: scope,
                permissions: ["shared_task_context", "status_reports_only"],
                priority: "high"
            }, operator);
            linkIds.push(link.linkId);
            affectedResources.push(`link:${link.linkId}`);
        }
        resultSummary = "Selected agents are focused on the shared task with high-priority explicit links.";
    }
    const command = createAgentControlAuditCommand({
        action,
        status,
        actorId: operator.actorId,
        agentIds,
        linkIds,
        reason: text(input.reason),
        instruction: text(input.instruction),
        highRisk,
        requiresConfirmation: highRisk,
        resultSummary,
        affectedResources
    });
    agentControlCommands.unshift(command);
    trimAgentControlCommands();
    core.addOperationalAudit(`agent_network.control.${action}`, operator.actorId, command.commandId, {
        agentIds,
        linkIds,
        status,
        reason: command.reason,
        affectedResources
    });
    return {
        command,
        snapshot: buildAgentNetworkSnapshot(),
        operator
    };
}
function createAgentControlAuditCommand(input) {
    const now = new Date().toISOString();
    return agentControlCommandSchema.parse({
        commandId: text(input.commandId) ?? `cmd:${randomUUID()}`,
        action: input.action,
        status: input.status ?? "completed",
        actorId: input.actorId,
        agentIds: stringList(input.agentIds),
        linkIds: stringList(input.linkIds),
        reason: text(input.reason),
        instruction: text(input.instruction),
        highRisk: toBool(input.highRisk) ?? false,
        requiresConfirmation: toBool(input.requiresConfirmation) ?? false,
        createdAt: text(input.createdAt) ?? now,
        updatedAt: now,
        resultSummary: text(input.resultSummary),
        affectedResources: stringList(input.affectedResources),
        auditId: text(input.auditId)
    });
}
function trimAgentControlCommands() {
    if (agentControlCommands.length > 600) {
        agentControlCommands.length = 600;
    }
}
function canControlAgent(profile, action) {
    if (!profile)
        return false;
    if (profile.system && action === "emergency_stop")
        return false;
    const level = profile.controlLevel;
    if (level === "full")
        return true;
    if (action === "query")
        return ["query", "pause_resume", "steer", "stop"].includes(level);
    if (action === "steer")
        return level === "steer" || level === "stop";
    if (action === "emergency_stop")
        return profile.canEmergencyStop && level === "stop";
    if (action === "pause" || action === "resume")
        return ["pause_resume", "steer", "stop"].includes(level);
    return false;
}
async function discoverAgentCandidates(workspacePath) {
    const discoveryRoots = await resolveAgentDiscoveryRoots(workspacePath);
    const discovered = await discoverAcrossRoots(discoveryRoots);
    const hasKnownOpenClawInstall = discoveryRoots.some((root) => root === defaultOpenClawInstallPath);
    const autoRegisterable = [];
    const manual = [];
    const now = new Date().toISOString();
    if (discovered.openClawLogPaths.length > 0 || sources.openClawSources.length > 0 || hasKnownOpenClawInstall) {
        autoRegisterable.push({
            agentId: "agent:openclaw",
            name: "OpenClaw",
            role: "OpenClaw Agent Network",
            domain: "openclaw",
            model: "mixed",
            vendor: "OpenClaw",
            connectionKind: "openclaw",
            status: emergencyState.isStopped ? "emergency-stopped" : "idle",
            endpointLabel: runtime.endpoint ?? runtime.cliCommand,
            tools: ["sessions", "gateway", "hooks"],
            skills: ["agent orchestration", "terminal workflows"],
            connectors: ["openclaw-main", "openclaw-telemetry"],
            memorySummary: hasKnownOpenClawInstall
                ? `Linked to OpenClaw install at ${defaultOpenClawInstallPath}.`
                : "Discovered from OpenClaw session/log paths.",
            soulSummary: "Reports through OpenClaw logs, pairing hooks, or gateway telemetry.",
            controlLevel: "stop",
            canCollaborate: true,
            canEmergencyStop: true,
            trustLevel: "trusted",
            registeredAt: now,
            updatedAt: now
        });
    }
    if (discovered.memoryPath || discovered.bootstrapPath) {
        manual.push({
            kind: "local_config",
            title: "Workspace memory agent",
            suggestedName: "Workspace Memory Agent",
            connectionKind: "local",
            domain: "memory",
            confidence: 0.76,
            paths: [discovered.memoryPath, discovered.bootstrapPath].filter(Boolean),
            requiredQuestions: manualAgentQuestions()
        });
    }
    const configHints = (await Promise.all(discoveryRoots.map((root) => discoverAgentConfigHints(root)))).flat();
    manual.push(...configHints.map((hint) => ({
        ...hint,
        requiredQuestions: manualAgentQuestions()
    })));
    const processes = await discoverAgentProcesses();
    manual.push(...processes.map((processInfo) => ({
        kind: "running_process",
        title: `${processInfo.name} process`,
        suggestedName: processInfo.name,
        connectionKind: "terminal",
        domain: "operations",
        confidence: 0.52,
        process: processInfo,
        requiredQuestions: manualAgentQuestions()
    })));
    return {
        autoRegisterable,
        manual
    };
}
async function resolveAgentDiscoveryRoots(workspacePath) {
    const roots = uniq([workspacePath, ...openClawDiscoveryPaths].map((entry) => path.resolve(entry)));
    const existing = [];
    for (const root of roots) {
        if (!isApproved(root))
            continue;
        if (await isDir(root))
            existing.push(root);
    }
    return existing.length > 0 ? existing : [path.resolve(workspacePath)];
}
async function discoverAcrossRoots(roots) {
    const merged = {
        memoryPath: undefined,
        bootstrapPath: undefined,
        codexLogPaths: [],
        customJsonLogPaths: [],
        openClawLogPaths: []
    };
    for (const root of roots) {
        const discovered = await discover(root);
        merged.memoryPath ??= discovered.memoryPath;
        merged.bootstrapPath ??= discovered.bootstrapPath;
        merged.codexLogPaths.push(...discovered.codexLogPaths);
        merged.customJsonLogPaths.push(...discovered.customJsonLogPaths);
        merged.openClawLogPaths.push(...discovered.openClawLogPaths);
    }
    return {
        memoryPath: merged.memoryPath,
        bootstrapPath: merged.bootstrapPath,
        codexLogPaths: uniq(merged.codexLogPaths).slice(0, 24),
        customJsonLogPaths: uniq(merged.customJsonLogPaths).slice(0, 24),
        openClawLogPaths: uniq(merged.openClawLogPaths).slice(0, 24)
    };
}
function manualAgentQuestions() {
    return [
        "What is this agent called?",
        "What model/vendor does it use?",
        "Is it local, API-based, OAuth-based, terminal-driven, or OpenClaw-based?",
        "What tools, skills, or connectors can it access?",
        "What domain does it belong to?",
        "What level of control should the dashboard have?",
        "Can this agent collaborate with other agents?",
        "Can this agent be emergency-stopped?"
    ];
}
async function discoverAgentConfigHints(workspacePath) {
    const hints = [];
    const queue = [{ dir: workspacePath, depth: 0 }];
    const ignored = new Set([".git", "node_modules", "dist", "build", ".next", ".cache", ".idea", ".vscode", "coverage"]);
    let scanned = 0;
    while (queue.length > 0 && scanned < 1200 && hints.length < 30) {
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
                if (current.depth < 4 && !ignored.has(lower))
                    queue.push({ dir: absolute, depth: current.depth + 1 });
                continue;
            }
            if (!entry.isFile())
                continue;
            if (["soul.md", "memory.md", "agent.json", "agents.json", "theia-agent.json"].includes(lower) || lower.endsWith(".agent.json")) {
                hints.push({
                    kind: "agent_config",
                    title: entry.name,
                    suggestedName: heading(path.basename(entry.name, path.extname(entry.name))),
                    connectionKind: lower.includes("openclaw") ? "openclaw" : "local",
                    domain: lower.includes("memory") ? "memory" : "general",
                    confidence: lower === "soul.md" || lower === "theia-agent.json" ? 0.82 : 0.65,
                    paths: [absolute]
                });
            }
        }
    }
    return hints;
}
async function discoverAgentProcesses() {
    if (process.platform !== "win32") {
        return [];
    }
    try {
        const command = "Get-Process | Where-Object { $_.ProcessName -match 'openclaw|codex|node|python' } | Select-Object -First 24 ProcessName,Id,Path | ConvertTo-Json -Compress";
        const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
            timeout: 4000,
            windowsHide: true,
            maxBuffer: 1024 * 1024
        });
        const parsed = safeJsonParse(stdout);
        const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
        return rows.map((row) => ({
            name: text(row.ProcessName) ?? "process",
            pid: num(row.Id),
            path: text(row.Path)
        })).filter((row) => row.name);
    }
    catch {
        return [];
    }
}
function broadcastAgentSse(payload) {
    for (const subscriber of agentSseSubscribers) {
        try {
            subscriber(payload);
        }
        catch {
            // no-op
        }
    }
}
function cacheAgentEventKey(key) {
    agentEventDedupe.set(key, Date.now());
    if (agentEventDedupe.size <= 2000) {
        return;
    }
    const oldest = [...agentEventDedupe.entries()].sort((a, b) => a[1] - b[1]).slice(0, 500);
    for (const [staleKey] of oldest) {
        agentEventDedupe.delete(staleKey);
    }
}
function createAgentTelemetryToken() {
    return `theia_agent_${randomBytes(24).toString("base64url")}`;
}
function sha256(value) {
    return createHash("sha256").update(String(value)).digest("hex");
}
function slugifyAgentName(value) {
    return (value ?? "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agent";
}
function stringList(value) {
    if (Array.isArray(value)) {
        return uniq(value.map((item) => text(String(item))).filter(Boolean));
    }
    const single = text(value);
    if (!single) {
        return [];
    }
    return uniq(single.split(",").map((item) => item.trim()).filter(Boolean));
}
function normalizeAgentConnectionKind(value) {
    const normalized = text(value)?.toLowerCase().replace(/[-\s]+/g, "_");
    if (["local", "api", "oauth", "openclaw", "terminal", "custom"].includes(normalized)) {
        return normalized;
    }
    if (normalized === "oauth_based")
        return "oauth";
    if (normalized === "api_based")
        return "api";
    return "local";
}
function normalizeAgentStatus(value) {
    const normalized = text(value)?.toLowerCase();
    if (["active", "idle", "waiting", "blocked", "collaborating", "stopped", "emergency-stopped", "disconnected", "failed"].includes(normalized)) {
        return normalized;
    }
    return undefined;
}
function normalizeControlLevel(value) {
    const normalized = text(value)?.toLowerCase().replace(/[-\s]+/g, "_");
    if (["observe_only", "query", "pause_resume", "steer", "stop", "full"].includes(normalized)) {
        return normalized;
    }
    return undefined;
}
function normalizeTrustLevel(value) {
    const normalized = text(value)?.toLowerCase();
    if (["low", "standard", "trusted", "restricted"].includes(normalized)) {
        return normalized;
    }
    return undefined;
}
function normalizeAgentControlAction(value) {
    const normalized = text(value)?.toLowerCase().replace(/[-\s]+/g, "_");
    if (["query", "emergency_stop", "steer", "pause", "resume", "disconnect", "make_link", "break_link", "focus_together"].includes(normalized)) {
        return normalized;
    }
    return undefined;
}
function redactSensitive(value) {
    if (typeof value === "string") {
        return value
            .replace(/(sk-[a-zA-Z0-9_-]{8,})/g, "[redacted-key]")
            .replace(/(theia_agent_[a-zA-Z0-9_-]+)/g, "[redacted-agent-token]")
            .replace(/(Bearer\s+)[a-zA-Z0-9._~+/=-]{10,}/gi, "$1[redacted-token]")
            .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[redacted]");
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactSensitive(item));
    }
    if (value && typeof value === "object") {
        const next = {};
        for (const [key, item] of Object.entries(value)) {
            if (/token|secret|password|apiKey|authorization/i.test(key)) {
                next[key] = "[redacted]";
            }
            else {
                next[key] = redactSensitive(item);
            }
        }
        return next;
    }
    return value;
}
async function executeGatewayControl(action) {
    const args = action === "stop" ? ["gateway", "stop"] : ["gateway", "start"];
    const command = action === "stop" ? trustedGatewayStopCommand : trustedGatewayRestartCommand;
    const spawned = await runGatewayCommand(command, args);
    if (spawned.ok) {
        const output = [spawned.stdout, spawned.stderr].filter(Boolean).join("\n").trim();
        return {
            ok: true,
            alreadyInDesiredState: false,
            summary: output.length > 0 ? output.slice(0, 400) : `Gateway ${action} command completed.`
        };
    }
    const errorText = [spawned.error ?? "", spawned.stdout ?? "", spawned.stderr ?? ""].join("\n").toLowerCase();
    const alreadyStopped = action === "stop" && (errorText.includes("already stopped") || errorText.includes("not running") || errorText.includes("inactive"));
    const alreadyStarted = action === "start" && (errorText.includes("already running") || errorText.includes("already started"));
    if (alreadyStopped || alreadyStarted) {
        return {
            ok: false,
            alreadyInDesiredState: true,
            summary: action === "stop" ? "Gateway already stopped." : "Gateway already running.",
            error: spawned.error
        };
    }
    return {
        ok: false,
        alreadyInDesiredState: false,
        summary: `Gateway ${action} command failed.`,
        error: spawned.error ?? spawned.stderr ?? "Unknown gateway command error."
    };
}
async function runGatewayCommand(command, args) {
    const trusted = normalizeTrustedCommand(command);
    if (!trusted) {
        return {
            ok: false,
            error: "Gateway command is not trusted. Set THEIA_OPENCLAW_STOP_COMMAND / RESTART_COMMAND to a fixed executable name or absolute path."
        };
    }
    try {
        const { stdout, stderr } = await execFileAsync(trusted, args, {
            timeout: Math.max(3000, runtime.cliTimeoutMs),
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 6
        });
        return {
            ok: true,
            stdout,
            stderr
        };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : "Failed to execute gateway command.";
        return {
            ok: false,
            error: detail,
            stdout: typeof error?.stdout === "string" ? error.stdout : "",
            stderr: typeof error?.stderr === "string" ? error.stderr : ""
        };
    }
}
function normalizeTrustedCommand(command) {
    const trimmed = text(command);
    if (!trimmed) {
        return undefined;
    }
    if (/[|&;<>\n\r]/.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}
async function appendEmergencyAuditEntry(entry) {
    const now = new Date().toISOString();
    const record = {
        eventId: `emg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        timestamp: now,
        ...entry
    };
    const parent = path.dirname(emergencyAuditLogPath);
    await mkdir(parent, { recursive: true });
    let current = { events: [] };
    try {
        const raw = await readFile(emergencyAuditLogPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.events)) {
            current.events = parsed.events;
        }
    }
    catch {
    }
    current.events.push(record);
    current.events = current.events.slice(-2000);
    await writeFile(emergencyAuditLogPath, JSON.stringify(current, null, 2), "utf8");
    return record;
}
async function notifyOpsEmail(actorEmail, subject, lines, options = {}) {
    const recipients = new Set();
    const normalizedActor = text(actorEmail);
    if (normalizedActor && normalizedActor.includes("@")) {
        recipients.add(normalizedActor);
    }
    if (options.includeAdminCopy !== false && defaultOpsAdminEmail) {
        recipients.add(defaultOpsAdminEmail);
    }
    const message = lines.filter(Boolean).join("\n");
    const deliveries = [];
    for (const recipient of recipients) {
        const delivery = await opsEmail.send({
            to: recipient,
            subject,
            text: message
        });
        deliveries.push(delivery);
    }
    return deliveries;
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
                sources.openClawSources = await normalizeOpenClawSourcePaths(uniq(parsed.sources.openClawSources.map((item) => path.resolve(String(item)))));
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
                        ? await normalizeOpenClawSourcePaths(uniq(parsed.setup.discoveredSources.openClawLogPaths.map((item) => path.resolve(String(item)))))
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
            runtime.transport = normalizeRuntimeTransport(parsed.runtime.transport ?? runtime.transport);
            runtime.endpoint = text(parsed.runtime.endpoint) ?? runtime.endpoint;
            runtime.apiKey = text(parsed.runtime.apiKey) ?? runtime.apiKey;
            runtime.cursor = text(parsed.runtime.cursor) ?? runtime.cursor;
            runtime.cliCommand = text(parsed.runtime.cliCommand) ?? runtime.cliCommand;
            runtime.cliTimeoutMs = num(parsed.runtime.cliTimeoutMs) ?? runtime.cliTimeoutMs;
            runtime.lastSyncAt = text(parsed.runtime.lastSyncAt);
            runtime.lastError = text(parsed.runtime.lastError);
            runtime.lastEventCount = num(parsed.runtime.lastEventCount) ?? runtime.lastEventCount;
        }
        if (parsed.emergencyState && typeof parsed.emergencyState === "object") {
            emergencyState.status = text(parsed.emergencyState.status) ?? emergencyState.status;
            emergencyState.isStopped = toBool(parsed.emergencyState.isStopped) ?? emergencyState.isStopped;
            emergencyState.stopping = toBool(parsed.emergencyState.stopping) ?? false;
            emergencyState.restartAvailable = toBool(parsed.emergencyState.restartAvailable) ?? emergencyState.restartAvailable;
            emergencyState.triggeredBy = text(parsed.emergencyState.triggeredBy) ?? emergencyState.triggeredBy;
            emergencyState.reason = text(parsed.emergencyState.reason) ?? emergencyState.reason;
            emergencyState.lastRequestedAt = text(parsed.emergencyState.lastRequestedAt) ?? emergencyState.lastRequestedAt;
            emergencyState.lastUpdatedAt = text(parsed.emergencyState.lastUpdatedAt) ?? emergencyState.lastUpdatedAt;
            emergencyState.lastResult = text(parsed.emergencyState.lastResult) ?? emergencyState.lastResult;
            emergencyState.lastError = text(parsed.emergencyState.lastError) ?? emergencyState.lastError;
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
        if (parsed.highRiskNotifications && typeof parsed.highRiskNotifications === "object") {
            highRiskEngine.replaceState(parsed.highRiskNotifications);
        }
        if (parsed.openClawTelemetry && typeof parsed.openClawTelemetry === "object") {
            openClawTelemetry.restoreState(parsed.openClawTelemetry);
        }
        if (parsed.agentNetwork && typeof parsed.agentNetwork === "object") {
            if (Array.isArray(parsed.agentNetwork.agents)) {
                agentRegistry.clear();
                for (const rawProfile of parsed.agentNetwork.agents) {
                    const parsedProfile = agentProfileSchema.safeParse(rawProfile);
                    if (parsedProfile.success) {
                        agentRegistry.set(parsedProfile.data.agentId, {
                            ...rawProfile,
                            ...parsedProfile.data
                        });
                    }
                }
            }
            if (Array.isArray(parsed.agentNetwork.agentSecrets)) {
                agentSecrets.clear();
                for (const item of parsed.agentNetwork.agentSecrets) {
                    const agentId = text(item?.agentId);
                    const tokenHash = text(item?.tokenHash);
                    if (agentId && tokenHash) {
                        agentSecrets.set(agentId, {
                            tokenHash,
                            createdAt: text(item?.createdAt) ?? new Date().toISOString(),
                            createdBy: text(item?.createdBy) ?? "system:restore",
                            revokedAt: text(item?.revokedAt),
                            revokedBy: text(item?.revokedBy)
                        });
                    }
                }
            }
            if (Array.isArray(parsed.agentNetwork.events)) {
                agentActivityEvents.length = 0;
                for (const rawEvent of parsed.agentNetwork.events.slice(0, agentNetworkMaxEvents)) {
                    const parsedEvent = agentActivityEventSchema.safeParse(rawEvent);
                    if (parsedEvent.success) {
                        agentActivityEvents.push(parsedEvent.data);
                    }
                }
            }
            if (Array.isArray(parsed.agentNetwork.links)) {
                collaborationLinks.clear();
                for (const rawLink of parsed.agentNetwork.links) {
                    const parsedLink = collaborationLinkSchema.safeParse(rawLink);
                    if (parsedLink.success) {
                        collaborationLinks.set(parsedLink.data.linkId, parsedLink.data);
                    }
                }
            }
            if (Array.isArray(parsed.agentNetwork.commands)) {
                agentControlCommands.length = 0;
                for (const rawCommand of parsed.agentNetwork.commands.slice(0, 600)) {
                    const parsedCommand = agentControlCommandSchema.safeParse(rawCommand);
                    if (parsedCommand.success) {
                        agentControlCommands.push(parsedCommand.data);
                    }
                }
            }
        }
        setup.runtime = runtimeView();
    }
    catch {
    }
}
function statePayload(reason) {
    return {
        version: 7,
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
            transport: runtime.transport,
            endpoint: runtime.endpoint,
            apiKey: runtime.apiKey,
            cursor: runtime.cursor,
            cliCommand: runtime.cliCommand,
            cliTimeoutMs: runtime.cliTimeoutMs,
            lastSyncAt: runtime.lastSyncAt,
            lastError: runtime.lastError,
            lastEventCount: runtime.lastEventCount
        },
        emergencyState: {
            ...emergencyState
        },
        alertOverrides: Object.fromEntries(alertOverrides.entries()),
        highRiskNotifications: highRiskEngine.exportState(),
        openClawTelemetry: openClawTelemetry.exportState(),
        agentNetwork: {
            agents: serializeAgentRegistry(),
            agentSecrets: [...agentSecrets.entries()].map(([agentId, secret]) => ({
                agentId,
                ...secret
            })),
            events: agentActivityEvents.slice(0, agentNetworkMaxEvents),
            links: [...collaborationLinks.values()],
            commands: agentControlCommands.slice(0, 600)
        }
    };
}
async function persistState(reason) {
    const payload = statePayload(reason);
    const parent = path.dirname(stateFilePath);
    await mkdir(parent, { recursive: true });
    await writeFile(stateFilePath, JSON.stringify(payload, null, 2), "utf8");
}
function scheduleStatePersist(reason = "state.mutation") {
    if (scheduledPersistTimer) {
        return;
    }
    scheduledPersistTimer = setTimeout(async () => {
        scheduledPersistTimer = undefined;
        try {
            await persistState(reason);
        }
        catch {
        }
    }, 200);
}
function applyHighRiskEnvDefaults() {
    const settingsPatch = {};
    const minSeverity = text(process.env.THEIA_HIGHRISK_MIN_SEVERITY);
    if (minSeverity && ["medium", "high", "critical"].includes(minSeverity)) {
        settingsPatch.minimumSeverity = minSeverity;
    }
    const minConfidence = num(process.env.THEIA_HIGHRISK_MIN_CONFIDENCE);
    if (typeof minConfidence === "number") {
        settingsPatch.minimumConfidence = clamp(minConfidence);
    }
    const channelsPatch = {};
    const inApp = toBool(process.env.THEIA_HIGHRISK_CHANNEL_INAPP);
    const email = toBool(process.env.THEIA_HIGHRISK_CHANNEL_EMAIL);
    const webhook = toBool(process.env.THEIA_HIGHRISK_CHANNEL_WEBHOOK);
    if (typeof inApp === "boolean")
        channelsPatch.inAppBanner = inApp;
    if (typeof email === "boolean")
        channelsPatch.email = email;
    if (typeof webhook === "boolean")
        channelsPatch.webhook = webhook;
    if (Object.keys(channelsPatch).length > 0) {
        settingsPatch.channels = channelsPatch;
    }
    const emailPatch = {};
    const smtpHost = text(process.env.THEIA_HIGHRISK_EMAIL_SMTP_HOST);
    if (smtpHost)
        emailPatch.smtpHost = smtpHost;
    const smtpPort = num(process.env.THEIA_HIGHRISK_EMAIL_SMTP_PORT);
    if (typeof smtpPort === "number")
        emailPatch.smtpPort = smtpPort;
    const smtpUser = text(process.env.THEIA_HIGHRISK_EMAIL_SMTP_USERNAME);
    if (smtpUser)
        emailPatch.smtpUsername = smtpUser;
    if (typeof process.env.THEIA_HIGHRISK_EMAIL_SMTP_PASSWORD === "string") {
        emailPatch.smtpPassword = process.env.THEIA_HIGHRISK_EMAIL_SMTP_PASSWORD;
    }
    const fromAddress = text(process.env.THEIA_HIGHRISK_EMAIL_FROM);
    if (fromAddress)
        emailPatch.fromAddress = fromAddress;
    const subjectPrefix = text(process.env.THEIA_HIGHRISK_EMAIL_SUBJECT_PREFIX);
    if (subjectPrefix)
        emailPatch.subjectPrefix = subjectPrefix;
    if (Object.keys(emailPatch).length > 0) {
        settingsPatch.email = emailPatch;
    }
    const webhookPatch = {};
    const webhookUrl = text(process.env.THEIA_HIGHRISK_WEBHOOK_URL);
    if (webhookUrl)
        webhookPatch.url = webhookUrl;
    if (typeof process.env.THEIA_HIGHRISK_WEBHOOK_BEARER_TOKEN === "string") {
        webhookPatch.bearerToken = process.env.THEIA_HIGHRISK_WEBHOOK_BEARER_TOKEN;
    }
    if (Object.keys(webhookPatch).length > 0) {
        settingsPatch.webhook = webhookPatch;
    }
    const routingPatch = {};
    const defaultRecipients = parseList(process.env.THEIA_HIGHRISK_EMAIL_RECIPIENTS ?? "");
    const criticalRecipients = parseList(process.env.THEIA_HIGHRISK_CRITICAL_RECIPIENTS ?? "");
    if (defaultRecipients.length > 0)
        routingPatch.defaultRecipients = defaultRecipients;
    if (criticalRecipients.length > 0)
        routingPatch.criticalRecipients = criticalRecipients;
    if (Object.keys(routingPatch).length > 0) {
        settingsPatch.routing = routingPatch;
    }
    if (Object.keys(settingsPatch).length > 0) {
        highRiskEngine.updateSettings(settingsPatch);
    }
}
function parseList(value) {
    return uniq(value.split(",").map((x) => x.trim()).filter(Boolean));
}
function consumeAuthAttempt(key) {
    const now = Date.now();
    const existing = authAttemptCache.get(key) ?? [];
    const recent = existing.filter((value) => now - value <= authRateLimitWindowMs);
    if (recent.length >= authRateLimitMaxAttempts) {
        authAttemptCache.set(key, recent);
        return false;
    }
    recent.push(now);
    authAttemptCache.set(key, recent);
    if (authAttemptCache.size > 5000) {
        for (const [cacheKey, attempts] of authAttemptCache.entries()) {
            const filtered = attempts.filter((value) => now - value <= authRateLimitWindowMs);
            if (filtered.length === 0) {
                authAttemptCache.delete(cacheKey);
            }
            else {
                authAttemptCache.set(cacheKey, filtered);
            }
        }
    }
    return true;
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
function normalizeRuntimeTransport(value) {
    const normalized = text(value)?.toLowerCase();
    if (!normalized)
        return "gateway_cli";
    if (normalized === "gateway_cli" || normalized === "event_feed") {
        return normalized;
    }
    if (normalized === "cli") {
        return "gateway_cli";
    }
    return "gateway_cli";
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
async function normalizeOpenClawSourcePaths(paths) {
    const normalized = [];
    for (const sourcePath of paths) {
        const absolute = path.resolve(sourcePath);
        const extension = path.extname(absolute).toLowerCase();
        const inOpenClawSessions = absolute.toLowerCase().includes(`${path.sep}.openclaw${path.sep}agents${path.sep}`.toLowerCase()) &&
            absolute.toLowerCase().includes(`${path.sep}sessions${path.sep}`);
        if (extension === ".jsonl" && inOpenClawSessions) {
            normalized.push(path.dirname(absolute));
            continue;
        }
        if (await exists(absolute)) {
            normalized.push(absolute);
            continue;
        }
        const parentDir = path.dirname(absolute);
        const parentExists = await isDir(parentDir);
        if (parentExists && extension === ".jsonl") {
            normalized.push(parentDir);
            continue;
        }
        normalized.push(absolute);
    }
    return uniq(normalized);
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
                if (lower === "sessions" && absolute.toLowerCase().includes(`${path.sep}.openclaw${path.sep}agents${path.sep}`.toLowerCase())) {
                    openclawLogs.push(absolute);
                }
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
            else if (path.extname(lower) === ".jsonl" && absolute.toLowerCase().includes(`${path.sep}.openclaw${path.sep}agents${path.sep}`.toLowerCase()))
                openclawLogs.push(path.dirname(absolute));
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
function buildMetrics(agents, runs, alerts, tokenSeries, connectorHealth, plugins, memoryRows, notificationCenter) {
    const tokens = tokenSeries.reduce((sum, point) => sum + point.totalTokens, 0);
    const runningRuns = runs.filter((run) => run.status === "running").length;
    const activeAgents = agents.filter((agent) => agent.status === "running").length;
    const critical = alerts.filter((alert) => alert.severity === "high" || alert.severity === "critical").length;
    const highRiskOpen = (notificationCenter?.history ?? []).filter((row) => row.status === "open").length;
    const highRiskP95 = notificationCenter?.slo?.measuredP95Ms ?? 0;
    return [
        { label: "Setup Status", value: setup.connected ? "Connected" : "Not connected", trend: setup.health.status },
        { label: "Active Agents", value: `${activeAgents}`, trend: `${agents.length} observed` },
        { label: "Running Runs", value: `${runningRuns}`, trend: `${runs.length} total` },
        { label: "24h Token Burn", value: tokens.toLocaleString(), trend: tokens > 0 ? "live telemetry" : "no token telemetry" },
        { label: "Open Alerts", value: `${alerts.length}`, trend: critical > 0 ? "high severity present" : "no high severity" },
        { label: "High-Risk Notifications", value: `${highRiskOpen}`, trend: `p95 dispatch ${highRiskP95}ms` },
        { label: "Connector Health", value: `${Math.round(connectorHealth * 100)}%`, trend: `${plugins.filter((p) => p.enabled).length} enabled` },
        { label: "Memory Coverage", value: `${memoryRows.length}`, trend: memoryRows.length > 0 ? "mapped sections" : "no memory files" }
    ];
}
function buildOpenClawLive(events, runs, plugins) {
    const runtimeState = runtimeView();
    const telemetryHealth = openClawTelemetry.health();
    const telemetryHistory = openClawTelemetry.history(24);
    const latestTelemetry = telemetryHistory[0];
    const telemetryConnected = telemetryHealth.activePairings > 0 && Boolean(latestTelemetry);
    const connector = plugins.find((plugin) => plugin.pluginId === "openclaw-main");
    const openClawEvents = [...events]
        .filter((event) => {
        const connectorId = text(event.source?.connectorId)?.toLowerCase() ?? "";
        const objectPath = text(event.source?.objectPath)?.toLowerCase() ?? "";
        return connectorId.includes("openclaw") || objectPath.includes("openclaw");
    })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const latest = openClawEvents[0];
    const recentFailures = openClawEvents
        .slice(0, 24)
        .filter((event) => event.eventType === "run.failed")
        .filter((event) => {
        const message = text(event.payload?.message)?.toLowerCase() ?? "";
        return !message.includes("suppressed from run.failed noise");
    }).length;
    const activeRun = latest ? runs.find((run) => run.runId === latest.runId) : undefined;
    const dashboardUrl = text(process.env.THEIA_OPENCLAW_DASHBOARD_URL) ?? "http://127.0.0.1:18789/";
    const apiBaseUrl = text(process.env.THEIA_OPENCLAW_API_BASE_URL) ?? "http://localhost:18789/v1";
    let connectionStatus = "offline";
    let statusMessage = "OpenClaw connector is not enabled.";
    const sourceHealth = openClawDiagnosticsState.sourceHealth ?? {
        totalConfigured: sources.openClawSources.length,
        existing: [],
        missing: [],
        directories: []
    };
    if (emergencyState.isStopped) {
        connectionStatus = "offline";
        statusMessage = "OpenClaw automation is stopped by emergency control.";
    }
    else if (emergencyState.stopping) {
        connectionStatus = "degraded";
        statusMessage = "Emergency stop is in progress.";
    }
    else if (connector?.enabled) {
        const gatewayRpcOk = Boolean(openClawDiagnosticsState.gateway?.rpc?.ok ?? openClawDiagnosticsState.gateway?.health?.healthy);
        const hasReadableSource = sourceHealth.existing.length > 0 || sourceHealth.directories.length > 0;
        if (runtime.enabled && runtime.mode !== "log_only") {
            if (runtime.lastError) {
                connectionStatus = "degraded";
                statusMessage = runtime.lastError;
            }
            else if (gatewayRpcOk || runtime.lastSyncAt) {
                connectionStatus = "connected";
                statusMessage = runtime.transport === "gateway_cli"
                    ? "OpenClaw runtime is connected via CLI diagnostics and gateway probes."
                    : "OpenClaw runtime is connected via event-feed endpoint.";
            }
            else {
                connectionStatus = "degraded";
                statusMessage = "Runtime telemetry is enabled but has not synchronized yet.";
            }
        }
        else if (connector.status === "healthy" && hasReadableSource) {
            connectionStatus = "connected";
            statusMessage = openClawEvents.length > 0
                ? "Connected through approved OpenClaw log sources."
                : "Connected to log sources. Waiting for OpenClaw activity.";
        }
        else if (connector.status === "degraded") {
            connectionStatus = "degraded";
            statusMessage = runtimeState.lastError ?? connector.syncHealth ?? "OpenClaw connector has a degraded sync state.";
        }
        else {
            connectionStatus = "offline";
            statusMessage = connector.syncHealth ?? "OpenClaw connector is enabled but currently offline.";
        }
        if (sourceHealth.missing.length > 0 && connectionStatus === "connected") {
            connectionStatus = "degraded";
            statusMessage = `${sourceHealth.missing.length} OpenClaw source path(s) are currently missing. The connector suppresses noisy failures and continues with healthy sources.`;
        }
        if (recentFailures >= 4 && connectionStatus === "connected") {
            connectionStatus = "degraded";
            statusMessage = `Recent OpenClaw connector failures detected (${recentFailures} in recent activity).`;
        }
    }
    if (!emergencyState.isStopped && telemetryConnected && connectionStatus !== "connected") {
        connectionStatus = "connected";
        statusMessage = "OpenClaw is actively reporting telemetry into Theia via authenticated pairing.";
    }
    if (!emergencyState.isStopped && telemetryHealth.activePairings > 0 && !latestTelemetry && connectionStatus === "offline") {
        connectionStatus = "degraded";
        statusMessage = "OpenClaw pairings are active. Waiting for first telemetry push event.";
    }
    if (telemetryHealth.metrics.requestsRejected > 0 && connectionStatus === "connected") {
        connectionStatus = "degraded";
    }
    const recentActivity = openClawEvents.slice(0, 8).map((event) => ({
        ts: event.timestamp,
        eventType: event.eventType,
        summary: summarize(event),
        runId: event.runId,
        agentId: event.agentId
    }));
    const telemetryTransport = runtimeState.enabled && telemetryHealth.activePairings > 0 ? "hybrid" : telemetryHealth.activePairings > 0 ? "push" : "poll";
    return {
        connectionStatus,
        statusMessage,
        dashboardUrl,
        apiBaseUrl,
        gatewayCommand: "openclaw gateway --port 18789",
        dashboardCommand: "openclaw dashboard",
        statusCommand: "openclaw gateway status",
        restartCommand: "openclaw gateway start",
        currentAgentId: latest?.agentId,
        currentRunId: latest?.runId,
        currentTask: text(latest?.payload?.task) ?? text(latest?.payload?.summary) ?? text(latest?.payload?.action),
        currentObjective: activeRun?.objective,
        lastEventAt: latest?.timestamp ?? runtimeState.lastSyncAt,
        runtime: {
            enabled: runtimeState.enabled,
            mode: runtimeState.mode,
            transport: runtimeState.transport,
            endpoint: runtimeState.endpoint,
            cliCommand: runtimeState.cliCommand,
            cliTimeoutMs: runtimeState.cliTimeoutMs,
            lastSyncAt: runtimeState.lastSyncAt,
            lastError: runtimeState.lastError,
            lastEventCount: runtimeState.lastEventCount
        },
        sourceHealth,
        operations: {
            gateway: openClawDiagnosticsState.gateway,
            status: openClawDiagnosticsState.status,
            health: openClawDiagnosticsState.health,
            recentLogMeta: openClawDiagnosticsState.recentLogMeta,
            emergencyState: {
                ...emergencyState
            }
        },
        telemetry: {
            transport: telemetryTransport,
            ingestEndpoint: `${localCoreBaseUrl}/openclaw/telemetry/events`,
            streamEndpoint: `${localCoreBaseUrl}/openclaw/telemetry/stream`,
            activePairings: telemetryHealth.activePairings,
            totalPairings: telemetryHealth.totalPairings,
            eventsStored: telemetryHealth.eventCount,
            latestEventAt: telemetryHealth.latestEventAt,
            lastIngestAt: telemetryHealth.metrics.lastIngestAt,
            requestsAccepted: telemetryHealth.metrics.requestsAccepted,
            requestsRejected: telemetryHealth.metrics.requestsRejected,
            dedupedEvents: telemetryHealth.metrics.dedupedEvents
        },
        recentActivity,
        reconnectHints: [
            "Run `openclaw gateway --port 18789`, then confirm with `openclaw gateway status`.",
            "Open the Control UI with `openclaw dashboard` or http://127.0.0.1:18789/.",
            "If using gateway_cli mode, verify THEIA_OPENCLAW_CLI_COMMAND and local PATH access.",
            "If using event_feed mode, verify THEIA runtime endpoint points to an event stream, not /v1 inference APIs.",
            "For push telemetry, create a pairing in setup and configure OpenClaw hook/plugin token env variables."
        ]
    };
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

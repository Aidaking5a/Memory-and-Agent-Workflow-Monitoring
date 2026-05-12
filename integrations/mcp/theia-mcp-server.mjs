#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const agentId = process.env.THEIA_AGENT_ID || "agent:theia-mcp";
const agentToken = process.env.THEIA_AGENT_TOKEN || "";
const telemetryEndpoint = process.env.THEIA_AGENT_TELEMETRY_ENDPOINT || "http://localhost:4318/agent-network/telemetry/events";
const commandsEndpoint = process.env.THEIA_AGENT_COMMANDS_ENDPOINT || "http://localhost:4318/agent-network/commands";
const workspaceId = process.env.THEIA_WORKSPACE_ID || "ws_local_default";
const agentName = process.env.THEIA_AGENT_NAME || agentId;
const agentRole = process.env.THEIA_AGENT_ROLE || "MCP Reporter Agent";
const agentDomain = process.env.THEIA_AGENT_DOMAIN || "general";
const agentModel = process.env.THEIA_AGENT_MODEL || undefined;
const agentVendor = process.env.THEIA_AGENT_VENDOR || undefined;

const tools = [
  {
    name: "theia_report_activity",
    description: "Report a safe agent-activity/v1 event to Theia. Do not include hidden chain-of-thought.",
    inputSchema: {
      type: "object",
      properties: {
        currentTask: { type: "string" },
        category: { type: "string", default: "operations" },
        status: { type: "string", default: "active" },
        safeSummary: { type: "string" },
        decisionTrace: { type: "array", items: { type: "string" } },
        tool: { type: "string" },
        targetLabel: { type: "string" },
        riskLevel: { type: "string", default: "low" },
        usage: { type: "object" }
      },
      required: ["currentTask"]
    }
  },
  {
    name: "theia_heartbeat",
    description: "Send a low-risk heartbeat to Theia.",
    inputSchema: { type: "object", properties: { currentTask: { type: "string" } } }
  },
  {
    name: "theia_read_commands",
    description: "Read visible steering/control commands addressed to this agent.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "theia_ack_command",
    description: "Acknowledge a visible Theia command addressed to this agent.",
    inputSchema: {
      type: "object",
      properties: {
        commandId: { type: "string" },
        status: { type: "string", enum: ["accepted", "running", "completed", "failed", "rejected", "cancelled"] },
        resultSummary: { type: "string" }
      },
      required: ["commandId"]
    }
  },
  {
    name: "theia_query_status",
    description: "Check whether the Theia local telemetry endpoint is configured for this MCP adapter.",
    inputSchema: { type: "object", properties: {} }
  }
];

if (process.argv.includes("--self-test")) {
  console.log(JSON.stringify({ ok: true, agentId, telemetryEndpoint, commandsEndpoint, tools: tools.map((tool) => tool.name) }, null, 2));
  process.exit(0);
}

function content(payload) {
  return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}

function response(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function errorResponse(id, code, message) {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function writeMessage(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

async function handleMessage(message) {
  try {
    if (message.method === "initialize") {
      response(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "theia-command-center", version: "0.1.0" }
      });
      return;
    }
    if (message.method === "tools/list") {
      response(message.id, { tools });
      return;
    }
    if (message.method === "tools/call") {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      response(message.id, result);
      return;
    }
    if (message.id !== undefined) {
      response(message.id, {});
    }
  } catch (error) {
    errorResponse(message.id, -32000, error instanceof Error ? error.message : "Theia MCP tool failed.");
  }
}

async function callTool(name, args) {
  switch (name) {
    case "theia_report_activity":
      return content(await postActivity(args));
    case "theia_heartbeat":
      return content(await postActivity({
        currentTask: args.currentTask || "MCP heartbeat from private agent.",
        category: "idle",
        status: "idle",
        safeSummary: args.currentTask || "MCP heartbeat from private agent.",
        decisionTrace: ["Agent sent a heartbeat to Theia through MCP."],
        tool: "theia_heartbeat",
        riskLevel: "low"
      }));
    case "theia_read_commands":
      return content(await readCommands());
    case "theia_ack_command":
      return content(await ackCommand(args));
    case "theia_query_status":
      return content({ ok: true, agentId, telemetryEndpoint, commandsEndpoint, hasToken: Boolean(agentToken) });
    default:
      throw new Error(`Unknown Theia MCP tool: ${name}`);
  }
}

function buildEvent(args) {
  const currentTask = String(args.currentTask || "Agent activity reported to Theia.");
  return {
    schemaVersion: "agent-activity/v1",
    eventId: `evt:mcp:${randomUUID()}`,
    timestamp: new Date().toISOString(),
    workspaceId,
    agent: {
      agentId,
      name: agentName,
      role: agentRole,
      domain: agentDomain,
      model: agentModel,
      vendor: agentVendor,
      connectionKind: "mcp"
    },
    classification: {
      category: String(args.category || "operations"),
      status: String(args.status || "active"),
      riskLevel: String(args.riskLevel || "low"),
      confidence: 0.84
    },
    what: {
      currentTask,
      safeSummary: String(args.safeSummary || currentTask),
      decisionTrace: Array.isArray(args.decisionTrace)
        ? args.decisionTrace.map(String).slice(0, 8)
        : ["Agent reported a safe activity summary through MCP."]
    },
    where: {
      targets: [
        {
          kind: args.tool ? "tool" : "external_service",
          label: String(args.targetLabel || args.tool || "MCP client"),
          redacted: false
        }
      ]
    },
    how: {
      toolCalls: [
        {
          name: String(args.tool || "theia_mcp_reporter"),
          kind: "connector",
          status: "completed",
          safeSummary: "Reported safe activity telemetry through Theia MCP adapter."
        }
      ],
      userVisibleExplanation: String(args.safeSummary || currentTask)
    },
    usage: args.usage && typeof args.usage === "object" ? args.usage : {},
    privacy: {
      redactionApplied: true,
      sensitiveKinds: []
    }
  };
}

async function postActivity(args) {
  const response = await fetch(telemetryEndpoint, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify(buildEvent(args))
  });
  return await readResponse(response);
}

async function readCommands() {
  const url = new URL(commandsEndpoint);
  url.searchParams.set("agentId", agentId);
  const response = await fetch(url, { headers: authHeaders({ Accept: "application/json" }) });
  return await readResponse(response);
}

async function ackCommand(args) {
  const commandId = String(args.commandId || "");
  if (!commandId) throw new Error("commandId is required.");
  const base = commandsEndpoint.replace(/\/$/, "");
  const response = await fetch(`${base}/${encodeURIComponent(commandId)}/ack`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({
      agentId,
      status: args.status || "accepted",
      resultSummary: args.resultSummary
    })
  });
  return await readResponse(response);
}

function authHeaders(headers) {
  const next = { ...headers, "x-theia-agent-id": agentId };
  if (agentToken) next.Authorization = `Bearer ${agentToken}`;
  return next;
}

async function readResponse(response) {
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep text body
  }
  if (!response.ok) {
    throw new Error(typeof body === "string" ? body : body.message || `Theia request failed (${response.status}).`);
  }
  return body;
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer().catch((error) => errorResponse(undefined, -32000, error.message));
});

async function drainBuffer() {
  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd >= 0) {
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) throw new Error("MCP message missing Content-Length.");
      const length = Number(match[1]);
      const messageStart = headerEnd + 4;
      if (buffer.length < messageStart + length) return;
      const body = buffer.slice(messageStart, messageStart + length).toString("utf8");
      buffer = buffer.slice(messageStart + length);
      await handleMessage(JSON.parse(body));
      continue;
    }
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline).toString("utf8").trim();
    buffer = buffer.slice(newline + 1);
    if (line) await handleMessage(JSON.parse(line));
  }
}

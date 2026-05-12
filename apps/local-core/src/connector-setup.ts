export type ConnectorLane = "pull" | "push" | "mcp";
export type ConnectorMode = "local" | "cloud";
export type ConnectorAuthKind = "none" | "api_key" | "pairing_token" | "oauth" | "local_session";
export type ConnectorKind = "local" | "api" | "oauth" | "openclaw" | "octopoda" | "mcp" | "terminal" | "custom";
export type ConnectorStatus = "healthy" | "degraded" | "offline";

export interface ConnectorCommandSet {
  install?: string[];
  start?: string[];
  validate?: string[];
  powershell?: string[];
  bash?: string[];
  mcpConfig?: Record<string, unknown>;
}

export interface ConnectorRegistrationRecord {
  connectorId: string;
  kind: ConnectorKind;
  displayName: string;
  lane: ConnectorLane;
  mode: ConnectorMode;
  endpoint?: string;
  endpointLabel?: string;
  authKind: ConnectorAuthKind;
  hasSecret: boolean;
  capabilities: string[];
  status: ConnectorStatus;
  message?: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
  commands?: ConnectorCommandSet;
}

export interface ConnectorDiscoveryCandidate {
  connectorId: string;
  kind: ConnectorKind;
  displayName: string;
  lane: ConnectorLane;
  mode: ConnectorMode;
  endpoint?: string;
  endpointLabel?: string;
  authKind: ConnectorAuthKind;
  status: ConnectorStatus;
  confidence: number;
  message: string;
  commands?: ConnectorCommandSet;
}

export const DEFAULT_OCTOPODA_LOCAL_URL = "http://localhost:7842";
export const DEFAULT_OCTOPODA_CLOUD_URL = "https://api.octopodas.com";

export function redactConnectorRegistration(record: ConnectorRegistrationRecord): Omit<ConnectorRegistrationRecord, "endpoint"> {
  const { endpoint: _endpoint, ...safe } = record;
  return {
    ...safe,
    hasSecret: Boolean(record.hasSecret)
  };
}

export function connectorCapabilities(kind: ConnectorKind): string[] {
  if (kind === "octopoda") {
    return ["read_agent_registry", "read_agent_metrics", "read_memory_health", "read_agent_messages", "read_loop_status", "read_run_events"];
  }
  if (kind === "mcp") {
    return ["write_agent_report", "read_control_commands"];
  }
  if (kind === "openclaw") {
    return ["read_run_events", "read_tool_traces", "read_task_plans", "write_agent_report"];
  }
  return ["write_agent_report"];
}

export function buildConnectorCommands(input: {
  repoRoot: string;
  localCoreBaseUrl: string;
  openClawPath: string;
  agentId?: string;
  token?: string;
}): Record<string, ConnectorCommandSet> {
  const agentId = input.agentId ?? "agent:theia-mcp";
  const endpoint = `${input.localCoreBaseUrl}/agent-network/telemetry/events`;
  const commandsEndpoint = `${input.localCoreBaseUrl}/agent-network/commands`;
  return {
    octopoda: {
      install: ['py -m pip install "octopoda[server,mcp]"'],
      start: ["octopoda"],
      validate: [`Invoke-RestMethod -Uri "${DEFAULT_OCTOPODA_LOCAL_URL}/api/system/status"`]
    },
    openclaw: {
      powershell: [
        `python "${input.repoRoot}\\integrations\\openclaw\\theia-command-center-skill\\install.py" --endpoint "${endpoint}" --agent-id "agent:openclaw"`
      ],
      bash: [
        `python "${input.repoRoot}/integrations/openclaw/theia-command-center-skill/install.py" --endpoint "${endpoint}" --agent-id "agent:openclaw"`
      ]
    },
    mcp: {
      mcpConfig: {
        mcpServers: {
          theia: {
            command: "node",
            args: [`${input.repoRoot}\\integrations\\mcp\\theia-mcp-server.mjs`],
            env: {
              THEIA_AGENT_ID: agentId,
              THEIA_AGENT_TOKEN: input.token ?? "THEIA_AGENT_TOKEN_FROM_DASHBOARD",
              THEIA_AGENT_TELEMETRY_ENDPOINT: endpoint,
              THEIA_AGENT_COMMANDS_ENDPOINT: commandsEndpoint
            }
          }
        }
      },
      validate: [`node "${input.repoRoot}\\integrations\\mcp\\theia-mcp-server.mjs" --self-test`]
    }
  };
}

export function buildConnectorDiscoveryCandidates(input: {
  repoRoot: string;
  localCoreBaseUrl: string;
  openClawPath: string;
  openClawExists: boolean;
  octopodaLocalReachable: boolean;
  hasOctopodaCloudKey: boolean;
}): ConnectorDiscoveryCandidate[] {
  const commands = buildConnectorCommands(input);
  return [
    {
      connectorId: "octopoda-local",
      kind: "octopoda",
      displayName: "Octopoda Local Runtime",
      lane: "pull",
      mode: "local",
      endpoint: DEFAULT_OCTOPODA_LOCAL_URL,
      endpointLabel: DEFAULT_OCTOPODA_LOCAL_URL,
      authKind: "none",
      status: input.octopodaLocalReachable ? "healthy" : "offline",
      confidence: input.octopodaLocalReachable ? 0.94 : 0.58,
      message: input.octopodaLocalReachable
        ? "Octopoda local dashboard/API is reachable."
        : "Octopoda local server was not reachable. Install and start it, then validate.",
      commands: commands.octopoda
    },
    {
      connectorId: "octopoda-cloud",
      kind: "octopoda",
      displayName: "Octopoda Cloud API",
      lane: "pull",
      mode: "cloud",
      endpoint: DEFAULT_OCTOPODA_CLOUD_URL,
      endpointLabel: DEFAULT_OCTOPODA_CLOUD_URL,
      authKind: "api_key",
      status: input.hasOctopodaCloudKey ? "degraded" : "offline",
      confidence: input.hasOctopodaCloudKey ? 0.72 : 0.42,
      message: input.hasOctopodaCloudKey
        ? "Cloud key is configured. Validate to confirm API access."
        : "Set THEIA_OCTOPODA_API_KEY to enable explicit cloud mode.",
      commands: {
        validate: ["$env:THEIA_OCTOPODA_API_KEY='<your-key>'; pnpm.cmd run dev:dashboard"]
      }
    },
    {
      connectorId: "openclaw-skill",
      kind: "openclaw",
      displayName: "OpenClaw Skill Reporter",
      lane: "push",
      mode: "local",
      endpointLabel: input.openClawPath,
      authKind: "pairing_token",
      status: input.openClawExists ? "degraded" : "offline",
      confidence: input.openClawExists ? 0.82 : 0.36,
      message: input.openClawExists
        ? "OpenClaw install was found. Install the Theia skill and create an agent token."
        : "OpenClaw install was not found at the configured path.",
      commands: commands.openclaw
    },
    {
      connectorId: "theia-mcp",
      kind: "mcp",
      displayName: "Theia MCP Reporter",
      lane: "mcp",
      mode: "local",
      endpointLabel: `${input.localCoreBaseUrl}/agent-network/telemetry/events`,
      authKind: "pairing_token",
      status: "degraded",
      confidence: 0.68,
      message: "Register an MCP agent in the card deck, then paste the generated token into this config.",
      commands: commands.mcp
    }
  ];
}

export function validateConnectorEndpoint(input: {
  endpoint: string;
  mode: ConnectorMode;
  allowedEndpoints?: string[];
}): { ok: true; endpoint: string; endpointLabel: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(input.endpoint);
  } catch {
    return { ok: false, message: "Connector endpoint must be a valid URL." };
  }
  const origin = url.origin.toLowerCase();
  const allowed = new Set((input.allowedEndpoints ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (input.mode === "local") {
    if (!isLoopback && !allowed.has(origin)) {
      return { ok: false, message: "Local connectors must use localhost/127.0.0.1 unless explicitly allowlisted." };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "Local connector endpoint must use http or https." };
    }
  } else {
    if (url.protocol !== "https:") {
      return { ok: false, message: "Cloud connector endpoints must use https." };
    }
    if (url.hostname !== "api.octopodas.com" && !allowed.has(origin)) {
      return { ok: false, message: "Cloud connector endpoint is not allowlisted." };
    }
  }
  return {
    ok: true,
    endpoint: url.href.replace(/\/$/, ""),
    endpointLabel: url.origin
  };
}

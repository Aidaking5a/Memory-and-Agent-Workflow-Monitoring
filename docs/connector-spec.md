# Connector Specification

## Purpose

Connectors provide explicit, permission-scoped ingestion from user-authorized agent environments and state files.

Current prioritized connectors:
- Codex CLI log connector
- Custom JSON log connector
- OpenClaw trace connector
- Local file connector (`memory.md`, `bootstrap.md`)
- Octopoda local/cloud connector
- MCP and reporter SDK adapters

Theia connector strategy has three lanes:

- Pull connectors: local services, local logs, local files, and Octopoda registry/API reads.
- Push reporters: private agents POST strict `agent-activity/v1` telemetry with per-agent tokens.
- MCP adapters: compatible clients report activity and read visible steering commands without shell access.

## Required Interface

- `manifest`: connector identity, capabilities, version
- `init(options)`: initializes with scope and context
- `poll()`: emits normalized `WorkflowEvent` records
- `health()`: returns status and telemetry
- `shutdown()`: clean teardown

## Capability Set

- `read_run_events`
- `read_memory_files`
- `read_tool_traces`
- `read_task_plans`
- `read_prompts`
- `read_agent_registry`
- `read_agent_metrics`
- `read_memory_health`
- `read_agent_messages`
- `read_loop_status`
- `write_agent_report`
- `read_control_commands`

## Connector Registration Routes

- `POST /setup/connectors/discover`
- `POST /setup/connectors/connect`
- `GET /setup/connectors/status`
- `POST /agent-network/connectors/:connectorId/validate`

Existing private-agent routes remain:

- `POST /agent-network/agents`
- `POST /agent-network/telemetry/events`
- `GET /agent-network/commands`
- `POST /agent-network/commands/:commandId/ack`
- `GET /agent-network/stream`
- `POST /agent-network/control`

Connector registrations are stored in `.theia/local-core-state.json`. API keys are read from environment/session only and are never returned raw to the dashboard.

## Security Constraints

- No access outside approved paths
- No credential scraping
- No privilege escalation
- All operations must be auditable
- No arbitrary shell commands exposed through MCP or dashboard controls
- Local connectors must use loopback or an explicit allowlist
- Cloud connectors must use HTTPS and explicit credentials
- Hidden chain-of-thought must not be reported; use safe summaries, decision traces, and tool logs instead

## Health Contract

- `status`: healthy/degraded/offline
- `lastSuccessfulPollAt`
- `latencyMs`
- `errorCode` and message when degraded/offline

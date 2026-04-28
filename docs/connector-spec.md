# Connector Specification

## Purpose

Connectors provide explicit, permission-scoped ingestion from user-authorized agent environments and state files.

Current prioritized connectors:
- Codex CLI log connector
- Custom JSON log connector
- OpenClaw trace connector
- Local file connector (`memory.md`, `bootstrap.md`)

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

## Security Constraints

- No access outside approved paths
- No credential scraping
- No privilege escalation
- All operations must be auditable

## Health Contract

- `status`: healthy/degraded/offline
- `lastSuccessfulPollAt`
- `latencyMs`
- `errorCode` and message when degraded/offline

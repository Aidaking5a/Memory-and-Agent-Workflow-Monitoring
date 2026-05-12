# Theia Command Center

Report OpenClaw agent activity to Theia using the strict `agent-activity/v1` schema.

## Rules

- Send safe summaries, decision traces, tool-call logs, file/site/API references, and resource usage only.
- Do not send hidden chain-of-thought.
- Never run shell commands from Theia. The skill only reports activity and reads visible steering commands.
- Respect emergency stop and steering commands returned by Theia.
- Keep reports concise: maximum 8 decision trace entries and no raw secret values.

## Commands

Heartbeat:

```powershell
python .\skills\theia-command-center\scripts\report.py heartbeat
```

Activity:

```powershell
python .\skills\theia-command-center\scripts\report.py activity --task "Summarizing local OpenClaw run" --category operations --status active
```

Read visible commands:

```powershell
python .\skills\theia-command-center\scripts\report.py commands
```

The skill reads `.theia-command-center.json` plus `THEIA_AGENT_TOKEN`, `THEIA_AGENT_ID`, `THEIA_AGENT_TELEMETRY_ENDPOINT`, and `THEIA_AGENT_COMMANDS_ENDPOINT` overrides.

# Homepage

## Hero

Headline:
Operate AI agents with evidence, oversight, and control.

Subheadline:
Theia is a local-first command center for installing, connecting, monitoring, and controlling private AI agent networks.

Primary CTA:
Download Desktop App

Secondary CTA:
Book a Demo

Launch Status:
Free access during early public rollout

## Value Pillars

1. Transparent Workflow Visibility
Track task progression, tool usage, memory changes, and run outcomes in one accountable surface.

2. Explainable Reasoning Alerts
Surface unsupported assumptions, stale context, contradictions, and evidence gaps with confidence and evidence links.

3. Trust-First Architecture
Local-first processing, explicit consent, least privilege, and audit-ready governance controls.

## Install Commands

Dashboard one-liner:

```powershell
cmd /d /c scripts\start-theia-dashboard.cmd -OpenClawPath "%USERPROFILE%\src\openclaw"
```

Apple/macOS dashboard one-liner:

```bash
bash ./scripts/start-theia-dashboard.sh --openclaw-path "$HOME/src/openclaw"
```

Marketing site one-liner:

```powershell
pnpm.cmd run dev:marketing
```

Apple/macOS marketing site one-liner:

```bash
bash ./scripts/start-theia-marketing-site.sh --port 4173
```

Octopoda local connector:

```powershell
py -m pip install "octopoda[server,mcp]"
octopoda
```

## Proof Section

- Cross-platform desktop support (macOS and Windows)
- Revocable connector permissions
- Event-level traceability for governance and audits

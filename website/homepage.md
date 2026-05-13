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

## Quick Start

Homepage quick-start command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='https://raw.githubusercontent.com/aidaking5a/Memory-and-Agent-Workflow-Monitoring/main/scripts/install-theia-command-center.ps1'; $p=Join-Path $env:TEMP 'install-theia-command-center.ps1'; Invoke-WebRequest $u -OutFile $p; Get-Content $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p -BuildDashboard -StartAfterInstall"
```

Install configurator page:

```text
website/site/install.html
```

Apple/macOS clean install:

```bash
u="https://raw.githubusercontent.com/aidaking5a/Memory-and-Agent-Workflow-Monitoring/main/scripts/install-theia-command-center.sh"; p="/tmp/install-theia-command-center.sh"; curl -fsSL "$u" -o "$p"; sed -n '1,180p' "$p"; bash "$p" --build-dashboard --start-after-install
```

The detailed dashboard, clone, marketing site, Octopoda, and MCP commands live on the install configurator page to keep the homepage clean.

Marketing site preview from a clone:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-theia-marketing-site.ps1 -Port 4173
```

## Proof Section

- Cross-platform desktop support (macOS and Windows)
- Revocable connector permissions
- Event-level traceability for governance and audits

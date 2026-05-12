# Theia

Theia is a premium, consent-based memory and agent workflow orchestration platform focused on transparent operations, explainable oversight, and trust-by-default controls.

## What This Repository Includes

- Cross-platform desktop dashboard foundation (`apps/desktop`)
- Local core ingestion and timeline service (`apps/local-core`)
- Optional control plane with SAML-ready auth and login-volume dashboard (`apps/control-plane`)
- Canonical schema package for workflow and memory entities (`packages/event-schema`)
- Canonical private-agent reporting protocol (`packages/agent-protocol`)
- Connector SDK for authorized data sources (`packages/connector-sdk`)
- Reasoning quality detection engine (`packages/reasoning-engine`)
- Policy and permission engine with audit chaining (`packages/policy-engine`)
- Product, architecture, trust, and GTM documentation (`docs`)
- Website content pack for premium brand positioning (`website`)

## Principles

- User-authorized access only
- Least-privilege permissions
- Local-first processing and privacy-by-design
- Explainable, assistive alerts (no opaque correctness claims)
- Auditability and accountability by default

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

If PowerShell execution policy blocks `pnpm`, use `pnpm.cmd` instead (for example `pnpm.cmd install`).

2. Build all packages/apps:

```bash
pnpm build
```

3. Run local core service:

```bash
pnpm --filter @theia/local-core dev
```

4. Run optional control plane:

```bash
pnpm --filter @theia/control-plane dev
```

5. Run desktop app:

```bash
pnpm --filter @theia/desktop dev
```

Desktop URL: `http://localhost:5173` (fixed dev port).

Important: local-core now requires sign-in for sensitive routes. On first run, create your local account in the desktop sign-in screen.

Open the `Live Reporting Dashboard` after sign-in to use the private Agent Command Center: register agents, issue per-agent telemetry tokens, inspect the live network, query or steer agents, create collaboration links, and trigger emergency stop.

6. (Optional) Run marketing website locally:

```bash
pnpm run dev:website
```

Website URL: `http://localhost:4173`.

Windows one-liner that starts the marketing site, writes logs, checks readiness, and opens the browser:

```powershell
pnpm.cmd run dev:marketing
```

## Desktop Installer Packaging (.exe/.dmg)

The desktop app is now scaffolded for native installers with Tauri.

Prerequisites:

- Node 22 + pnpm
- Rust toolchain (`rustup`) for local builds
- Visual Studio Build Tools 2022 with C++ workload (Windows only)

Run native desktop shell (Theia desktop in a Tauri window):

```bash
pnpm run dev:desktop:tauri
```

Build installers locally:

```bash
# Windows (NSIS .exe) on Windows
pnpm run build:desktop:installer:win

# macOS (.dmg) on macOS
pnpm run build:desktop:installer:mac
```

Windows note: if MSVC Build Tools are missing, `build:desktop:installer:win` now attempts to install them automatically and prompts for Administrator approval (UAC).

If you want an explicit setup command first, use:

```powershell
pnpm run build:desktop:installer:win:auto-setup
```

Manual fallback installer download:

- `https://aka.ms/vs/17/release/vs_BuildTools.exe`

Or double-click:

- `scripts/build-desktop-installer-win.cmd`

Output locations:

- Windows: `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`
- macOS: `apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`

CI packaging workflow:

- `.github/workflows/desktop-installers.yml`
- Trigger manually in GitHub Actions (`Run workflow`) or by pushing a `v*` tag.
- Artifacts are uploaded as:
  - `theia-windows-installer`
  - `theia-macos-installer`

Note: installers are unsigned by default in this repo. For public distribution trust, add code-signing certificates and (for macOS) notarization.

Workflow governance APIs (local core):

- `POST /runs/:runId/workflows/derive`
- `GET /workflows`
- `GET /workflows/queue/pending`
- `POST /workflows/:workflowId/review`
- `POST /workflows/:workflowId/rollback`
- `POST /workflows/retire-stale`
- `GET /workflows/release-gates/report`
- `GET /workflows/policy`

## One-Command Local Startup (Windows)

Run once (persistent env + strong session secret for your Windows user):

```powershell
pnpm run setup:local
```

Daily startup (Keycloak + local core + control plane + desktop):

```powershell
pnpm run dev:stack
```

This now also starts the local website server on `http://localhost:4173`.

Dashboard-only one-liner (local core + desktop dashboard, no Docker/Keycloak/control plane):

```powershell
pnpm.cmd run dev:dashboard
```

Marketing-site one-liner (static site only):

```powershell
pnpm.cmd run dev:marketing
```

If another process is blocking `localhost:5173`, reclaim it automatically for Theia desktop:

```powershell
pnpm run dev:stack:force-port
```

You can also double-click:

- `scripts/start-theia-dev.cmd`

The `.cmd` wrappers run PowerShell with a per-process bypass, so you do not need to change global execution policy settings.

Stop all local services:

```powershell
pnpm run dev:stop
```

Smoke-test the running local infrastructure:

```powershell
pnpm.cmd run test:local-infra
```

Dashboard-only smoke test:

```powershell
pnpm.cmd run test:dashboard
```

Marketing-only smoke test:

```powershell
pnpm.cmd run test:marketing
```

Manual setup and test details live in:

- `docs/local-infrastructure-runbook.md`

## Agent Command Center

Theia now includes a local-first private agent network dashboard.

Core endpoints:

- `GET /agent-network/snapshot`
- `GET /agent-network/agents`
- `POST /agent-network/agents`
- `POST /agent-network/discover`
- `POST /agent-network/telemetry/events`
- `GET /agent-network/stream`
- `POST /agent-network/control`
- `POST /agent-network/links`
- `POST /agent-network/links/:linkId/break`

Private agents report with the `agent-activity/v1` schema from `packages/agent-protocol`. Reports include what the agent is doing, where it is working, how it is working, resource usage, status, risk, safe reasoning summaries, decision traces, and tool-call logs. Hidden chain-of-thought should never be reported.

The desktop app now exposes only three customer-facing command-center views:

- `Live Reporting Dashboard`: live bubble network, collaboration links, deep-dive panels, setup helpers, and Query/Steering/Emergency Stop/Break Link/Make Link/Focus Together controls.
- `Agent Stats`: system memory, runtime, token usage, estimated spend, and per-agent breakdowns.
- `Agent Card Deck`: FIFA-style practical cards for each agent's identity, model/vendor, memory/soul summary, skills/connectors, usage, and trust/control level.

Architecture and protocol details:

- `docs/agent-command-center-architecture.md`
- `packages/agent-protocol/templates/orchestrator/soul.md`
- `packages/agent-protocol/templates/orchestrator/memory.md`

## Distribution Strategy

Recommended customer paths:

1. Windows installer for non-technical users: build with `pnpm run build:desktop:installer:win`.
2. Clone-based developer setup: clone the repo, run `pnpm.cmd install`, then `pnpm run dev:stack`.
3. One-line bootstrap: a transparent Windows PowerShell script that clones the repo, checks prerequisites, prints every planned step, and offers a reversible cleanup path.

One-line bootstrap from a trusted checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-theia-command-center.ps1
```

Run the local dashboard stack with the OpenClaw install rooted at `C:\Users\admin_1\src\openclaw`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-theia-dashboard.ps1 -OpenClawPath "C:\Users\admin_1\src\openclaw"
```

One-line bootstrap from GitHub after reviewing the script URL and repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='https://raw.githubusercontent.com/aidaking5a/Memory-and-Agent-Workflow-Monitoring/main/scripts/install-theia-command-center.ps1'; $p=Join-Path $env:TEMP 'install-theia-command-center.ps1'; Invoke-WebRequest $u -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p"
```

The installer/bootstrap path should not silently install Node, Rust, Visual Studio Build Tools, Docker, WSL, or paid API connectors. Prompt before privileged installs and keep clone-based setup available for OpenClaw-style developers.

## Lead Intake And Tracking

The website demo form posts to:

- `POST /api/public/leads` on the control plane

Public lead submission now requires public auth first:

- `POST /api/public/auth/signup`
- `POST /api/public/auth/signin`
- `GET /api/public/auth/me`
- `POST /api/public/auth/logout`

Authenticated operators can review and manage leads in:

- `http://localhost:4620/dashboard`

Lead records are stored locally at:

- `apps/control-plane/data/lead-submissions.json`
- `apps/control-plane/data/lead-deliveries.json` (delivery audit: sent / queued_local / failed)

Lead-related environment variables:

- `THEIA_LEADS_ALLOW_ORIGINS` (comma-separated allowed origins for public lead POSTs)
- `THEIA_LEADS_IP_HASH_SALT` (optional salt for privacy-preserving IP hashing)
- `THEIA_LEADS_DEDUPE_WINDOW_SECONDS` (idempotent payload dedupe window)
- `THEIA_LEADS_RATE_LIMIT_WINDOW_SECONDS` and `THEIA_LEADS_RATE_LIMIT_MAX_SUBMISSIONS`
- `THEIA_ENABLE_DEV_LOGIN` (set `false` for public deployments)
- `THEIA_LEADS_NOTIFY_TO` (default `windsurf345@outlook.com`)
- `THEIA_LEADS_NOTIFY_SMTP_HOST` + SMTP credentials (for direct email delivery)
- `THEIA_PUBLIC_AUTH_TTL_HOURS` / `THEIA_PUBLIC_AUTH_RATE_LIMIT_*` (public auth session + anti-abuse)

If SMTP is not configured, leads are still accepted and stored, and delivery status is marked `queued_local` so no submission is silently dropped.

## Emergency Stop (OpenClaw)

Sensitive control endpoints require local-core auth (bearer token from `/auth/signin`).

Emergency endpoints:

- `POST /openclaw/emergency-stop` (owner/operator capability required)
- `POST /openclaw/restart-gateway`
- `GET /openclaw/emergency-audit`

Behavior:

- Emergency stop attempts to run a fixed trusted gateway stop command (`openclaw gateway stop`).
- Runtime polling and OpenClaw connector automation are halted immediately in Theia state.
- Theia writes audit records to policy audit + `.theia/emergency-audit-log.json`.
- Operator/admin status emails are sent via `SMTP_*` or queued locally if SMTP is not configured.

Local-core auth endpoints:

- `POST /auth/signup`
- `POST /auth/signin`
- `GET /auth/me`
- `POST /auth/logout`

## Public HTTPS Control Plane (Render)

This repo includes [`render.yaml`](./render.yaml) for deploying the control plane with HTTPS and a strict lead origin allowlist.

Render notes:

- Build uses `pnpm install --no-frozen-lockfile` (the lockfile is not required for deploys in this repo).
- Ensure `THEIA_SESSION_SECRET` is present and at least 32 characters if you deploy manually outside the blueprint.
- Marketing chart endpoint defaults to `GET /api/public/marketing/charts` with payload file `apps/control-plane/data/marketing-charts.json`.

Default public form endpoint configured in [`website/site/contact.html`](./website/site/contact.html):

- `https://theia-control-plane.onrender.com/api/public/leads`

## Public Website

A full static marketing site is included at `website/site` with a red/black design system, SEO tags, sitemap, and robots configuration.

Live URL:

- `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring/`

Keyword landing pages:

- `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring/agent-observability.html`
- `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring/ai-memory-orchestration.html`
- `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring/workflow-auditability.html`

Freshness pages:

- `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring/changelog.html`
- `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring/case-studies.html`
- `https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring/feed.xml`

GitHub Pages deploy workflow:
- `.github/workflows/pages.yml`
- monthly reminder workflow: `.github/workflows/visibility-refresh-reminder.yml`

Before going live, replace placeholder values:
- domain `https://theiaops.ai`
- Google verification token in `website/site/index.html`
- contact form endpoint in `website/site/contact.html`

Search visibility operations:

- `docs/google-indexing-checklist.md`
- `docs/seo-visibility-playbook.md`
- `docs/domain-acquisition-and-cutover-plan.md`

AWM hardening and integrated-app planning:

- `docs/awm-hardening-implementation.md`
- `docs/downloadable-app-integration-plan.md`
- `docs/desktop-installer-playbook.md`

Domain cutover helper:

```powershell
.\scripts\prepare-custom-domain.ps1 -PrimaryDomain "www.yourdomain.com" -Apply
```

## Connector Priorities Implemented

- `Codex CLI logs` via `CodexCliConnector`
- `Custom JSON logs` via `CustomJsonConnector`
- `OpenClaw traces` via `OpenClawConnector`
- Existing `memory.md` / `bootstrap.md` ingestion via `LocalFileConnector`

Local core environment variables:

- `THEIA_FILE_SOURCES=memory.md,bootstrap.md`
- `THEIA_CODEX_LOG_SOURCES=/path/to/codex.log`
- `THEIA_CUSTOM_JSON_SOURCES=/path/to/events.json`
- `THEIA_OPENCLAW_WORKSPACE_PATH=C:\Users\admin_1\src\openclaw`
- `THEIA_OPENCLAW_DISCOVERY_PATHS=C:\Users\admin_1\src\openclaw`
- `THEIA_OPENCLAW_LOG_SOURCES=C:\Users\admin_1\src\openclaw`
- `THEIA_APPROVED_PATHS=.,C:\Users\admin_1\src\openclaw`

## SAML Setup (Free-Provider Friendly)

Recommended: configure a free testing IdP metadata URL (for example `samltest.id`) and set:

- `THEIA_SAML_METADATA_URL=...`
- `THEIA_SAML_ISSUER=theia-control-plane`
- `THEIA_SAML_CALLBACK_URL=http://localhost:4620/auth/saml/callback`

You can also provide direct settings:

- `THEIA_SAML_ENTRY_POINT=...`
- `THEIA_SAML_CERT=...`

## Repository Layout

- `apps/desktop` - dashboard control center shell
- `apps/local-core` - local ingestion/orchestration API service
- `apps/control-plane` - optional auth/governance plane and login-volume dashboard
- `packages/*` - shared schema, connectors, reasoning, policy modules
- `docs` - sections 1-13 blueprint materials (14 and 15 intentionally excluded)
- `website` - website messaging and content assets

## Security

See [SECURITY.md](./SECURITY.md) for reporting and secure development expectations.

## License

Released under the MIT License. See [LICENSE](./LICENSE).

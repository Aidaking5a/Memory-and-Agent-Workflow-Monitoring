# Theia

Theia is a premium, consent-based memory and agent workflow orchestration platform focused on transparent operations, explainable oversight, and trust-by-default controls.

## What This Repository Includes

- Cross-platform desktop dashboard foundation (`apps/desktop`)
- Local core ingestion and timeline service (`apps/local-core`)
- Optional control plane with SAML-ready auth and login-volume dashboard (`apps/control-plane`)
- Canonical schema package for workflow and memory entities (`packages/event-schema`)
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

You can also double-click:

- `scripts/start-theia-dev.cmd`

The `.cmd` wrappers run PowerShell with a per-process bypass, so you do not need to change global execution policy settings.

Stop all local services:

```powershell
pnpm run dev:stop
```

## Lead Intake And Tracking

The website demo form posts to:

- `POST /api/public/leads` on the control plane

Authenticated operators can review and manage leads in:

- `http://localhost:4620/dashboard`

Lead records are stored locally at:

- `apps/control-plane/data/lead-submissions.json`

Lead-related environment variables:

- `THEIA_LEADS_ALLOW_ORIGINS` (comma-separated allowed origins for public lead POSTs)
- `THEIA_LEADS_IP_HASH_SALT` (optional salt for privacy-preserving IP hashing)
- `THEIA_ENABLE_DEV_LOGIN` (set `false` for public deployments)

## Public HTTPS Control Plane (Render)

This repo includes [`render.yaml`](./render.yaml) for deploying the control plane with HTTPS and a strict lead origin allowlist.

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

AWM hardening and integrated-app planning:

- `docs/awm-hardening-implementation.md`
- `docs/downloadable-app-integration-plan.md`

## Connector Priorities Implemented

- `Codex CLI logs` via `CodexCliConnector`
- `Custom JSON logs` via `CustomJsonConnector`
- Existing `memory.md` / `bootstrap.md` ingestion via `LocalFileConnector`

Local core environment variables:

- `THEIA_FILE_SOURCES=memory.md,bootstrap.md`
- `THEIA_CODEX_LOG_SOURCES=/path/to/codex.log`
- `THEIA_CUSTOM_JSON_SOURCES=/path/to/events.json`
- `THEIA_APPROVED_PATHS=/approved/path/one,/approved/path/two`

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

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

## Public Website

A full static marketing site is included at `website/site` with a red/black design system, SEO tags, sitemap, and robots configuration.

GitHub Pages deploy workflow:
- `.github/workflows/pages.yml`

Before going live, replace placeholder values:
- domain `https://theiaops.ai`
- `YOUR_ORG/YOUR_REPO` links in `website/site/resources.html`
- Google verification token in `website/site/index.html`
- contact form endpoint in `website/site/contact.html`

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

# Local Infrastructure Runbook

## What Is Included

This repo now has repeatable Windows and Apple/macOS one-liners for:

- Dashboard stack: local-core API plus desktop dashboard.
- Marketing site: static website server.
- Full local stack: Keycloak, local-core, control plane, desktop dashboard, and marketing site.
- Smoke tests for dashboard, marketing, and combined local infrastructure.

## Prerequisites

Install these manually:

- Node.js 22 LTS
- pnpm via Corepack or npm
- Git for Windows

On macOS, install Git, Node.js 22 LTS, pnpm, `curl`, and `lsof` manually. The shell scripts do not install them for you.

Optional:

- Docker Desktop, only if you want the full `dev:stack` path with Keycloak.
- Rust and Visual Studio Build Tools, only if you want native Tauri installers.

The one-liners do not silently install these dependencies.

## First-Time Setup

```powershell
pnpm.cmd install
pnpm.cmd run setup:local
pnpm.cmd -r build
```

If PowerShell blocks `pnpm`, use `pnpm.cmd`.

## Dashboard One-Liner

```powershell
pnpm.cmd run dev:dashboard
```

Apple/macOS:

```bash
bash ./scripts/start-theia-dashboard.sh --openclaw-path "$HOME/src/openclaw"
```

For this machine, OpenClaw is expected at `C:\Users\admin_1\src\openclaw`. The dashboard one-liner now passes that path to local-core automatically. You can also be explicit:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-theia-dashboard.ps1 -OpenClawPath "C:\Users\admin_1\src\openclaw"
```

Opens:

- Dashboard: `http://localhost:5173`
- Local core: `http://localhost:4318`

Logs:

- `.theia/dev-logs/dashboard-local-core.log`
- `.theia/dev-logs/dashboard-vite.log`

Manual dashboard test:

1. Open `http://localhost:5173`.
2. Create a local account on first launch.
3. Open the `Live Reporting Dashboard` view.
4. Click `Discover`.
5. Register a private agent.
6. Use the generated telemetry token command to send a test event.
7. Confirm the agent card, bubble, stats, and activity feed update.

Automated smoke test:

```powershell
pnpm.cmd run test:dashboard
```

## Marketing Site One-Liner

```powershell
pnpm.cmd run dev:marketing
```

Apple/macOS:

```bash
bash ./scripts/start-theia-marketing-site.sh --port 4173
```

Opens:

- Marketing site: `http://localhost:4173`
- Contact page: `http://localhost:4173/contact.html`

Logs:

- `.theia/dev-logs/marketing-site.log`

Manual marketing test:

1. Open `http://localhost:4173`.
2. Navigate to Product, Use Cases, Security, Pricing, Resources, and Contact.
3. Open `http://localhost:4173/sitemap.xml`.
4. Open `http://localhost:4173/robots.txt`.
5. If testing lead capture, also start the control plane and configure `data-api-base-url` / `THEIA_LEADS_ALLOW_ORIGINS`.

Automated smoke test:

```powershell
pnpm.cmd run test:marketing
```

## Full Stack One-Liner

```powershell
pnpm.cmd run dev:stack
```

This starts Keycloak, local-core, control plane, desktop dashboard, and marketing site. It requires Docker for Keycloak. Use this when testing lead intake, SAML/control-plane behavior, and the dashboard together.

Automated smoke test:

```powershell
pnpm.cmd run test:local-infra
```

## Stop Everything

```powershell
pnpm.cmd run dev:stop
```

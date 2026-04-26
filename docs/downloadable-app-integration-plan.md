# Theia Downloadable App Integration Plan

Goal: ship a customer-installable Theia app for macOS and Windows with local-first orchestration, optional cloud control plane, and enterprise-trust defaults.

## Target End State

- Single installer launches:
  - local core service
  - desktop dashboard
  - optional authenticated control-plane integration
- One setup flow for connectors, permissions, and SSO.
- Signed binaries and update channels for stable rollout.

## Technical Stack Path

Current:
- Desktop: React + Vite shell (`apps/desktop`)
- Local orchestration: Fastify (`apps/local-core`)
- Control plane: Fastify (`apps/control-plane`)

Scale-up recommendation:
- Move desktop runtime from pure web-shell packaging to `Tauri + Rust` when one or more triggers are hit:
  - need native process supervision (start/stop core reliably)
  - need stronger local secret storage and OS keychain integration
  - need lower RAM usage for enterprise multi-agent sessions
  - need signed auto-update channels with staged rollouts

## Integration Milestones

## Milestone 1: Unified Local Dev Runtime

- Add desktop control actions:
  - start/stop local core
  - health checks and reconnect UI
- Persist workspace and connector settings locally.
- Add first-run permission wizard.

## Milestone 2: Installer and Process Supervision

- Introduce Tauri shell with native process manager for local core.
- Bundle desktop + local core into one install artifact.
- Add OS startup option (opt-in only).

## Milestone 3: Secure Identity and Enterprise Controls

- Keep local mode fully functional without cloud dependency.
- Add enterprise SSO policies via control plane:
  - SAML/OIDC
  - RBAC mappings
  - audit export

## Milestone 4: Production Distribution

- Signed installers:
  - Windows: Authenticode
  - macOS: Developer ID + notarization
- Versioned release channels:
  - stable
  - preview

## Buyer Onboarding Flow

1. Install Theia desktop.
2. Connect local workflow sources (`memory.md`, `bootstrap.md`, Codex logs, JSON traces).
3. Review and accept explicit permission scopes.
4. Run first ingestion and workflow governance check.
5. (Optional) connect control plane for team login and governance sync.

## Success Metrics

- Time-to-first-insight < 10 minutes.
- >90% of high-impact workflow promotions pass through review or approved policy automation.
- <5% rollback rate after promotion in first 30 days.
- >95% connector health during active sessions.

# 13. Basic Implementation Pack

This repository includes implementation-ready starter assets.

## Included

- Product positioning and strategic docs (`docs/01` through `docs/12`)
- Architecture and security model
- Connector SDK contract
- Codex CLI and custom JSON connector implementations
- Memory parsing and versioning rules
- Canonical event schema + validation package
- Reasoning alert taxonomy + heuristic evaluation engine
- Permission and policy engine with audit chaining
- Desktop dashboard shell with required views
- Local core service with ingest/run/timeline/alert endpoints
- Optional control-plane service with SAML-ready auth and login-volume website
- GitHub governance and CI publication scaffolding

## Core Starter Artifacts

- `apps/local-core/src/parser.ts` - parsing rules for `memory.md` and `bootstrap.md`
- `packages/event-schema/src/schema.ts` - canonical schema definitions
- `packages/reasoning-engine/src/index.ts` - alert taxonomy and detectors
- `packages/policy-engine/src/index.ts` - RBAC, grants, and audit chain
- `apps/desktop/src` - dashboard shell and navigation model
- `website/` - marketing and trust-center copy assets

## Intent

The implementation is deliberately practical and extensible: enough to run, evaluate, and evolve quickly without pretending to be a finished enterprise product.

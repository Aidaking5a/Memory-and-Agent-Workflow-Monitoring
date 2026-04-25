# 12. GitHub Repository and Delivery Plan

## Repository Model

Monorepo structure for coordinated evolution of schemas, connectors, reasoning logic, local core, desktop UX, and optional control-plane services.

## Visibility Decision

The project is prepared for **public GitHub publication** with high visibility.

Implications:
- Strong README and positioning narrative
- Clear governance and contribution standards
- Security disclosure pathway
- CI quality gates for public trust

## Key Directories

- `apps/desktop`
- `apps/local-core`
- `apps/control-plane`
- `packages/event-schema`
- `packages/connector-sdk`
- `packages/reasoning-engine`
- `packages/policy-engine`
- `docs`

## Publication Artifacts

- `README.md`
- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- issue templates
- PR template
- CI workflow
- changelog strategy

## Versioning and Releases

- Semantic versioning (SemVer)
- Conventional commits and changelog entries
- CI gates for build/test/typecheck
- Signed release artifacts once installer distribution begins

## Inputs Needed for Real Push

- Final GitHub organization and repository name
- Branding assets and social preview images
- Maintainer handles for CODEOWNERS expansion
- Optional release automation secrets
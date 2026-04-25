# Contributing to Theia

Thanks for contributing.

## Development Workflow

1. Create a branch prefixed with `codex/`.
2. Keep changes scoped and documented.
3. Run:
   - `pnpm build`
   - `pnpm test`
   - `pnpm typecheck`
4. Open a pull request with context, impact, and testing notes.

## Coding Expectations

- Follow least-privilege and privacy-by-design principles.
- Favor explicitness and traceability over hidden automation.
- Add or update docs for behavior changes.

## Commit Guidance

Use conventional commit style where possible, for example:
- `feat(local-core): add memory parser for bootstrap.md`
- `fix(reasoning-engine): reduce contradiction false positives`

## Review Criteria

- Correctness and maintainability
- Security and consent boundaries
- Explainability of outputs and alerts
- Regression and test coverage quality
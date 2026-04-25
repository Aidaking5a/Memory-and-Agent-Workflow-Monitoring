# Permission Model

## Role Layer

- Owner
- Operator
- Reviewer
- Auditor
- Read-only

## Grant Layer

Scopes:
- connector
- file path
- workspace
- event type
- sync mode

Grant modes:
- one-time
- session
- persistent

## Enforcement

Access request allowed only when:
1. role permits action
2. active non-revoked grant matches scope
3. time-based constraints (expiry) are satisfied

All decisions are recorded in audit chain.
# 9. Security, Privacy, and Trust Model

## Security Principles

- Least privilege by default
- Explicit, revocable consent
- Local-first processing
- Secure-by-design controls across ingestion, storage, and updates

## Data Processing Boundaries

Local default:
- Parsing memory files
- Building event timelines
- Running reasoning detectors

Optional remote:
- Team dashboards
- Policy federation
- Enterprise audit exports

## Controls

- RBAC roles (`owner`, `operator`, `reviewer`, `auditor`, `read_only`)
- Scope-bound grants (connector, file path, workspace, event type, sync mode)
- Optional SAML-based identity integration for control-plane authentication
- Immutable audit chain for permission mutations and access decisions
- Sensitive data redaction before sharing/export

## Encryption and Integrity

- Encrypt stores at rest (implementation-specific)
- TLS for remote sync/control plane links
- Signed release artifacts and installer trust chain

## Risk Priorities

- Over-collection risk -> strict scope prompts + minimization
- Connector abuse risk -> approved path checks + role checks
- Alert fatigue risk -> confidence thresholds + feedback loop
- Reputational risk -> transparent, non-surveillance messaging

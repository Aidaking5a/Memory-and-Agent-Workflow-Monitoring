# AWM Hardening Implementation (Theia)

This document maps AWM-inspired product hardening requirements to implemented platform behavior.

## Implemented In This Iteration

## Workflow-derived decisions as first-class evidence

- Added workflow lifecycle event types:
  - `workflow.derived_decision`
  - `workflow.candidate_created`
  - `workflow.promotion_requested`
  - `workflow.promoted`
  - `workflow.rejected`
  - `workflow.rollback`
  - `workflow.compatibility_conflict`
  - `workflow.retired`
  - `workflow.expired`
- `TheiaCore` now creates workflow candidates from run snapshots and emits governance events with evidence refs.

## Drift-aware memory/workflow checks

- Added alert category `workflow_context_mismatch`.
- Reasoning engine now flags likely objective/context mismatch for workflow-derived decisions.

## Failure mode: over-following workflow in changed context

- `workflow_context_mismatch` alerts include alignment and context-shift signals.
- Candidate gate metrics include utility/contradiction/stale-use rates to prevent blind promotion.

## Failure mode: noisy induction from imperfect runs

- Added alert category `workflow_induction_noise`.
- Candidate promotion now uses explicit gates:
  - confidence
  - evaluator agreement
  - tool grounding
  - utility
  - overlap
  - contradiction
  - stale-use
  - evidence packet counts

## Offline/online conflicts

- Namespace-aware compatibility checks implemented for tenant/domain/task-family.
- Conflicts emit `workflow.compatibility_conflict` and block promotion with `workflow_conflict_detected`.

## Rollback, retirement, and release gates

- Added rollback API (`POST /workflows/:workflowId/rollback`).
- Added stale retirement API (`POST /workflows/retire-stale`).
- Added release gate report API (`GET /workflows/release-gates/report`).

## Human approval for high impact

- High/critical workflows can be routed to pending review.
- Review API supports explicit approval metadata (`humanApprovalProvided`).
- Workflow decisions are tracked with provenance in `WorkflowPromotionDecision`.

## Dashboard UX upgrades

- Added `Workflow Governance` desktop view with:
  - release-gate summary
  - policy thresholds
  - candidate queue and conflict indicators

## Next Hardening Step (Recommended)

- Add configurable multi-evaluator agreement providers (deterministic + LLM evaluator pair).
- Add policy version history and signed policy snapshots.
- Add auto-rollback trigger when post-promotion contradiction/stale-use exceeds thresholds.

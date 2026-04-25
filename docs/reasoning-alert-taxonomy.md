# Reasoning Alert Taxonomy

## Categories and Intent

- `unsupported_assumption`: claim lacks evidence
- `stale_memory`: outdated memory version used
- `contradiction`: conclusion conflicts with earlier step
- `hallucination_risk`: fact-like claim without source support
- `evidence_gap`: recommendation appears before evidence linkage
- `loop_behavior`: repetitive low-progress cycle
- `tool_mismatch`: conclusion conflicts with tool result
- `overconfidence_without_verification`: certainty language without validation
- `task_drift`: step diverges from stated objective
- `unsafe_automation_escalation`: privileged action without required approval

## Alert Envelope

Each alert includes:
- category
- severity
- confidence + confidence band
- plain-language explanation
- source-linked evidence references
- lifecycle state (`open`, `acknowledged`, `dismissed`, `resolved`)
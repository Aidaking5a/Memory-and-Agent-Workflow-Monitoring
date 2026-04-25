# 7. Reasoning Fallacy Detection Framework

Theia uses assistive, explainable detectors to surface likely reasoning issues. It does not claim guaranteed correctness.

## Alert Categories

- Unsupported assumption
- Stale-memory dependence
- Contradiction with prior conclusions
- Hallucination risk
- Evidence gap
- Loop behavior
- Tool-result mismatch
- Overconfidence without verification
- Task drift
- Unsafe automation escalation

## Detection Pattern

For each category, Theia captures:
- Signals: observable event/memory patterns
- Confidence: numeric score (`0.00` to `1.00`) + low/medium/high band
- Explanation: plain-language rationale with linked evidence
- False-positive controls: thresholds, recency windows, and user feedback tuning

## Operational Posture

- Alerts are advisory and review-oriented.
- Users can acknowledge, dismiss, or resolve alerts.
- Feedback can improve threshold calibration over time.
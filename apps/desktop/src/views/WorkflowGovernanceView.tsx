import { useEffect, useMemo, useState } from "react";
import {
  approveWorkflowCandidate,
  rejectWorkflowCandidate,
  retireStaleWorkflowCandidates,
  rollbackWorkflowCandidate,
  updateWorkflowPromotionPolicy
} from "../api";
import { SeverityBadge } from "../components/SeverityBadge";
import type { DashboardData } from "../types";

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type WorkflowActionKind = "approve" | "reject" | "rollback";

interface WorkflowGovernanceViewProps {
  data: DashboardData;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

export function WorkflowGovernanceView({ data, onRefresh, isRefreshing }: WorkflowGovernanceViewProps) {
  const [activeAction, setActiveAction] = useState<{ workflowId: string; kind: WorkflowActionKind } | null>(null);
  const [isRetiring, setIsRetiring] = useState(false);
  const [isEditingPolicy, setIsEditingPolicy] = useState(false);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [policyDraft, setPolicyDraft] = useState(data.workflowPolicy);
  const [feedback, setFeedback] = useState<{ level: "success" | "error"; message: string } | null>(null);

  const canReview = data.operator.capabilities.includes("workflow:review");
  const canRollback = data.operator.capabilities.includes("workflow:rollback");
  const canRetire = data.operator.capabilities.includes("workflow:retire");
  const canPolicyWrite = data.operator.capabilities.includes("workflow:policy:write");

  useEffect(() => {
    if (!isEditingPolicy) {
      setPolicyDraft(data.workflowPolicy);
    }
  }, [data.workflowPolicy, isEditingPolicy]);

  const controlsDisabled = isRefreshing || isRetiring || isSavingPolicy || activeAction !== null;

  const policyRows = useMemo(
    () =>
      [
        { key: "minConfidenceScore", label: "Min confidence", step: 0.01, min: 0, max: 1 },
        { key: "minEvaluatorAgreement", label: "Min evaluator agreement", step: 0.01, min: 0, max: 1 },
        { key: "minToolGroundingScore", label: "Min tool grounding", step: 0.01, min: 0, max: 1 },
        { key: "minUtilityRate", label: "Min utility", step: 0.01, min: 0, max: 1 },
        { key: "maxOverlapRate", label: "Max overlap", step: 0.01, min: 0, max: 1 },
        { key: "maxContradictionRate", label: "Max contradiction rate", step: 0.01, min: 0, max: 1 },
        { key: "maxStaleUseRate", label: "Max stale-use rate", step: 0.01, min: 0, max: 1 },
        { key: "minEvidencePacketCount", label: "Min evidence packet count", step: 1, min: 1, max: 9999 },
        { key: "minSafeAutomationEvidenceCount", label: "Min safe-automation evidence count", step: 1, min: 0, max: 9999 }
      ] as const,
    []
  );

  async function executeWorkflowAction(
    workflowId: string,
    kind: WorkflowActionKind,
    run: () => Promise<void>,
    successMessage: string
  ) {
    setFeedback(null);
    setActiveAction({ workflowId, kind });
    try {
      await run();
      await onRefresh();
      setFeedback({ level: "success", message: successMessage });
    } catch (error) {
      setFeedback({
        level: "error",
        message: error instanceof Error ? error.message : "Workflow action failed."
      });
    } finally {
      setActiveAction(null);
    }
  }

  function handleApprove(workflowId: string) {
    if (!canReview) {
      setFeedback({ level: "error", message: "Current role cannot approve workflows." });
      return;
    }
    const note = window.prompt("Approval note (optional):", "Approved after governance review.");
    if (note === null) return;

    void executeWorkflowAction(
      workflowId,
      "approve",
      () => approveWorkflowCandidate(workflowId, note.trim() || undefined),
      `Workflow ${workflowId} promoted successfully.`
    );
  }

  function handleReject(workflowId: string) {
    if (!canReview) {
      setFeedback({ level: "error", message: "Current role cannot reject workflows." });
      return;
    }
    const reason = window.prompt("Reason for rejection (recommended):", "Rejected due to insufficient evidence.");
    if (reason === null) return;

    void executeWorkflowAction(
      workflowId,
      "reject",
      () => rejectWorkflowCandidate(workflowId, reason.trim() || undefined),
      `Workflow ${workflowId} rejected.`
    );
  }

  function handleRollback(workflowId: string) {
    if (!canRollback) {
      setFeedback({ level: "error", message: "Current role cannot roll back workflows." });
      return;
    }
    const reason = window.prompt("Rollback reason (required):", "Regression observed after promotion.");
    if (reason === null) return;
    if (reason.trim().length === 0) {
      setFeedback({ level: "error", message: "Rollback reason is required." });
      return;
    }

    void executeWorkflowAction(
      workflowId,
      "rollback",
      () => rollbackWorkflowCandidate(workflowId, reason.trim()),
      `Workflow ${workflowId} rolled back.`
    );
  }

  async function handleRetireStale() {
    if (!canRetire) {
      setFeedback({ level: "error", message: "Current role cannot retire stale workflows." });
      return;
    }
    const input = window.prompt("Retire workflows older than how many days?", "30");
    if (input === null) return;

    const maxAgeDays = Number.parseInt(input, 10);
    if (!Number.isFinite(maxAgeDays) || maxAgeDays < 1) {
      setFeedback({ level: "error", message: "Enter a valid number of days (>= 1)." });
      return;
    }

    setFeedback(null);
    setIsRetiring(true);
    try {
      const retiredCount = await retireStaleWorkflowCandidates(maxAgeDays);
      await onRefresh();
      setFeedback({
        level: "success",
        message: retiredCount === 0 ? "No stale workflows were retired." : `Retired ${retiredCount} stale workflow(s).`
      });
    } catch (error) {
      setFeedback({
        level: "error",
        message: error instanceof Error ? error.message : "Failed to retire stale workflows."
      });
    } finally {
      setIsRetiring(false);
    }
  }

  function setPolicyNumberField(key: keyof DashboardData["workflowPolicy"], value: string, fallback: number) {
    const parsed = Number.parseFloat(value);
    setPolicyDraft((prev) => ({
      ...prev,
      [key]: Number.isFinite(parsed) ? parsed : fallback
    }));
  }

  function validatePolicyDraft(): string | null {
    const unitIntervalFields: Array<keyof DashboardData["workflowPolicy"]> = [
      "minConfidenceScore",
      "minEvaluatorAgreement",
      "minToolGroundingScore",
      "minUtilityRate",
      "maxOverlapRate",
      "maxContradictionRate",
      "maxStaleUseRate"
    ];

    for (const field of unitIntervalFields) {
      const value = policyDraft[field];
      if (typeof value !== "number" || value < 0 || value > 1) {
        return `${field} must be between 0 and 1.`;
      }
    }

    if (!Number.isInteger(policyDraft.minEvidencePacketCount) || policyDraft.minEvidencePacketCount < 1) {
      return "minEvidencePacketCount must be an integer greater than or equal to 1.";
    }
    if (
      !Number.isInteger(policyDraft.minSafeAutomationEvidenceCount) ||
      policyDraft.minSafeAutomationEvidenceCount < 0
    ) {
      return "minSafeAutomationEvidenceCount must be an integer greater than or equal to 0.";
    }

    return null;
  }

  async function handleSavePolicy() {
    if (!canPolicyWrite) {
      setFeedback({ level: "error", message: "Current role cannot update workflow promotion policy." });
      return;
    }
    const validationError = validatePolicyDraft();
    if (validationError) {
      setFeedback({ level: "error", message: validationError });
      return;
    }

    setFeedback(null);
    setIsSavingPolicy(true);
    try {
      await updateWorkflowPromotionPolicy(policyDraft);
      await onRefresh();
      setIsEditingPolicy(false);
      setFeedback({ level: "success", message: "Workflow promotion policy updated." });
    } catch (error) {
      setFeedback({
        level: "error",
        message: error instanceof Error ? error.message : "Failed to update workflow policy."
      });
    } finally {
      setIsSavingPolicy(false);
    }
  }

  return (
    <section className="view">
      <div className="panel-grid">
        <article className="panel">
          <h3>Release Gate Health</h3>
          <ul className="dense-list">
            <li>Total candidates: {data.workflowReport.totalCandidates}</li>
            <li>Promoted: {data.workflowReport.promotedCandidates}</li>
            <li>Pending review: {data.workflowReport.pendingReviewCandidates}</li>
            <li>Rejected: {data.workflowReport.rejectedCandidates}</li>
            <li>Rolled back: {data.workflowReport.rolledBackCandidates}</li>
            <li>Open compatibility conflicts: {data.workflowReport.conflictOpenCount}</li>
          </ul>
          <p className="muted-note">
            Avg confidence {percentage(data.workflowReport.avgConfidenceScore)} | Avg utility{" "}
            {percentage(data.workflowReport.avgUtilityRate)}
          </p>
        </article>
        <article className="panel">
          <div className="panel-header-row">
            <h3>Promotion Policy</h3>
            {!isEditingPolicy ? (
              <button
                className="action-btn neutral"
                disabled={controlsDisabled || !canPolicyWrite}
                onClick={() => setIsEditingPolicy(true)}
                type="button"
              >
                Edit Policy
              </button>
            ) : (
              <div className="action-group">
                <button
                  className="action-btn primary"
                  disabled={controlsDisabled || !canPolicyWrite}
                  onClick={() => void handleSavePolicy()}
                  type="button"
                >
                  {isSavingPolicy ? "Saving..." : "Save"}
                </button>
                <button
                  className="action-btn neutral"
                  disabled={controlsDisabled || !canPolicyWrite}
                  onClick={() => {
                    setPolicyDraft(data.workflowPolicy);
                    setIsEditingPolicy(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {!canPolicyWrite ? <p className="muted-note">Current role cannot edit workflow promotion policy.</p> : null}

          {!isEditingPolicy ? (
            <ul className="dense-list">
              <li>Min confidence: {percentage(data.workflowPolicy.minConfidenceScore)}</li>
              <li>Min evaluator agreement: {percentage(data.workflowPolicy.minEvaluatorAgreement)}</li>
              <li>Min tool grounding: {percentage(data.workflowPolicy.minToolGroundingScore)}</li>
              <li>Min utility: {percentage(data.workflowPolicy.minUtilityRate)}</li>
              <li>Max overlap: {percentage(data.workflowPolicy.maxOverlapRate)}</li>
              <li>Max contradiction rate: {percentage(data.workflowPolicy.maxContradictionRate)}</li>
              <li>Max stale-use rate: {percentage(data.workflowPolicy.maxStaleUseRate)}</li>
              <li>Min evidence packet count: {data.workflowPolicy.minEvidencePacketCount}</li>
              <li>
                Min safe-automation evidence count: {data.workflowPolicy.minSafeAutomationEvidenceCount}
              </li>
              <li>
                High-impact human approval:{" "}
                {data.workflowPolicy.requireHumanApprovalForHighImpact ? "required" : "optional"}
              </li>
            </ul>
          ) : (
            <div className="policy-form">
              {policyRows.map((row) => (
                <label className="field-row" key={row.key}>
                  <span>{row.label}</span>
                  <input
                    disabled={controlsDisabled || !canPolicyWrite}
                    max={row.max}
                    min={row.min}
                    step={row.step}
                    type="number"
                    value={policyDraft[row.key]}
                    onChange={(event) =>
                      setPolicyNumberField(
                        row.key,
                        event.currentTarget.value,
                        data.workflowPolicy[row.key]
                      )
                    }
                  />
                </label>
              ))}
              <label className="field-row">
                <span>Require human approval for high impact</span>
                <input
                  checked={policyDraft.requireHumanApprovalForHighImpact}
                  disabled={controlsDisabled || !canPolicyWrite}
                  type="checkbox"
                  onChange={(event) =>
                    setPolicyDraft((prev) => ({
                      ...prev,
                      requireHumanApprovalForHighImpact: event.currentTarget.checked
                    }))
                  }
                />
              </label>
            </div>
          )}
        </article>
      </div>
      <article className="panel">
        <div className="panel-header-row">
          <h3>Workflow Candidate Queue</h3>
          <button className="action-btn neutral" disabled={controlsDisabled || !canRetire} onClick={handleRetireStale} type="button">
            {isRetiring ? "Retiring..." : "Retire Stale"}
          </button>
        </div>
        {!canRetire ? <p className="muted-note">Current role cannot retire stale workflows.</p> : null}
        {feedback ? <p className={feedback.level === "error" ? "feedback error" : "feedback success"}>{feedback.message}</p> : null}
        <table>
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Status</th>
              <th>Impact</th>
              <th>Namespace</th>
              <th>Confidence</th>
              <th>Utility</th>
              <th>Overlap</th>
              <th>Contradiction</th>
              <th>Stale Use</th>
              <th>Conflicts</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.workflowCandidates.map((candidate) => (
              <tr key={candidate.workflowId}>
                <td>{candidate.title}</td>
                <td>
                  <span className={`status-pill ${candidate.status}`}>{candidate.status.replace("_", " ")}</span>
                </td>
                <td>
                  <SeverityBadge severity={candidate.impactLevel} />
                </td>
                <td>{candidate.namespace}</td>
                <td>{percentage(candidate.confidenceScore)}</td>
                <td>{percentage(candidate.utilityRate)}</td>
                <td>{percentage(candidate.overlapRate)}</td>
                <td>{percentage(candidate.contradictionRate)}</td>
                <td>{percentage(candidate.staleUseRate)}</td>
                <td>{candidate.conflictCount}</td>
                <td>{new Date(candidate.updatedAt).toLocaleString()}</td>
                <td>
                  <div className="action-group">
                    {candidate.status === "pending_review" ? (
                      <>
                        <button
                          className="action-btn primary"
                          disabled={controlsDisabled || !canReview}
                          onClick={() => handleApprove(candidate.workflowId)}
                          type="button"
                        >
                          {activeAction?.workflowId === candidate.workflowId && activeAction.kind === "approve"
                            ? "Approving..."
                            : "Approve"}
                        </button>
                        <button
                          className="action-btn danger"
                          disabled={controlsDisabled || !canReview}
                          onClick={() => handleReject(candidate.workflowId)}
                          type="button"
                        >
                          {activeAction?.workflowId === candidate.workflowId && activeAction.kind === "reject"
                            ? "Rejecting..."
                            : "Reject"}
                        </button>
                      </>
                    ) : null}
                    {candidate.status === "promoted" ? (
                      <button
                        className="action-btn danger"
                        disabled={controlsDisabled || !canRollback}
                        onClick={() => handleRollback(candidate.workflowId)}
                        type="button"
                      >
                        {activeAction?.workflowId === candidate.workflowId && activeAction.kind === "rollback"
                          ? "Rolling Back..."
                          : "Rollback"}
                      </button>
                    ) : null}
                    {candidate.status !== "pending_review" && candidate.status !== "promoted" ? (
                      <span className="muted-note">No action</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}

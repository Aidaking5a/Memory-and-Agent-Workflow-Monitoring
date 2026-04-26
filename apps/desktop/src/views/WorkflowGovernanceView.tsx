import { useState } from "react";
import {
  approveWorkflowCandidate,
  rejectWorkflowCandidate,
  retireStaleWorkflowCandidates,
  rollbackWorkflowCandidate
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
  const [feedback, setFeedback] = useState<{ level: "success" | "error"; message: string } | null>(null);

  const controlsDisabled = isRefreshing || isRetiring || activeAction !== null;

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
          <h3>Promotion Policy</h3>
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
              High-impact human approval: {data.workflowPolicy.requireHumanApprovalForHighImpact ? "required" : "optional"}
            </li>
          </ul>
        </article>
      </div>
      <article className="panel">
        <div className="panel-header-row">
          <h3>Workflow Candidate Queue</h3>
          <button className="action-btn neutral" disabled={controlsDisabled} onClick={handleRetireStale} type="button">
            {isRetiring ? "Retiring..." : "Retire Stale"}
          </button>
        </div>
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
                          disabled={controlsDisabled}
                          onClick={() => handleApprove(candidate.workflowId)}
                          type="button"
                        >
                          {activeAction?.workflowId === candidate.workflowId && activeAction.kind === "approve"
                            ? "Approving..."
                            : "Approve"}
                        </button>
                        <button
                          className="action-btn danger"
                          disabled={controlsDisabled}
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
                        disabled={controlsDisabled}
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

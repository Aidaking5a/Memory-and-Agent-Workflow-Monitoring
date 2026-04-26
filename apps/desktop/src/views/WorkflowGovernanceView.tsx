import { SeverityBadge } from "../components/SeverityBadge";
import type { DashboardData } from "../types";

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function WorkflowGovernanceView({ data }: { data: DashboardData }) {
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
        <h3>Workflow Candidate Queue</h3>
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
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}

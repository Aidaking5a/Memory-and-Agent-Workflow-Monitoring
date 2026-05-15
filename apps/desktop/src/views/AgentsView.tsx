import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertOctagon,
  Bell,
  BookOpen,
  CheckCircle,
  CircleDollarSign,
  Clock,
  Copy,
  Cpu,
  Download,
  Eye,
  Filter,
  Focus,
  Gauge,
  HardDrive,
  HelpCircle,
  KeyRound,
  LayoutGrid,
  Link2,
  List,
  Lock,
  MessageSquare,
  Minus,
  Navigation,
  Plus,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Terminal,
  Trash2,
  Users,
  Wallet,
  Zap
} from "lucide-react";
import {
  breakAgentLink,
  connectConnector,
  createOpenClawPairing,
  discoverAgentNetwork,
  discoverConnectorStrategy,
  loadAgentNetworkSnapshot,
  loadConnectorStatus,
  listOpenClawPairings,
  makeAgentLink,
  registerPrivateAgent,
  revokeOpenClawPairing,
  sendAgentControlCommand,
  subscribeAgentNetworkStream,
  validateConnector
} from "../api";
import type {
  AgentCommandCenterAgent,
  AgentCommandCenterLink,
  AgentConnectionKind,
  AgentControlLevel,
  AgentNetworkSnapshot,
  ConnectorDiscoveryCandidate,
  ConnectorRegistrationView,
  DashboardData,
  OpenClawPairingCommands,
  OpenClawPairingView,
  ViewKey
} from "../types";

interface AgentFormState {
  name: string;
  role: string;
  domain: string;
  model: string;
  vendor: string;
  connectionKind: AgentConnectionKind;
  endpointLabel: string;
  tools: string;
  skills: string;
  connectors: string;
  controlLevel: AgentControlLevel;
  canCollaborate: boolean;
  canEmergencyStop: boolean;
  trustLevel: "low" | "standard" | "trusted" | "restricted";
  memorySummary: string;
  soulSummary: string;
}

const defaultAgentForm: AgentFormState = {
  name: "",
  role: "Agent",
  domain: "general",
  model: "",
  vendor: "",
  connectionKind: "local",
  endpointLabel: "",
  tools: "",
  skills: "",
  connectors: "",
  controlLevel: "observe_only",
  canCollaborate: false,
  canEmergencyStop: false,
  trustLevel: "standard",
  memorySummary: "",
  soulSummary: ""
};

export function AgentsView({ data, mode }: { data: DashboardData; mode: ViewKey }) {
  const [network, setNetwork] = useState<AgentNetworkSnapshot>(data.agentNetwork);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(data.agentNetwork.agents[0]?.agentId);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>();
  const [agentForm, setAgentForm] = useState<AgentFormState>(defaultAgentForm);
  const [steeringText, setSteeringText] = useState("");
  const [sharedTask, setSharedTask] = useState("");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [linkScope, setLinkScope] = useState("");
  const [networkZoom, setNetworkZoom] = useState(1);
  const [cardViewMode, setCardViewMode] = useState<"grid" | "list">("grid");
  const [expandedAgentId, setExpandedAgentId] = useState<string | undefined>();
  const [activitySearch, setActivitySearch] = useState("");
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "blocked" | "completed">("all");
  const [monthlyBudget, setMonthlyBudget] = useState(200);
  const [safetySettings, setSafetySettings] = useState({
    steeringConfirmation: true,
    emergencyStopLogging: true,
    costWarnings: true,
    autoReconnect: false,
    rawLogAccess: false
  });
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [latestToken, setLatestToken] = useState<{
    token?: string;
    endpoint?: string;
    powershell?: string[];
  }>();
  const [openClawPairings, setOpenClawPairings] = useState<OpenClawPairingView[]>([]);
  const [openClawPairingLabel, setOpenClawPairingLabel] = useState("OpenClaw local workspace");
  const [openClawPairingTtlHours, setOpenClawPairingTtlHours] = useState(24);
  const [openClawPairingBusy, setOpenClawPairingBusy] = useState(false);
  const [openClawPairingError, setOpenClawPairingError] = useState<string | undefined>();
  const [latestOpenClawPairing, setLatestOpenClawPairing] = useState<{
    pairingId: string;
    label: string;
    expiresAt: string;
    token: string;
    telemetryEndpoint: string;
    streamEndpoint: string;
    commands: OpenClawPairingCommands;
  }>();
  const [manualDiscoveries, setManualDiscoveries] = useState<Array<Record<string, unknown>>>([]);
  const [connectorCandidates, setConnectorCandidates] = useState<ConnectorDiscoveryCandidate[]>(data.connectorStrategy.candidates ?? []);
  const [connectorRegistrations, setConnectorRegistrations] = useState<ConnectorRegistrationView[]>(data.connectorStrategy.connectors);
  const [connectorBusy, setConnectorBusy] = useState<string | undefined>();

  useEffect(() => {
    setNetwork(data.agentNetwork);
    setConnectorRegistrations(data.connectorStrategy.connectors);
    if (data.connectorStrategy.candidates?.length) {
      setConnectorCandidates(data.connectorStrategy.candidates);
    }
    if (!selectedAgentId && data.agentNetwork.agents[0]) {
      setSelectedAgentId(data.agentNetwork.agents[0].agentId);
    }
  }, [data.agentNetwork, data.connectorStrategy, selectedAgentId]);

  useEffect(() => {
    const unsubscribe = subscribeAgentNetworkStream({
      onSnapshot: (payload) => {
        if (isAgentNetworkSnapshot(payload)) {
          setNetwork(payload);
        }
      },
      onUpdate: (payload) => {
        const snapshot = (payload as { snapshot?: unknown })?.snapshot;
        if (isAgentNetworkSnapshot(snapshot)) {
          setNetwork(snapshot);
        }
      },
      onError: (error) => {
        if (isConnectionDoctorIssue(error)) {
          setFeedback(undefined);
          return;
        }
        setFeedback({ kind: "error", message: error.message });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (mode === "settings" || mode === "network") {
      void refreshOpenClawPairings(true);
    }
  }, [mode]);

  const selectedAgent = useMemo(
    () => network.agents.find((agent) => agent.agentId === selectedAgentId) ?? network.agents[0],
    [network.agents, selectedAgentId]
  );
  const selectedLink = useMemo(
    () => network.links.find((link) => link.linkId === selectedLinkId),
    [network.links, selectedLinkId]
  );
  const otherAgents = network.agents.filter((agent) => agent.agentId !== selectedAgent?.agentId);
  const filteredEvents = useMemo(
    () =>
      network.events.filter((event) => {
        const query = activitySearch.trim().toLowerCase();
        const matchesQuery =
          query.length === 0 ||
          [
            event.agentName,
            event.category,
            event.status,
            event.safeSummary,
            event.currentTask,
            event.toolCalls.map((tool) => tool.name).join(" ")
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query);
        const matchesFilter =
          activityFilter === "all" ||
          (activityFilter === "active" && ["active", "collaborating", "waiting"].includes(event.status)) ||
          (activityFilter === "blocked" && ["blocked", "failed"].includes(event.status)) ||
          (activityFilter === "completed" && ["idle", "stopped"].includes(event.status));
        return matchesQuery && matchesFilter;
      }),
    [activityFilter, activitySearch, network.events]
  );
  const filteredOperatorCards = useMemo(() => {
    const eventIds = new Set(filteredEvents.map((event) => event.eventId));
    const sourceCards = network.operatorCards?.length ? network.operatorCards : network.events.map(eventToOperatorCard);
    return sourceCards.filter((card) => eventIds.has(card.eventId));
  }, [filteredEvents, network.events, network.operatorCards]);
  const totalCost = network.stats.estimatedSpendUsd;
  const budgetUsage = monthlyBudget > 0 ? Math.min(100, (totalCost / monthlyBudget) * 100) : 0;
  const modelUsage = useMemo(() => buildModelUsage(network), [network]);
  const { title, subtitle } = viewCopy(mode);
  const selectedEmergencyStopPlan = selectedAgent
    ? network.emergencyStopPlans?.find((plan) => plan.agentId === selectedAgent.agentId)
    : undefined;

  const refreshNetwork = async () => {
    const next = await loadAgentNetworkSnapshot();
    setNetwork(next);
  };

  const refreshConnectorStatus = async () => {
    const status = await loadConnectorStatus();
    setConnectorRegistrations(status.connectors);
  };

  const handleDiscoverConnectors = async () => {
    setConnectorBusy("discover");
    setFeedback(undefined);
    try {
      const result = await discoverConnectorStrategy();
      setConnectorCandidates(result.candidates);
      setConnectorRegistrations(result.registered);
      setFeedback({ kind: "success", message: `${result.candidates.length} connector path(s) checked.` });
    } catch (error) {
      setFeedback({ kind: "error", message: connectorErrorMessage(error) });
    } finally {
      setConnectorBusy(undefined);
    }
  };

  const handleConnectConnector = async (candidate: ConnectorDiscoveryCandidate) => {
    setConnectorBusy(candidate.connectorId);
    setFeedback(undefined);
    try {
      const result = await connectConnector(candidate);
      setConnectorRegistrations(result.connectors);
      setFeedback({ kind: "success", message: `${result.connector.displayName} is paired with Theia. Validate when the service is ready.` });
    } catch (error) {
      setFeedback({ kind: "error", message: connectorErrorMessage(error) });
    } finally {
      setConnectorBusy(undefined);
    }
  };

  const handleValidateConnector = async (connectorId: string) => {
    setConnectorBusy(connectorId);
    setFeedback(undefined);
    try {
      const result = await validateConnector(connectorId);
      setConnectorRegistrations(result.connectors);
      setNetwork(result.snapshot);
      setFeedback({ kind: "success", message: `${result.connector.displayName} validated. ${result.syncedEvents} event(s) synced.` });
    } catch (error) {
      setFeedback({ kind: "error", message: connectorErrorMessage(error) });
      await refreshConnectorStatus().catch(() => undefined);
    } finally {
      setConnectorBusy(undefined);
    }
  };

  async function refreshOpenClawPairings(silent = false) {
    if (!silent) {
      setOpenClawPairingBusy(true);
      setOpenClawPairingError(undefined);
    }
    try {
      const result = await listOpenClawPairings();
      setOpenClawPairings(result.pairings);
      setOpenClawPairingError(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load OpenClaw pairings.";
      setOpenClawPairingError(message);
      if (!silent) {
        setFeedback({ kind: "error", message });
      }
    } finally {
      if (!silent) {
        setOpenClawPairingBusy(false);
      }
    }
  }

  const handleCreateOpenClawPairing = async () => {
    setOpenClawPairingBusy(true);
    setOpenClawPairingError(undefined);
    setFeedback(undefined);
    try {
      const result = await createOpenClawPairing({
        label: openClawPairingLabel,
        ttlHours: openClawPairingTtlHours
      });
      setLatestOpenClawPairing(result);
      await refreshOpenClawPairings(true);
      setFeedback({ kind: "success", message: "OpenClaw telemetry token created. Copy it now; tokens are shown once." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create OpenClaw pairing.";
      setOpenClawPairingError(message);
      setFeedback({ kind: "error", message });
    } finally {
      setOpenClawPairingBusy(false);
    }
  };

  const handleRevokeOpenClawPairing = async (pairingId: string) => {
    if (!window.confirm("Revoke this OpenClaw telemetry pairing? Connected hooks using this token will stop reporting.")) {
      return;
    }
    setOpenClawPairingBusy(true);
    setOpenClawPairingError(undefined);
    try {
      await revokeOpenClawPairing(pairingId);
      if (latestOpenClawPairing?.pairingId === pairingId) {
        setLatestOpenClawPairing(undefined);
      }
      await refreshOpenClawPairings(true);
      setFeedback({ kind: "success", message: "OpenClaw telemetry pairing revoked." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to revoke OpenClaw pairing.";
      setOpenClawPairingError(message);
      setFeedback({ kind: "error", message });
    } finally {
      setOpenClawPairingBusy(false);
    }
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setFeedback({ kind: "success", message: successMessage });
    } catch {
      setFeedback({ kind: "error", message: "Copy failed. Select the command text manually." });
    }
  };

  const runControl = async (
    action: "query" | "emergency_stop" | "steer" | "pause" | "resume" | "disconnect" | "focus_together",
    input: Record<string, unknown> = {},
    targetAgent = selectedAgent
  ) => {
    if (!targetAgent) return;
    const highRisk = isMajorControlAction(action);
    const stopPlan = network.emergencyStopPlans?.find((plan) => plan.agentId === targetAgent.agentId);
    const confirmationDetail = action === "emergency_stop" && stopPlan
      ? `\n\nBehavior: ${stopPlan.primaryAction}\nFallback: ${stopPlan.fallbackAction}\nReconnect: ${stopPlan.userReconnectRequired ? "manual approval required" : "automatic reconnect allowed"}`
      : "";
    if (highRisk && !window.confirm(`${labelAction(action)} requires confirmation for ${targetAgent.name}.${confirmationDetail}`)) {
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await sendAgentControlCommand({
        action,
        agentIds: action === "focus_together" && linkTargetId ? [targetAgent.agentId, linkTargetId] : [targetAgent.agentId],
        instruction: action === "steer" ? steeringText : action === "focus_together" ? sharedTask : undefined,
        taskScope: action === "focus_together" ? sharedTask : undefined,
        reason: action === "emergency_stop" ? "Operator emergency stop from command center." : undefined,
        highRisk,
        confirmed: highRisk,
        ...input
      });
      setNetwork(response.snapshot);
      setFeedback({ kind: response.command.status === "failed" ? "error" : "success", message: response.command.resultSummary ?? "Command recorded." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Command failed." });
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterAgent = async () => {
    if (!agentForm.name.trim()) {
      setFeedback({ kind: "error", message: "Agent name is required." });
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await registerPrivateAgent({
        ...agentForm,
        tools: splitList(agentForm.tools),
        skills: splitList(agentForm.skills),
        connectors: splitList(agentForm.connectors)
      });
      setLatestToken({
        token: result.telemetryToken,
        endpoint: result.telemetryEndpoint,
        powershell: result.commands?.powershell
      });
      setSelectedAgentId(result.agent.agentId);
      setAgentForm(defaultAgentForm);
      await refreshNetwork();
      setFeedback({ kind: "success", message: `${result.agent.name} is registered.` });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Unable to register agent." });
    } finally {
      setBusy(false);
    }
  };

  const handleDiscover = async () => {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await discoverAgentNetwork(data.connection.workspacePath);
      setManualDiscoveries(result.manual);
      await refreshNetwork();
      setFeedback({
        kind: "success",
        message: `${result.registered.length} agent profile(s) refreshed. ${result.manual.length} manual candidate(s) found.`
      });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Discovery failed." });
    } finally {
      setBusy(false);
    }
  };

  const exportNetworkReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      workspaceId: network.workspaceId,
      workspaceName: network.workspaceName,
      stats: network.stats,
      agents: network.agents.map((agent) => ({
        agentId: agent.agentId,
        name: agent.name,
        model: agent.model,
        vendor: agent.vendor,
        status: agent.status,
        domain: agent.domain,
        tools: agent.tools,
        skills: agent.skills,
        connectors: agent.connectors,
        tokens: agent.stats.tokens.totalTokens,
        cost: agent.stats.estimatedCostUsd,
        currentTask: agent.currentTask
      })),
      links: network.links,
      recentEvents: network.events.slice(0, 100)
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `theia-agent-report-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setFeedback({ kind: "success", message: "Agent report exported." });
  };

  const handleMakeLink = async () => {
    if (!selectedAgent || !linkTargetId || !linkScope.trim()) {
      setFeedback({ kind: "error", message: "Select two agents and a task scope." });
      return;
    }
    if (!window.confirm(`Create a collaboration link between ${selectedAgent.name} and ${agentName(network, linkTargetId)}?`)) {
      return;
    }
    setBusy(true);
    try {
      const result = await makeAgentLink({
        sourceAgentId: selectedAgent.agentId,
        targetAgentId: linkTargetId,
        taskScope: linkScope,
        permissions: ["status_reports_only", "shared_task_context"],
        priority: "normal",
        confirmed: true
      });
      setSelectedLinkId(result.link.linkId);
      setLinkScope("");
      await refreshNetwork();
      setFeedback({ kind: "success", message: "Collaboration link created." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Unable to create link." });
    } finally {
      setBusy(false);
    }
  };

  const handleBreakLink = async (link: AgentCommandCenterLink) => {
    if (!window.confirm(`Break collaboration link ${link.linkId}?`)) {
      return;
    }
    setBusy(true);
    try {
      const result = await breakAgentLink(link.linkId, "Operator broke the link from command center.");
      await refreshNetwork();
      setFeedback({ kind: "success", message: result.command.resultSummary ?? "Collaboration link broken." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Unable to break link." });
    } finally {
      setBusy(false);
    }
  };

  const openClawPairingFlow: OpenClawPairingFlowState = {
    pairings: openClawPairings,
    latestPairing: latestOpenClawPairing,
    label: openClawPairingLabel,
    ttlHours: openClawPairingTtlHours,
    busy: openClawPairingBusy,
    error: openClawPairingError,
    onLabelChange: setOpenClawPairingLabel,
    onTtlHoursChange: setOpenClawPairingTtlHours,
    onCreate: handleCreateOpenClawPairing,
    onRefresh: () => void refreshOpenClawPairings(false),
    onRevoke: handleRevokeOpenClawPairing,
    onCopy: copyText
  };

  return (
    <section className="view command-center-view">
      <div className="view-header command-center-header">
        <div>
          <p className="eyebrow">Theia Orchestrator</p>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="header-live-metrics" aria-label="Live command center metrics">
          <span><strong>{network.stats.activeAgents}</strong> active</span>
          <span><strong>{formatNumber(network.stats.tokens.totalTokens)}</strong> tokens</span>
          <span><strong>{network.stats.activeLinks}</strong> links</span>
        </div>
        <div className="action-group">
          <button className="action-btn neutral" disabled={busy} onClick={handleDiscover}>
            Discover
          </button>
          <button className="action-btn neutral" disabled={busy} onClick={refreshNetwork}>
            Refresh
          </button>
        </div>
      </div>

      {feedback ? <p className={`feedback ${feedback.kind}`}>{feedback.message}</p> : null}

      {(mode === "dashboard" || mode === "network") && network.activeGoal ? (
        <ActiveGoalPanel goal={network.activeGoal} agents={network.agents} />
      ) : null}

      {mode === "dashboard" ? (
        <CommandOverview
          network={network}
          selectedAgent={selectedAgent}
          busy={busy}
          onDiscover={handleDiscover}
          onRefresh={refreshNetwork}
          onExport={exportNetworkReport}
          onFocusTogether={() =>
            setFeedback({
              kind: "error",
              message: "Open Network, select two agents, and enter a shared task scope before using Focus Together."
            })
          }
          onSelectAgent={setSelectedAgentId}
        />
      ) : null}

      {mode === "stats" ? (
        <>
          <section className="agent-stat-strip">
            <StatTile label="Active" value={`${network.stats.activeAgents}/${network.stats.totalAgents}`} detail={`${network.stats.activeLinks} live link(s)`} />
            <StatTile label="Tokens" value={formatNumber(network.stats.tokens.totalTokens)} detail={`${formatCurrency(network.stats.estimatedSpendUsd)} estimated`} />
            <StatTile label="RAM" value={formatBytes(network.stats.system.usedRamBytes)} detail={`${formatBytes(network.stats.system.processRamBytes)} core process`} />
            <StatTile label="Runtime" value={formatDuration(network.stats.runtimeMs)} detail={`${network.stats.recentEvents} event(s)`} />
          </section>
          <AgentStatsBreakdown network={network} />
        </>
      ) : null}

      {mode === "network" ? (
        <>
          <section className="command-center-layout">
        <article className="panel network-panel">
          <div className="panel-header-row">
            <div>
              <h3>Live Network</h3>
              <p className="muted-note">{network.stats.totalAgents} agents / {network.stats.activeLinks} active collaboration links</p>
            </div>
            <div className="network-toolbox">
              <button className="icon-btn" type="button" onClick={() => setNetworkZoom((value) => Math.max(0.72, value - 0.1))} aria-label="Zoom out">
                <Minus size={15} />
              </button>
              <button className="icon-btn" type="button" onClick={() => setNetworkZoom((value) => Math.min(1.38, value + 0.1))} aria-label="Zoom in">
                <Plus size={15} />
              </button>
              <button className="icon-btn" type="button" onClick={() => setNetworkZoom(1)} aria-label="Reset zoom">
                <RotateCcw size={15} />
              </button>
              <span className="status-pill promoted">LIVE</span>
            </div>
          </div>
          <AgentNetworkMap
            agents={network.agents}
            links={network.links}
            zoom={networkZoom}
            selectedAgentId={selectedAgent?.agentId}
            selectedLinkId={selectedLinkId}
            onSelectAgent={(agentId) => {
              setSelectedAgentId(agentId);
              setSelectedLinkId(undefined);
            }}
            onSelectLink={setSelectedLinkId}
          />
          <div className="network-action-dock">
            <button className="action-btn neutral" disabled={busy || !selectedAgent} onClick={() => runControl("query")}>
              Query
            </button>
            <button className="action-btn neutral" disabled={busy || !selectedAgent} onClick={() => runControl("steer")}>
              Steer
            </button>
            <button className="action-btn neutral" disabled={busy || !selectedAgent || !linkTargetId || !linkScope.trim()} onClick={handleMakeLink}>
              Link
            </button>
            <button className="action-btn danger" disabled={busy || !selectedAgent?.canEmergencyStop} onClick={() => runControl("emergency_stop")}>
              Stop Agent
            </button>
          </div>
        </article>

        <article className="panel deep-dive-panel">
          {selectedAgent ? (
            <>
              <div className="agent-inspector-hero">
                <span className={`inspector-orb ${selectedAgent.bubbleState}`} />
                <div>
                  <h3>{selectedAgent.name}</h3>
                  <p>{selectedAgent.vendor ?? "Local"} / {selectedAgent.model ?? selectedAgent.connectionKind}</p>
                </div>
                <span className={`agent-state-pill ${selectedAgent.bubbleState}`}>{selectedAgent.status}</span>
              </div>
              <div className="current-task-card">
                <span>Current Task</span>
                <strong>{selectedAgent.currentTask ?? "Standing by"}</strong>
              </div>
              <div className="agent-control-grid">
                <button className="action-btn neutral" disabled={busy} onClick={() => runControl("query")}>
                  Query
                </button>
                <button className="action-btn neutral" disabled={busy} onClick={() => runControl("pause")}>
                  Pause
                </button>
                <button className="action-btn neutral" disabled={busy} onClick={() => runControl("resume")}>
                  Resume
                </button>
                <button className="action-btn danger" disabled={busy || !selectedAgent.canEmergencyStop} onClick={() => runControl("emergency_stop")}>
                  Emergency Stop
                </button>
              </div>
              <label className="field-col">
                <span>Steering</span>
                <textarea value={steeringText} onChange={(event) => setSteeringText(event.target.value)} rows={3} />
              </label>
              <button className="action-btn primary" disabled={busy || !steeringText.trim()} onClick={() => runControl("steer")}>
                Send Steering
              </button>
              <AgentDeepDive agent={selectedAgent} emergencyStopPlan={selectedEmergencyStopPlan} />
            </>
          ) : (
            <p className="muted-note">No registered agents yet.</p>
          )}
        </article>
          </section>
        </>
      ) : null}

      {mode === "cards" ? (
        <>
          <div className="view-toolbar">
            <div>
              <strong>{network.agents.length} registered agent(s)</strong>
              <p className="muted-note">Agent Cards with trust, usage, skills, connectors, memory summary, and controls.</p>
            </div>
            <div className="segmented-control" role="group" aria-label="Agent card view mode">
              <button className={cardViewMode === "grid" ? "active" : ""} type="button" onClick={() => setCardViewMode("grid")}>
                <LayoutGrid size={15} />
                Grid
              </button>
              <button className={cardViewMode === "list" ? "active" : ""} type="button" onClick={() => setCardViewMode("list")}>
                <List size={15} />
                List
              </button>
            </div>
          </div>
          <section className={cardViewMode === "grid" ? "agent-card-deck" : "agent-card-list"} aria-label="Agent card deck">
            {network.agents.map((agent) => (
              <AgentProfileCard
                agent={agent}
                viewMode={cardViewMode}
                expanded={expandedAgentId === agent.agentId}
                selected={agent.agentId === selectedAgent?.agentId}
                onToggleExpanded={() => setExpandedAgentId((current) => (current === agent.agentId ? undefined : agent.agentId))}
                onSelect={() => setSelectedAgentId(agent.agentId)}
                onQuery={() => {
                  setSelectedAgentId(agent.agentId);
                  void runControl("query", {}, agent);
                }}
                onEmergencyStop={() => {
                  setSelectedAgentId(agent.agentId);
                  void runControl("emergency_stop", {}, agent);
                }}
              />
            ))}
          </section>
          {selectedAgent ? (
            <article className="panel cards-deep-dive-panel">
              <div className="panel-header-row">
                <h3>{selectedAgent.name}</h3>
                <span className={`agent-state-pill ${selectedAgent.bubbleState}`}>{selectedAgent.status}</span>
              </div>
              <AgentDeepDive agent={selectedAgent} emergencyStopPlan={selectedEmergencyStopPlan} />
            </article>
          ) : null}
        </>
      ) : null}

      {mode === "activity" ? (
        <ActivityLogView
          events={filteredEvents}
          operatorCards={filteredOperatorCards}
          search={activitySearch}
          filter={activityFilter}
          onSearch={setActivitySearch}
          onFilter={setActivityFilter}
          onSelectAgent={setSelectedAgentId}
        />
      ) : null}

      {mode === "costs" ? (
        <CostsUsageView network={network} monthlyBudget={monthlyBudget} budgetUsage={budgetUsage} modelUsage={modelUsage} onBudgetChange={setMonthlyBudget} />
      ) : null}

      {mode === "security" ? (
        <SecurityAuditView data={data} network={network} settings={safetySettings} onSettingsChange={setSafetySettings} />
      ) : null}

      {mode === "settings" ? (
        <SettingsView
          data={data}
          network={network}
          pairingFlow={openClawPairingFlow}
        />
      ) : null}

      {mode === "help" ? <HelpSupportView /> : null}

      {mode === "network" ? (
      <section className="panel-grid command-utility-grid">
        <article className="panel">
          <h3>Links</h3>
          <div className="link-builder">
            <select value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)}>
              <option value="">Select target</option>
              {otherAgents.map((agent) => (
                <option value={agent.agentId} key={agent.agentId}>
                  {agent.name}
                </option>
              ))}
            </select>
            <input value={linkScope} onChange={(event) => setLinkScope(event.target.value)} placeholder="Task scope" />
            <button className="action-btn primary" disabled={busy} onClick={handleMakeLink}>
              Make Link
            </button>
          </div>
          <div className="link-list">
            {network.links.map((link) => (
              <button
                className={`link-row ${link.linkId === selectedLink?.linkId ? "selected" : ""}`}
                key={link.linkId}
                onClick={() => setSelectedLinkId(link.linkId)}
              >
                <span>{agentName(network, link.sourceAgentId)} to {agentName(network, link.targetAgentId)}</span>
                <strong>{link.status}</strong>
                <small>{link.taskScope}</small>
              </button>
            ))}
          </div>
          {selectedLink ? (
            <div className="link-inspector">
              <p><strong>{selectedLink.priority}</strong> priority / {selectedLink.permissions.join(", ") || "no extra permissions"}</p>
              <p>{selectedLink.taskScope}</p>
              <button className="action-btn danger" disabled={busy} onClick={() => handleBreakLink(selectedLink)}>
                Break Link
              </button>
            </div>
          ) : null}
          <label className="field-col">
            <span>Focus Together</span>
            <textarea value={sharedTask} onChange={(event) => setSharedTask(event.target.value)} rows={2} />
          </label>
          <button className="action-btn primary" disabled={busy || !selectedAgent || !linkTargetId || !sharedTask.trim()} onClick={() => runControl("focus_together")}>
            Focus Together
          </button>
        </article>

        <article className="panel">
          <h3>Add Agent</h3>
          <div className="agent-form-grid">
            <label className="field-col">
              <span>Name</span>
              <input value={agentForm.name} onChange={(event) => setAgentForm({ ...agentForm, name: event.target.value })} />
            </label>
            <label className="field-col">
              <span>Model</span>
              <input value={agentForm.model} onChange={(event) => setAgentForm({ ...agentForm, model: event.target.value })} />
            </label>
            <label className="field-col">
              <span>Vendor</span>
              <input value={agentForm.vendor} onChange={(event) => setAgentForm({ ...agentForm, vendor: event.target.value })} />
            </label>
            <label className="field-col">
              <span>Kind</span>
              <select value={agentForm.connectionKind} onChange={(event) => setAgentForm({ ...agentForm, connectionKind: event.target.value as AgentConnectionKind })}>
                <option value="local">local</option>
                <option value="api">api</option>
                <option value="oauth">oauth</option>
                <option value="openclaw">openclaw</option>
                <option value="octopoda">octopoda</option>
                <option value="mcp">mcp</option>
                <option value="terminal">terminal</option>
                <option value="custom">custom</option>
              </select>
            </label>
            <label className="field-col">
              <span>Domain</span>
              <input value={agentForm.domain} onChange={(event) => setAgentForm({ ...agentForm, domain: event.target.value })} />
            </label>
            <label className="field-col">
              <span>Control</span>
              <select value={agentForm.controlLevel} onChange={(event) => setAgentForm({ ...agentForm, controlLevel: event.target.value as AgentControlLevel })}>
                <option value="observe_only">observe only</option>
                <option value="query">query</option>
                <option value="pause_resume">pause/resume</option>
                <option value="steer">steer</option>
                <option value="stop">stop</option>
                <option value="full">full</option>
              </select>
            </label>
          </div>
          <label className="field-col">
            <span>Tools</span>
            <input value={agentForm.tools} onChange={(event) => setAgentForm({ ...agentForm, tools: event.target.value })} />
          </label>
          <label className="field-col">
            <span>Connectors</span>
            <input value={agentForm.connectors} onChange={(event) => setAgentForm({ ...agentForm, connectors: event.target.value })} />
          </label>
          <label className="field-col">
            <span>Memory/Soul Summary</span>
            <textarea value={agentForm.memorySummary} onChange={(event) => setAgentForm({ ...agentForm, memorySummary: event.target.value })} rows={3} />
          </label>
          <div className="agent-form-checks">
            <label className="field-check">
              <input type="checkbox" checked={agentForm.canCollaborate} onChange={(event) => setAgentForm({ ...agentForm, canCollaborate: event.target.checked })} />
              <span>Collaborate</span>
            </label>
            <label className="field-check">
              <input type="checkbox" checked={agentForm.canEmergencyStop} onChange={(event) => setAgentForm({ ...agentForm, canEmergencyStop: event.target.checked })} />
              <span>Emergency stop</span>
            </label>
          </div>
          <button className="action-btn primary" disabled={busy} onClick={handleRegisterAgent}>
            Register Agent
          </button>
          {latestToken?.token ? (
            <code className="token-block">{latestToken.powershell?.join("\n") ?? `${latestToken.endpoint}\n${latestToken.token}`}</code>
          ) : null}
        </article>

        <ConnectorStrategyPanel
          candidates={connectorCandidates}
          connectors={connectorRegistrations}
          busyId={connectorBusy}
          pairingFlow={openClawPairingFlow}
          telemetry={data.openClawLive.telemetry}
          doctorIssues={network.connectionDoctor}
          onDiscover={handleDiscoverConnectors}
          onConnect={handleConnectConnector}
          onValidate={handleValidateConnector}
          onCopy={copyText}
        />

        <article className="panel">
          <h3>Operator Cards</h3>
          <OperatorCardStack cards={(network.operatorCards?.length ? network.operatorCards : network.events.map(eventToOperatorCard)).slice(0, 6)} onSelectAgent={setSelectedAgentId} compact />
        </article>

        <article className="panel">
          <h3>Discovery Queue</h3>
          {manualDiscoveries.length === 0 ? <p className="muted-note">No manual candidates in this session.</p> : null}
          <div className="card-stack">
            {manualDiscoveries.map((candidate, index) => (
              <article className="compact-card" key={`${candidate.title ?? "candidate"}-${index}`}>
                <p><strong>{String(candidate.title ?? "Candidate")}</strong></p>
                <small>{String(candidate.kind ?? "unknown")} / confidence {String(candidate.confidence ?? "-")}</small>
                <p className="muted-note">{Array.isArray(candidate.paths) ? candidate.paths.join(", ") : String(candidate.path ?? "")}</p>
              </article>
            ))}
          </div>
        </article>
      </section>
      ) : null}
    </section>
  );
}

function ConnectorStrategyPanel({
  candidates,
  connectors,
  busyId,
  pairingFlow,
  telemetry,
  doctorIssues,
  onDiscover,
  onConnect,
  onValidate,
  onCopy
}: {
  candidates: ConnectorDiscoveryCandidate[];
  connectors: ConnectorRegistrationView[];
  busyId?: string;
  pairingFlow: OpenClawPairingFlowState;
  telemetry: DashboardData["openClawLive"]["telemetry"];
  doctorIssues: AgentNetworkSnapshot["connectionDoctor"];
  onDiscover: () => void;
  onConnect: (candidate: ConnectorDiscoveryCandidate) => void;
  onValidate: (connectorId: string) => void;
  onCopy: (text: string, successMessage: string) => void;
}) {
  const rows = candidates.length > 0
    ? candidates
    : connectors.map((connector) => ({
        connectorId: connector.connectorId,
        kind: connector.kind,
        displayName: connector.displayName,
        lane: connector.lane,
        mode: connector.mode,
        endpointLabel: connector.endpointLabel,
        authKind: connector.authKind,
        status: connector.status,
        confidence: connector.status === "healthy" ? 0.94 : 0.62,
        message: connector.message ?? "Connector registered.",
        commands: connector.commands
      }));

  return (
    <article className="panel connector-strategy-panel">
      <div className="panel-header-row">
        <div>
          <h3>Connect Agent</h3>
          <p className="muted-note">Octopoda, OpenClaw skill, MCP, API/OAuth, terminal, or custom JSON telemetry.</p>
        </div>
        <button className="action-btn neutral" disabled={Boolean(busyId)} onClick={onDiscover}>
          <RefreshCw size={15} />
          Discover
        </button>
      </div>
      <OpenClawMagicPairingCard pairingFlow={pairingFlow} telemetry={telemetry} />
      <div className="connector-path-grid">
        {rows.map((candidate) => {
          const registration = connectors.find((connector) => connector.connectorId === candidate.connectorId);
          const live = registration?.status === "healthy";
          const connecting = busyId === candidate.connectorId;
          const commandText = stringifyConnectorCommands(registration?.commands ?? candidate.commands);
          return (
            <article className={`connector-path-card ${candidate.status}`} key={candidate.connectorId}>
              <div className="connector-path-topline">
                <span className="connector-kind-orb">{connectionGlyph(candidate.kind)}</span>
                <div>
                  <strong>{candidate.displayName}</strong>
                  <small>{candidate.lane.toUpperCase()} / {candidate.mode} / {candidate.authKind}</small>
                </div>
                <span className={`agent-state-pill ${live ? "active" : candidate.status === "offline" ? "stopped" : "warning"}`}>
                  {live ? "live" : registration ? registration.status : candidate.status}
                </span>
              </div>
              <p className="muted-note">{registration?.message ?? candidate.message}</p>
              <div className="connector-mini-meta">
                <span>{candidate.endpointLabel ?? "local core"}</span>
                <span>{registration ? "paired" : "not paired"}</span>
              </div>
              <div className="connector-path-actions">
                {registration ? (
                  <button className="action-btn primary" disabled={connecting} onClick={() => onValidate(registration.connectorId)}>
                    <CheckCircle size={15} />
                    {connecting ? "Validating..." : "Validate"}
                  </button>
                ) : (
                  <button className="action-btn primary" disabled={connecting} onClick={() => onConnect(candidate)}>
                    <PlugZap size={15} />
                    {connecting ? "Pairing..." : "Pair"}
                  </button>
                )}
                {commandText ? (
                  <button className="action-btn neutral" disabled={connecting} onClick={() => onCopy(commandText, "Connector command copied.")}>
                    <Copy size={15} />
                    Copy
                  </button>
                ) : null}
              </div>
              {commandText ? <code className="connector-command-preview">{commandText}</code> : null}
            </article>
          );
        })}
        {rows.length === 0 ? (
          <p className="muted-note">Run discovery to generate the customer-facing install, pairing, and validation paths.</p>
        ) : null}
      </div>
      <ConnectionDoctorPanel issues={doctorIssues} onCopy={onCopy} />
    </article>
  );
}

function OpenClawMagicPairingCard({
  pairingFlow,
  telemetry
}: {
  pairingFlow: OpenClawPairingFlowState;
  telemetry: DashboardData["openClawLive"]["telemetry"];
}) {
  const latestCommand = pairingFlow.latestPairing?.commands.powershell.join("\n");
  const activePairings = pairingFlow.pairings.filter((pairing) => pairing.active).length;
  const hasLiveConfirmation = telemetry.requestsAccepted > 0 || telemetry.eventsStored > 0 || pairingFlow.pairings.some((pairing) => Boolean(pairing.lastUsedAt));
  const steps = [
    { label: "Choose OpenClaw", complete: true },
    { label: "Create token", complete: Boolean(pairingFlow.latestPairing) || activePairings > 0 },
    { label: "Copy command", complete: Boolean(pairingFlow.latestPairing) },
    { label: "Live confirmation", complete: hasLiveConfirmation }
  ];

  return (
    <section className="magic-pairing-card" aria-label="OpenClaw pairing flow">
      <div className="magic-pairing-copy">
        <span className="connector-kind-orb">OC</span>
        <div>
          <strong>OpenClaw Pairing</strong>
          <p>Create a tokenized command, paste it into OpenClaw, then watch Theia confirm live telemetry.</p>
        </div>
      </div>
      <div className="pairing-stepper" aria-label="OpenClaw pairing steps">
        {steps.map((step, index) => (
          <span className={step.complete ? "complete" : ""} key={step.label}>
            <i>{step.complete ? <CheckCircle size={13} /> : index + 1}</i>
            {step.label}
          </span>
        ))}
      </div>
      <div className="pairing-form-grid compact">
        <label className="field-col">
          <span>Pairing label</span>
          <input value={pairingFlow.label} onChange={(event) => pairingFlow.onLabelChange(event.target.value)} />
        </label>
        <label className="field-col">
          <span>Token life</span>
          <select value={String(pairingFlow.ttlHours)} onChange={(event) => pairingFlow.onTtlHoursChange(Number(event.target.value))}>
            <option value="1">1 hour</option>
            <option value="8">8 hours</option>
            <option value="24">24 hours</option>
            <option value="72">3 days</option>
            <option value="168">7 days</option>
          </select>
        </label>
      </div>
      <div className="magic-pairing-actions">
        <button className="action-btn primary" type="button" disabled={pairingFlow.busy} onClick={pairingFlow.onCreate}>
          <KeyRound size={15} />
          {pairingFlow.busy ? "Creating..." : "Create Token"}
        </button>
        <button className="action-btn neutral" type="button" disabled={pairingFlow.busy || !latestCommand} onClick={() => latestCommand ? pairingFlow.onCopy(latestCommand, "OpenClaw pairing command copied.") : undefined}>
          <Copy size={15} />
          Copy Command
        </button>
        <button className="action-btn neutral" type="button" disabled={pairingFlow.busy} onClick={pairingFlow.onRefresh}>
          <RefreshCw size={15} />
          Check Live
        </button>
        <span className={`agent-state-pill ${hasLiveConfirmation ? "active" : activePairings > 0 ? "warning" : "idle"}`}>
          {hasLiveConfirmation ? "live" : activePairings > 0 ? "paired" : "ready"}
        </span>
      </div>
      {latestCommand ? <code className="connector-command-preview magic-command">{latestCommand}</code> : null}
      <div className="pairing-health-grid compact">
        <span><strong>{telemetry.requestsAccepted}</strong><small>accepted</small></span>
        <span><strong>{telemetry.requestsRejected}</strong><small>rejected</small></span>
        <span><strong>{telemetry.eventsStored}</strong><small>events</small></span>
      </div>
      {pairingFlow.error ? <p className="pairing-error">{pairingFlow.error}</p> : null}
    </section>
  );
}

function ConnectionDoctorPanel({
  issues,
  onCopy
}: {
  issues: AgentNetworkSnapshot["connectionDoctor"];
  onCopy: (text: string, successMessage: string) => void;
}) {
  const visibleIssues = issues?.length ? issues : [
    {
      issueId: "doctor:all-clear",
      severity: "info" as const,
      title: "Connection Doctor is clear",
      diagnosis: "No failed fetch, token, CORS, port, or connector issues are visible right now.",
      recovery: "Pair an agent or validate a connector to run deeper checks.",
      checks: ["Local core reachable", "Dashboard has a connector path", "Schema validation ready"]
    }
  ];
  return (
    <section className="connection-doctor" aria-label="Connection Doctor">
      <div className="panel-header-row">
        <div>
          <h4>Connection Doctor</h4>
          <p className="muted-note">Specific recovery guidance for failed fetch, bad token, CORS, wrong port, offline service, or missing OpenClaw path.</p>
        </div>
        <span className={`agent-state-pill ${visibleIssues.some((issue) => issue.severity === "critical") ? "warning" : "active"}`}>
          {visibleIssues.length} check(s)
        </span>
      </div>
      <div className="doctor-issue-grid">
        {visibleIssues.map((issue) => (
          <article className={`doctor-issue ${issue.severity}`} key={issue.issueId}>
            <div>
              <strong>{issue.title}</strong>
              <p>{issue.diagnosis}</p>
            </div>
            <small>{issue.recovery}</small>
            <ul>
              {issue.checks.slice(0, 3).map((check) => <li key={check}>{check}</li>)}
            </ul>
            {issue.recoveryCommand ? (
              <button className="action-btn neutral" type="button" onClick={() => onCopy(issue.recoveryCommand!, "Recovery command copied.")}>
                <Copy size={14} />
                Copy fix
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function AgentStatsBreakdown({ network }: { network: AgentNetworkSnapshot }) {
  const octopodaAgents = network.agents.filter((agent) => agent.connectionKind === "octopoda");
  const octopodaRuntimeMs = octopodaAgents.reduce((sum, agent) => sum + agent.stats.runtimeMs, 0);
  const octopodaLogBytes = octopodaAgents.reduce((sum, agent) => sum + agent.stats.logBytes, 0);
  return (
    <section className="panel-grid stats-only-grid">
      <article className="panel">
        <h3>Computing Power Usage</h3>
        <div className="stat-grid-compact">
          <div className="stat-chip"><span>Platform</span><strong>{network.stats.system.platform} / {network.stats.system.arch}</strong></div>
          <div className="stat-chip"><span>CPU Cores</span><strong>{network.stats.system.cpus}</strong></div>
          <div className="stat-chip"><span>System RAM Used</span><strong>{formatBytes(network.stats.system.usedRamBytes)}</strong></div>
          <div className="stat-chip"><span>System RAM Free</span><strong>{formatBytes(network.stats.system.freeRamBytes)}</strong></div>
          <div className="stat-chip"><span>Core Process RAM</span><strong>{formatBytes(network.stats.system.processRamBytes)}</strong></div>
          <div className="stat-chip"><span>System Uptime</span><strong>{formatDuration(network.stats.system.uptimeSeconds * 1000)}</strong></div>
        </div>
      </article>

      <article className="panel">
        <h3>Token And Spend Usage</h3>
        <div className="stat-grid-compact">
          <div className="stat-chip"><span>Input Tokens</span><strong>{formatNumber(network.stats.tokens.inputTokens)}</strong></div>
          <div className="stat-chip"><span>Output Tokens</span><strong>{formatNumber(network.stats.tokens.outputTokens)}</strong></div>
          <div className="stat-chip"><span>Total Tokens</span><strong>{formatNumber(network.stats.tokens.totalTokens)}</strong></div>
          <div className="stat-chip"><span>Estimated Spend</span><strong>{formatCurrency(network.stats.estimatedSpendUsd)}</strong></div>
          <div className="stat-chip"><span>Runtime</span><strong>{formatDuration(network.stats.runtimeMs)}</strong></div>
          <div className="stat-chip"><span>Log Volume</span><strong>{formatBytes(network.stats.logBytes)}</strong></div>
        </div>
      </article>

      {octopodaAgents.length > 0 ? (
        <article className="panel">
          <h3>Octopoda Memory Runtime</h3>
          <div className="stat-grid-compact">
            <div className="stat-chip"><span>Agents Synced</span><strong>{octopodaAgents.length}</strong></div>
            <div className="stat-chip"><span>Runtime Observed</span><strong>{formatDuration(octopodaRuntimeMs)}</strong></div>
            <div className="stat-chip"><span>Memory / Audit Volume</span><strong>{formatBytes(octopodaLogBytes)}</strong></div>
            <div className="stat-chip"><span>Connector Mode</span><strong>{octopodaAgents[0]?.endpointLabel ?? "Octopoda"}</strong></div>
          </div>
        </article>
      ) : null}

      <article className="panel stats-breakdown-wide">
        <h3>Per-Agent Breakdown</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Runtime</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {network.stats.perAgent.map((agent) => (
                <tr key={agent.agentId}>
                  <td>{agent.name}</td>
                  <td>{agent.status}</td>
                  <td>{formatNumber(agent.tokens)}</td>
                  <td>{formatCurrency(agent.estimatedCostUsd)}</td>
                  <td>{formatDuration(agent.runtimeMs)}</td>
                  <td>{Math.round(agent.cpuPercent)}%</td>
                  <td>{formatBytes(agent.ramBytes)}</td>
                  <td>{Math.round(agent.activityScore * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="agent-stat-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ActiveGoalPanel({ goal, agents }: { goal: AgentNetworkSnapshot["activeGoal"]; agents: AgentCommandCenterAgent[] }) {
  const linkedAgents = goal.linkedAgentIds
    .map((agentId) => agents.find((agent) => agent.agentId === agentId)?.name)
    .filter(Boolean);
  return (
    <article className={`panel active-goal-panel ${goal.status}`}>
      <div className="active-goal-main">
        <span className="goal-orb"><Focus size={18} /></span>
        <div>
          <p className="eyebrow">Active Goal Layer</p>
          <h3>{goal.title}</h3>
          <p>{goal.summary}</p>
        </div>
      </div>
      <div className="active-goal-progress">
        <div>
          <strong>{Math.round(goal.progressPercent)}%</strong>
          <span>{goal.currentStep}</span>
        </div>
        <ProgressBar value={goal.progressPercent} />
      </div>
      <div className="goal-policy-grid">
        <span><CheckCircle size={14} /> Minor controls: {goal.minorAutonomyAllowed ? "automatic" : "manual"}</span>
        <span><Shield size={14} /> Major controls: {goal.majorActionRequiresApproval ? "approval required" : "policy automatic"}</span>
        <span><Users size={14} /> {linkedAgents.length ? linkedAgents.join(", ") : "No agents linked yet"}</span>
      </div>
      <div className="goal-criteria-grid">
        {goal.successCriteria.slice(0, 4).map((criterion) => <span key={criterion}>{criterion}</span>)}
      </div>
      {goal.blockers.length > 0 ? (
        <div className="goal-blockers">
          <strong>Needs attention</strong>
          {goal.blockers.slice(0, 3).map((blocker) => <span key={blocker}>{blocker}</span>)}
        </div>
      ) : null}
    </article>
  );
}

function CommandOverview({
  network,
  selectedAgent,
  busy,
  onDiscover,
  onRefresh,
  onExport,
  onFocusTogether,
  onSelectAgent
}: {
  network: AgentNetworkSnapshot;
  selectedAgent?: AgentCommandCenterAgent;
  busy: boolean;
  onDiscover: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onFocusTogether: () => void;
  onSelectAgent: (agentId: string) => void;
}) {
  return (
    <div className="overview-shell">
      <section className="command-metric-grid">
        <MetricCard icon={<Users size={18} />} label="Total Agents" value={String(network.stats.totalAgents)} detail={`${network.stats.activeAgents} active now`} tone="accent" />
        <MetricCard icon={<Activity size={18} />} label="Token Usage" value={formatCompactNumber(network.stats.tokens.totalTokens)} detail={`${formatCurrency(network.stats.estimatedSpendUsd)} estimated`} tone="cyan" />
        <MetricCard icon={<Cpu size={18} />} label="Compute Load" value={`${Math.round(network.stats.system.loadAverage?.[0] ?? 0)}%`} detail={`${formatBytes(network.stats.system.processRamBytes)} core RAM`} tone="violet" />
        <MetricCard icon={<Wallet size={18} />} label="Spend Today" value={formatCurrency(network.stats.estimatedSpendUsd)} detail={`${network.stats.recentEvents} recent events`} tone="warn" />
      </section>

      <section className="overview-grid">
        <article className="panel overview-network-panel">
          <div className="panel-header-row">
            <div>
              <h3>Agent Network</h3>
              <p className="muted-note">Live visualization of your private AI ecosystem.</p>
            </div>
            <span className="status-pill promoted">LIVE</span>
          </div>
          <AgentNetworkMap
            agents={network.agents}
            links={network.links}
            zoom={0.92}
            selectedAgentId={selectedAgent?.agentId}
            onSelectAgent={onSelectAgent}
            onSelectLink={() => undefined}
          />
        </article>

        <aside className="overview-side-stack">
          <QuickActions busy={busy} onDiscover={onDiscover} onRefresh={onRefresh} onExport={onExport} onFocusTogether={onFocusTogether} />
          <MiniActivityFeed events={network.events} onSelectAgent={onSelectAgent} />
        </aside>
      </section>
    </div>
  );
}

function MetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: "accent" | "cyan" | "violet" | "warn" }) {
  return (
    <article className={`command-metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
      <small>{detail}</small>
    </article>
  );
}

function QuickActions({
  busy,
  onDiscover,
  onRefresh,
  onExport,
  onFocusTogether
}: {
  busy: boolean;
  onDiscover: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onFocusTogether: () => void;
}) {
  return (
    <article className="panel quick-actions-panel">
      <h3>Quick Actions</h3>
      <div className="quick-actions-grid">
        <button className="quick-action" type="button" disabled={busy} onClick={onDiscover}>
          <Plus size={16} />
          <strong>Add / Discover</strong>
          <span>Scan for local agents</span>
        </button>
        <button className="quick-action" type="button" disabled={busy} onClick={onFocusTogether}>
          <Focus size={16} />
          <strong>Focus All</strong>
          <span>Align on one task</span>
        </button>
        <button className="quick-action" type="button" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={16} />
          <strong>Refresh</strong>
          <span>Pull latest status</span>
        </button>
        <button className="quick-action" type="button" onClick={onExport}>
          <Download size={16} />
          <strong>Export Report</strong>
          <span>Download activity log</span>
        </button>
      </div>
    </article>
  );
}

function MiniActivityFeed({ events, onSelectAgent }: { events: AgentNetworkSnapshot["events"]; onSelectAgent: (agentId: string) => void }) {
  return (
    <article className="panel mini-activity-panel">
      <div className="panel-header-row">
        <h3>Live Activity</h3>
        <span className="mini-live-dot">Live</span>
      </div>
      <div className="mini-activity-list">
        {events.slice(0, 7).map((event) => (
          <button className="mini-activity-item" key={event.eventId} type="button" onClick={() => onSelectAgent(event.agentId)}>
            <span className={`activity-icon ${event.riskLevel}`}>{eventIcon(event.category)}</span>
            <span>
              <strong>{event.agentName}</strong>
              <small>{event.safeSummary}</small>
            </span>
            <time>{relativeTime(event.timestamp)}</time>
          </button>
        ))}
        {events.length === 0 ? <p className="muted-note">No activity reported yet.</p> : null}
      </div>
    </article>
  );
}

function AgentNetworkMap({
  agents,
  links,
  zoom,
  selectedAgentId,
  selectedLinkId,
  onSelectAgent,
  onSelectLink
}: {
  agents: AgentCommandCenterAgent[];
  links: AgentCommandCenterLink[];
  zoom: number;
  selectedAgentId?: string;
  selectedLinkId?: string;
  onSelectAgent: (agentId: string) => void;
  onSelectLink: (linkId: string) => void;
}) {
  const byId = new Map(agents.map((agent) => [agent.agentId, agent]));

  return (
    <div className="agent-network-map">
      <div className="agent-network-zoom-layer" style={{ transform: `scale(${zoom})` }}>
      <svg className="agent-link-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
        {links.map((link) => {
          const source = byId.get(link.sourceAgentId);
          const target = byId.get(link.targetAgentId);
          if (!source || !target) return null;
          return (
            <g key={link.linkId}>
              <line
                className={`agent-map-link ${link.status} ${selectedLinkId === link.linkId ? "selected" : ""}`}
                x1={source.networkPosition.x}
                y1={source.networkPosition.y}
                x2={target.networkPosition.x}
                y2={target.networkPosition.y}
                onClick={() => onSelectLink(link.linkId)}
              />
              {link.status === "active" ? (
                <circle className="agent-link-pulse" r="0.75">
                  <animateMotion dur="3s" repeatCount="indefinite" path={`M ${source.networkPosition.x},${source.networkPosition.y} L ${target.networkPosition.x},${target.networkPosition.y}`} />
                </circle>
              ) : null}
            </g>
          );
        })}
      </svg>
      {agents.length <= 1 ? (
        <div className="network-placeholder-ring" aria-hidden="true">
          <span className="network-placeholder-node node-openclaw">OPENCLAW</span>
          <span className="network-placeholder-node node-oauth">OAUTH</span>
          <span className="network-placeholder-node node-terminal">TERMINAL</span>
          <span className="network-placeholder-node node-api">API</span>
        </div>
      ) : null}
      {agents.map((agent) => (
        <button
          className={`agent-bubble ${agent.bubbleState} ${selectedAgentId === agent.agentId ? "selected" : ""}`}
          key={agent.agentId}
          style={{
            left: `${agent.networkPosition.x}%`,
            top: `${agent.networkPosition.y}%`,
            width: `${agent.bubbleSize}px`,
            height: `${agent.bubbleSize}px`
          }}
          onClick={() => onSelectAgent(agent.agentId)}
          type="button"
        >
          <strong>{agent.name}</strong>
          <span>{agent.model ?? agent.vendor ?? agent.connectionKind}</span>
          <span>{agent.currentTool ?? agent.currentTarget?.label ?? agent.connectionKind}</span>
          <small>{formatDuration(agent.stats.runtimeMs)}</small>
        </button>
      ))}
      </div>
      <NetworkLegend agents={agents} links={links} />
    </div>
  );
}

function NetworkLegend({ agents, links }: { agents: AgentCommandCenterAgent[]; links: AgentCommandCenterLink[] }) {
  const active = agents.filter((agent) => agent.status === "active").length;
  const collaborating = agents.filter((agent) => agent.status === "collaborating").length;
  const blocked = agents.filter((agent) => agent.status === "blocked" || agent.status === "failed").length;
  return (
    <>
      <div className="network-legend">
        <strong>Status</strong>
        <span><i className="legend-dot active" /> Active</span>
        <span><i className="legend-dot collaborating" /> Collaborating</span>
        <span><i className="legend-dot idle" /> Idle</span>
        <span><i className="legend-dot blocked" /> Blocked</span>
      </div>
      <div className="network-quick-stats">
        <span><strong>{active}</strong><small>Active</small></span>
        <span><strong>{collaborating}</strong><small>Working</small></span>
        <span><strong>{blocked}</strong><small>Blocked</small></span>
        <span><strong>{links.length}</strong><small>Links</small></span>
      </div>
    </>
  );
}

function AgentDeepDive({
  agent,
  emergencyStopPlan
}: {
  agent: AgentCommandCenterAgent;
  emergencyStopPlan?: AgentNetworkSnapshot["emergencyStopPlans"][number];
}) {
  const event = agent.latestEvent;
  return (
    <div className="agent-deep-dive">
      <div className="stat-grid-compact">
        <div className="stat-chip"><span>Model</span><strong>{agent.vendor ?? "-"} {agent.model ?? ""}</strong></div>
        <div className="stat-chip"><span>Tokens</span><strong>{formatNumber(agent.stats.tokens.totalTokens)}</strong></div>
        <div className="stat-chip"><span>Cost</span><strong>{formatCurrency(agent.stats.estimatedCostUsd)}</strong></div>
        <div className="stat-chip"><span>RAM</span><strong>{formatBytes(agent.stats.ramBytes)}</strong></div>
      </div>
      <p className="muted-note">{agent.currentTask ?? agent.soulSummary ?? "No current task reported."}</p>
      {emergencyStopPlan ? (
        <section className="emergency-plan-card">
          <div>
            <strong>Emergency Stop Behavior</strong>
            <p>{emergencyStopPlan.primaryAction}</p>
          </div>
          <small>{emergencyStopPlan.fallbackAction}</small>
          <div className="emergency-plan-tags">
            {emergencyStopPlan.affectedResources.slice(0, 4).map((resource) => <span key={resource}>{resource}</span>)}
          </div>
          <span>{emergencyStopPlan.userReconnectRequired ? "Manual reconnect required" : "Reconnect can resume by policy"}</span>
        </section>
      ) : null}
      {event ? (
        <>
          <h4>Reasoning Summary</h4>
          <ul className="dense-list">
            {event.decisionTrace.length === 0 ? <li>No safe decision trace reported.</li> : event.decisionTrace.slice(0, 5).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <h4>Tool Calls</h4>
          <ul className="dense-list">
            {event.toolCalls.length === 0 ? <li>No tool calls reported.</li> : event.toolCalls.map((tool) => <li key={`${tool.name}-${tool.callId ?? tool.status}`}>{tool.name} / {tool.status}</li>)}
          </ul>
          <div className="deep-dive-columns">
            <MiniList title="Files" values={event.filesAccessed} />
            <MiniList title="Websites" values={event.websitesVisited} />
            <MiniList title="APIs" values={event.apiCalls} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function AgentProfileCard({
  agent,
  viewMode,
  expanded,
  selected,
  onToggleExpanded,
  onSelect,
  onQuery,
  onEmergencyStop
}: {
  agent: AgentCommandCenterAgent;
  viewMode: "grid" | "list";
  expanded: boolean;
  selected: boolean;
  onToggleExpanded: () => void;
  onSelect: () => void;
  onQuery: () => void;
  onEmergencyStop: () => void;
}) {
  const trust = trustPercent(agent.trustLevel);
  if (viewMode === "list") {
    return (
      <article className={`agent-card-row ${selected ? "selected" : ""}`} onClick={onSelect}>
        <span className={`agent-avatar ${agent.bubbleState}`}>{connectionGlyph(agent.connectionKind)}</span>
        <div className="agent-card-main">
          <strong>{agent.name}</strong>
          <small>{agent.role} / {agent.domain}</small>
        </div>
        <span className="agent-card-model">{agent.vendor ?? "Local"} / {agent.model ?? agent.connectionKind}</span>
        <span>{formatCompactNumber(agent.stats.tokens.totalTokens)} tokens</span>
        <span>{formatCurrency(agent.stats.estimatedCostUsd)}</span>
        <span>{formatDuration(agent.stats.runtimeMs)}</span>
        <div className="row-actions">
          <button className="icon-btn" type="button" onClick={(event) => { event.stopPropagation(); onQuery(); }} aria-label={`Query ${agent.name}`}>
            <Eye size={15} />
          </button>
          <button className="icon-btn danger" type="button" onClick={(event) => { event.stopPropagation(); onEmergencyStop(); }} disabled={!agent.canEmergencyStop} aria-label={`Emergency stop ${agent.name}`}>
            <AlertOctagon size={15} />
          </button>
        </div>
      </article>
    );
  }
  return (
    <article className={`agent-card-pro proposal-card ${selected ? "selected" : ""}`}>
      <button className="agent-card-select" type="button" onClick={onSelect}>
        <span className="agent-card-rating">{Math.round(agent.activityScore * 99)}</span>
        <span className="agent-card-vendor">{agent.vendor ?? agent.connectionKind}</span>
        <span className="agent-card-model-name">{agent.model ?? agent.connectionKind}</span>
        <span className={`agent-state-pill ${agent.bubbleState}`}>{agent.status}</span>
        <span className="agent-card-name">{agent.name}</span>
        <span className="agent-card-role">{agent.role} / {agent.domain}</span>
      </button>
      <div className="trust-meter">
        <span><Shield size={13} /> Trust Level</span>
        <strong>{trust}%</strong>
        <ProgressBar value={trust} />
      </div>
      <div className="agent-card-metric-grid">
        <MiniMetric icon={<Cpu size={13} />} value={formatCompactNumber(agent.stats.tokens.totalTokens)} label="Tokens" />
        <MiniMetric icon={<Wallet size={13} />} value={formatCurrency(agent.stats.estimatedCostUsd)} label="Cost" />
        <MiniMetric icon={<Clock size={13} />} value={formatDuration(agent.stats.runtimeMs)} label="Runtime" />
        <MiniMetric icon={<HardDrive size={13} />} value={formatBytes(agent.stats.ramBytes)} label="RAM" />
      </div>
      <div className="agent-card-tags">
        {[...agent.skills, ...agent.connectors].slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
        {[...agent.skills, ...agent.connectors].length === 0 ? <span>No skills registered</span> : null}
      </div>
      <button className="agent-card-more" type="button" onClick={onToggleExpanded}>
        {expanded ? "Less" : "More"}
      </button>
      {expanded ? (
        <div className="agent-card-expanded">
          <strong>Soul Summary</strong>
          <p>{agent.soulSummary ?? agent.memorySummary ?? agent.currentTask ?? "No summary yet."}</p>
          <div className="agent-card-actions">
            <button className="action-btn neutral" type="button" onClick={onQuery}><MessageSquare size={14} /> Query</button>
            <button className="action-btn neutral" type="button" onClick={onSelect}><Navigation size={14} /> Inspect</button>
            <button className="action-btn danger" type="button" onClick={onEmergencyStop} disabled={!agent.canEmergencyStop}><AlertOctagon size={14} /> Stop</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MiniMetric({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <span className="mini-metric">
      {icon}
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function ActivityLogView({
  events,
  operatorCards,
  search,
  filter,
  onSearch,
  onFilter,
  onSelectAgent
}: {
  events: AgentNetworkSnapshot["events"];
  operatorCards: AgentNetworkSnapshot["operatorCards"];
  search: string;
  filter: "all" | "active" | "blocked" | "completed";
  onSearch: (value: string) => void;
  onFilter: (value: "all" | "active" | "blocked" | "completed") => void;
  onSelectAgent: (agentId: string) => void;
}) {
  return (
    <section className="panel activity-log-panel">
      <div className="view-toolbar">
        <div>
          <h3>Operator Cards</h3>
          <p className="muted-note">Each agent event is translated into what happened, why it matters, risk, cost, tool, files, and next action.</p>
        </div>
        <div className="activity-filters">
          <label className="search-field">
            <Search size={15} />
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search activity..." />
          </label>
          <select value={filter} onChange={(event) => onFilter(event.target.value as "all" | "active" | "blocked" | "completed")}>
            <option value="all">All events</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed/idle</option>
          </select>
          <span className="status-pill promoted"><Filter size={12} /> {events.length}</span>
        </div>
      </div>
      <OperatorCardStack cards={operatorCards} onSelectAgent={onSelectAgent} />
    </section>
  );
}

function OperatorCardStack({
  cards,
  onSelectAgent,
  compact = false
}: {
  cards: AgentNetworkSnapshot["operatorCards"];
  onSelectAgent: (agentId: string) => void;
  compact?: boolean;
}) {
  if (cards.length === 0) {
    return <p className="muted-note">No operator cards yet. Pair OpenClaw or register an agent to start the live feed.</p>;
  }
  return (
    <div className={compact ? "operator-card-list compact" : "operator-card-list"}>
      {cards.map((card) => (
        <button className={`operator-card ${card.risk}`} key={card.cardId} type="button" onClick={() => onSelectAgent(card.agentId)}>
          <span className={`activity-icon ${card.risk}`}>{card.risk.slice(0, 3).toUpperCase()}</span>
          <span className="operator-card-copy">
            <span>
              <strong>{card.title}</strong>
              <i className={`event-status ${card.status}`}>{card.status}</i>
            </span>
            <small><b>What happened:</b> {card.whatHappened}</small>
            <small><b>Why it matters:</b> {card.whyItMatters}</small>
            {!compact ? <small><b>Next:</b> {card.nextAction}</small> : null}
          </span>
          <span className="operator-card-meta">
            <strong>{formatCurrency(card.costUsd)}</strong>
            <small>{formatNumber(card.tokens)} tokens</small>
            <small>{card.toolUsed}</small>
            <time>{relativeTime(card.timestamp)}</time>
          </span>
          {!compact && card.filesTouched.length > 0 ? (
            <span className="operator-card-files">
              {card.filesTouched.slice(0, 3).map((file) => <em key={file}>{file}</em>)}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function CostsUsageView({
  network,
  monthlyBudget,
  budgetUsage,
  modelUsage,
  onBudgetChange
}: {
  network: AgentNetworkSnapshot;
  monthlyBudget: number;
  budgetUsage: number;
  modelUsage: Array<{ model: string; vendor: string; tokens: number; cost: number; percentage: number }>;
  onBudgetChange: (value: number) => void;
}) {
  const remaining = Math.max(0, monthlyBudget - network.stats.estimatedSpendUsd);
  return (
    <div className="costs-view">
      <section className="command-metric-grid">
        <MetricCard icon={<Wallet size={18} />} label="Today" value={formatCurrency(network.stats.estimatedSpendUsd)} detail="Estimated API spend" tone="accent" />
        <MetricCard icon={<CircleDollarSign size={18} />} label="Budget Left" value={formatCurrency(remaining)} detail={`${Math.round(budgetUsage)}% used`} tone="warn" />
        <MetricCard icon={<Cpu size={18} />} label="Tokens Today" value={formatCompactNumber(network.stats.tokens.totalTokens)} detail={`${formatCompactNumber(network.stats.tokens.inputTokens)} in / ${formatCompactNumber(network.stats.tokens.outputTokens)} out`} tone="cyan" />
        <MetricCard icon={<Clock size={18} />} label="Runtime" value={formatDuration(network.stats.runtimeMs)} detail={`${network.stats.perAgent.length} measured agents`} tone="violet" />
      </section>
      <article className="panel budget-panel">
        <div className="panel-header-row">
          <div>
            <h3>Monthly Budget</h3>
            <p className="muted-note">Cost warnings are visual until connector-level spending limits are configured.</p>
          </div>
          <label className="budget-input">
            <span>Budget</span>
            <input type="number" min={1} value={monthlyBudget} onChange={(event) => onBudgetChange(Number(event.target.value) || 1)} />
          </label>
        </div>
        <div className="budget-total">
          <strong>{formatCurrency(network.stats.estimatedSpendUsd)}</strong>
          <span>of {formatCurrency(monthlyBudget)}</span>
        </div>
        <ProgressBar value={budgetUsage} />
        <p className="muted-note">{formatCurrency(remaining)} remaining at current measured usage.</p>
      </article>
      <section className="panel-grid two-col">
        <article className="panel">
          <h3>Cost by Agent</h3>
          <div className="usage-list">
            {network.stats.perAgent.map((agent) => (
              <UsageRow key={agent.agentId} label={agent.name} value={formatCurrency(agent.estimatedCostUsd)} detail={`${formatCompactNumber(agent.tokens)} tokens`} percentage={costShare(agent.estimatedCostUsd, network.stats.estimatedSpendUsd)} />
            ))}
          </div>
        </article>
        <article className="panel">
          <h3>Usage by Model</h3>
          <div className="usage-list">
            {modelUsage.map((model) => (
              <UsageRow key={`${model.vendor}-${model.model}`} label={model.model} value={formatCurrency(model.cost)} detail={`${model.vendor} / ${formatCompactNumber(model.tokens)} tokens`} percentage={model.percentage} />
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function UsageRow({ label, value, detail, percentage }: { label: string; value: string; detail: string; percentage: number }) {
  return (
    <div className="usage-row">
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <span>{value}</span>
      <ProgressBar value={percentage} />
    </div>
  );
}

function SecurityAuditView({
  data,
  network,
  settings,
  onSettingsChange
}: {
  data: DashboardData;
  network: AgentNetworkSnapshot;
  settings: {
    steeringConfirmation: boolean;
    emergencyStopLogging: boolean;
    costWarnings: boolean;
    autoReconnect: boolean;
    rawLogAccess: boolean;
  };
  onSettingsChange: (settings: SecurityAuditViewProps["settings"]) => void;
}) {
  const auditRows = [
    ...network.commands.slice(0, 6).map((command) => ({
      action: command.action.replace(/_/g, " "),
      target: command.agentIds.join(", ") || command.linkIds.join(", ") || "agent network",
      actor: command.actorId,
      time: command.createdAt,
      type: command.highRisk ? "critical" : "info"
    })),
    ...data.audit.slice(0, 4).map((row) => ({
      action: row.action,
      target: row.target,
      actor: row.actor,
      time: row.ts,
      type: row.result === "blocked" ? "warning" : "info"
    }))
  ].slice(0, 8);
  return (
    <div className="security-view">
      <section className="command-metric-grid">
        <MetricCard icon={<Shield size={18} />} label="Protection" value={network.stats.stoppedAgents > 0 ? "Controlled" : "Protected"} detail={`${network.stats.totalAgents} agents secured`} tone="accent" />
        <MetricCard icon={<Lock size={18} />} label="Under Control" value={String(network.stats.totalAgents)} detail={`${network.commands.length} commands logged`} tone="cyan" />
        <MetricCard icon={<Bell size={18} />} label="High-Risk Notices" value={String(data.notificationCenter.history.length)} detail={`${data.notificationCenter.slo.failedDeliveryCount24h} failed deliveries`} tone="warn" />
        <MetricCard icon={<Gauge size={18} />} label="Audit Events" value={String(auditRows.length)} detail="Recent command trail" tone="violet" />
      </section>
      <section className="panel-grid two-col">
        <article className="panel">
          <h3>Safety Settings</h3>
          <SwitchRow label="Require confirmation for steering" detail="Ask before sending steering commands" checked={settings.steeringConfirmation} onChange={(value) => onSettingsChange({ ...settings, steeringConfirmation: value })} />
          <SwitchRow label="Emergency stop logging" detail="Log who stopped what, when, and why" checked={settings.emergencyStopLogging} onChange={(value) => onSettingsChange({ ...settings, emergencyStopLogging: value })} />
          <SwitchRow label="Cost warnings" detail="Warn when spending exceeds the threshold" checked={settings.costWarnings} onChange={(value) => onSettingsChange({ ...settings, costWarnings: value })} />
          <SwitchRow label="Auto-reconnect after stop" detail="Disabled by default for safety" checked={settings.autoReconnect} onChange={(value) => onSettingsChange({ ...settings, autoReconnect: value })} />
          <SwitchRow label="Raw log access" detail="Keep raw logs behind an advanced/admin surface" checked={settings.rawLogAccess} onChange={(value) => onSettingsChange({ ...settings, rawLogAccess: value })} />
        </article>
        <article className="panel">
          <div className="panel-header-row">
            <h3>Audit Log</h3>
            <span className="status-pill promoted">Visible</span>
          </div>
          <div className="audit-list">
            {auditRows.map((row, index) => (
              <div className={`audit-row ${row.type}`} key={`${row.action}-${index}`}>
                <span>{row.type === "critical" ? <AlertOctagon size={14} /> : <CheckCircle size={14} />}</span>
                <div>
                  <strong>{row.action}</strong>
                  <small>{row.target} / {row.actor} / {relativeTime(row.time)}</small>
                </div>
              </div>
            ))}
            {auditRows.length === 0 ? <p className="muted-note">No audit rows yet.</p> : null}
          </div>
        </article>
      </section>
    </div>
  );
}

interface SecurityAuditViewProps {
  settings: {
    steeringConfirmation: boolean;
    emergencyStopLogging: boolean;
    costWarnings: boolean;
    autoReconnect: boolean;
    rawLogAccess: boolean;
  };
}

interface OpenClawPairingFlowState {
  pairings: OpenClawPairingView[];
  latestPairing?: {
    pairingId: string;
    label: string;
    expiresAt: string;
    token: string;
    telemetryEndpoint: string;
    streamEndpoint: string;
    commands: OpenClawPairingCommands;
  };
  label: string;
  ttlHours: number;
  busy: boolean;
  error?: string;
  onLabelChange: (value: string) => void;
  onTtlHoursChange: (value: number) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onRevoke: (pairingId: string) => void;
  onCopy: (text: string, successMessage: string) => void;
}

function SettingsView({
  data,
  network,
  pairingFlow
}: {
  data: DashboardData;
  network: AgentNetworkSnapshot;
  pairingFlow: OpenClawPairingFlowState;
}) {
  const vendors = uniq(network.agents.map((agent) => agent.vendor ?? agent.connectionKind));
  const memoryFileCount = uniq(network.agents.flatMap((agent) => agent.stats.memoryFiles)).length;
  return (
    <section className="panel-grid two-col settings-view">
      <article className="panel">
        <h3><Settings size={16} /> General</h3>
        <label className="field-col">
          <span>Dashboard Name</span>
          <input defaultValue={data.workspaceName} />
        </label>
        <label className="field-col">
          <span>Default View</span>
          <input defaultValue="Agent Network" />
        </label>
        <SwitchRow label="Auto-refresh" detail="Update dashboard every 15 seconds" checked onChange={() => undefined} />
      </article>
      <article className="panel">
        <h3><Bell size={16} /> Notifications</h3>
        <SwitchRow label="Agent errors" detail="Notify when agents fail or disconnect" checked onChange={() => undefined} />
        <SwitchRow label="Cost alerts" detail="Alert when estimated spending exceeds limit" checked onChange={() => undefined} />
        <SwitchRow label="Task completions" detail="Notify on major task completions" checked={false} onChange={() => undefined} />
      </article>
      <article className="panel">
        <h3><KeyRound size={16} /> API Connections</h3>
        <div className="connection-list">
          {vendors.map((vendor) => (
            <div className="connection-row" key={vendor}>
              <Zap size={16} />
              <span><strong>{vendor}</strong><small>Registered through agent profile</small></span>
              <i>Connected</i>
            </div>
          ))}
          {vendors.length === 0 ? <p className="muted-note">No API vendors registered yet.</p> : null}
        </div>
        <button className="action-btn neutral" type="button">Add API Key</button>
      </article>
      <OpenClawPairingPanel data={data} pairingFlow={pairingFlow} />
      <article className="panel">
        <h3><HardDrive size={16} /> Data & Storage</h3>
        <div className="settings-storage">
          <span><strong>{formatBytes(network.stats.logBytes)}</strong><small>Activity logs</small></span>
          <span><strong>{memoryFileCount}</strong><small>Memory files</small></span>
          <span><strong>{formatBytes(network.stats.system.processRamBytes)}</strong><small>Local core RAM</small></span>
        </div>
        <p className="muted-note">OpenClaw path: {data.connection.workspacePath ?? "Not configured"}</p>
      </article>
    </section>
  );
}

function OpenClawPairingPanel({
  data,
  pairingFlow
}: {
  data: DashboardData;
  pairingFlow: OpenClawPairingFlowState;
}) {
  const latestCommand = pairingFlow.latestPairing?.commands.powershell.join("\n");
  const activePairings = pairingFlow.pairings.filter((pairing) => pairing.active).length;

  return (
    <article className="panel openclaw-pairing-panel">
      <div className="panel-header-row">
        <div>
          <h3><PlugZap size={16} /> OpenClaw Telemetry Pairing</h3>
          <p className="muted-note">Create a token, paste the command into your OpenClaw terminal, then watch live reports arrive.</p>
        </div>
        <span className="status-pill promoted">{activePairings} active</span>
      </div>

      <div className="pairing-health-grid">
        <span><strong>{data.openClawLive.telemetry.requestsAccepted}</strong><small>accepted</small></span>
        <span><strong>{data.openClawLive.telemetry.requestsRejected}</strong><small>rejected</small></span>
        <span><strong>{data.openClawLive.telemetry.eventsStored}</strong><small>events</small></span>
      </div>

      <div className="pairing-form-grid">
        <label className="field-col">
          <span>Pairing Label</span>
          <input value={pairingFlow.label} onChange={(event) => pairingFlow.onLabelChange(event.target.value)} />
        </label>
        <label className="field-col">
          <span>Token Lifetime</span>
          <select
            value={String(pairingFlow.ttlHours)}
            onChange={(event) => pairingFlow.onTtlHoursChange(Number(event.target.value))}
          >
            <option value="1">1 hour</option>
            <option value="8">8 hours</option>
            <option value="24">24 hours</option>
            <option value="72">3 days</option>
            <option value="168">7 days</option>
          </select>
        </label>
      </div>

      <div className="action-group pairing-actions">
        <button className="action-btn primary" type="button" disabled={pairingFlow.busy} onClick={pairingFlow.onCreate}>
          Create Pairing Token
        </button>
        <button className="action-btn neutral" type="button" disabled={pairingFlow.busy} onClick={pairingFlow.onRefresh}>
          Refresh Pairings
        </button>
      </div>

      {pairingFlow.error ? <p className="pairing-error">{pairingFlow.error}</p> : null}

      {pairingFlow.latestPairing ? (
        <div className="pairing-token-box">
          <div className="panel-header-row">
            <div>
              <strong>{pairingFlow.latestPairing.label}</strong>
              <p className="muted-note">Token visible once. Expires {formatDateTime(pairingFlow.latestPairing.expiresAt)}.</p>
            </div>
            <button
              className="icon-btn"
              type="button"
              aria-label="Copy OpenClaw pairing command"
              onClick={() => pairingFlow.onCopy(latestCommand ?? pairingFlow.latestPairing!.token, "OpenClaw pairing command copied.")}
            >
              <Copy size={15} />
            </button>
          </div>
          <code className="token-block">{latestCommand}</code>
        </div>
      ) : null}

      <div className="pairing-list" aria-label="OpenClaw telemetry pairings">
        {pairingFlow.pairings.length === 0 ? <p className="muted-note">No active OpenClaw telemetry pairings yet.</p> : null}
        {pairingFlow.pairings.map((pairing) => (
          <div className={`pairing-row ${pairing.active ? "active" : "revoked"}`} key={pairing.pairingId}>
            <span>
              <strong>{pairing.label}</strong>
              <small>{pairing.pairingId} / expires {formatDateTime(pairing.expiresAt)}</small>
            </span>
            <i>{pairing.active ? "Active" : "Revoked"}</i>
            <button
              className="icon-btn danger-icon"
              type="button"
              aria-label={`Revoke ${pairing.label}`}
              disabled={pairingFlow.busy || !pairing.active}
              onClick={() => pairingFlow.onRevoke(pairing.pairingId)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </article>
  );
}

function HelpSupportView() {
  const guides = [
    ["Quick Start Guide", "Get the dashboard running and connect your first agent.", Zap],
    ["Adding Agents", "Register local, API, OAuth, terminal, or OpenClaw agents.", Link2],
    ["Security Best Practices", "Use visible links, explicit scope, and emergency stop.", Shield]
  ] as const;
  const faqs = [
    ["How do I add a new agent?", "Use Discover, then register the agent with its model, tools, connectors, control level, and telemetry token."],
    ["What does Emergency Stop do?", "It immediately stops or disconnects the selected agent where the connector allows it, then records an audit event."],
    ["How are costs calculated?", "Costs are estimated from reported tokens, model/vendor metadata, and paid service telemetry."],
    ["Can I inspect chain-of-thought?", "No hidden chain-of-thought is exposed. Theia shows safe reasoning summaries, decisions, tool logs, and explanations."]
  ] as const;
  return (
    <div className="help-view">
      <section className="command-metric-grid">
        <MetricCard icon={<BookOpen size={18} />} label="Documentation" value="Guides" detail="Setup and operations" tone="accent" />
        <MetricCard icon={<MessageSquare size={18} />} label="Support" value="Contact" detail="Help with setup" tone="cyan" />
        <MetricCard icon={<Terminal size={18} />} label="One-Liner" value="Windows" detail="OpenClaw-style install" tone="violet" />
        <MetricCard icon={<HelpCircle size={18} />} label="FAQ" value="4" detail="Common operator questions" tone="warn" />
      </section>
      <section className="panel-grid two-col">
        <article className="panel">
          <h3>Getting Started</h3>
          <div className="guide-list">
            {guides.map(([title, description, Icon]) => (
              <div className="guide-row" key={title}>
                <Icon size={18} />
                <span><strong>{title}</strong><small>{description}</small></span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <h3>Frequently Asked Questions</h3>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <div key={question}>
                <strong>{question}</strong>
                <p>{answer}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
      <article className="panel support-card">
        <HelpCircle size={34} />
        <div>
          <h3>Need more help?</h3>
          <p className="muted-note">Keep this local-first: collect the dashboard URL, local-core logs, and the agent telemetry token status before sharing anything sensitive.</p>
        </div>
      </article>
    </div>
  );
}

function SwitchRow({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="switch-row">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <span className="progress-track" aria-label={`${Math.round(value)} percent`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

function MiniList({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <h4>{title}</h4>
      <ul className="dense-list">
        {values.length === 0 ? <li>-</li> : values.slice(0, 5).map((value) => <li key={value}>{value}</li>)}
      </ul>
    </div>
  );
}

function isAgentNetworkSnapshot(value: unknown): value is AgentNetworkSnapshot {
  return Boolean(value && typeof value === "object" && Array.isArray((value as AgentNetworkSnapshot).agents));
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function agentName(network: AgentNetworkSnapshot, agentId: string): string {
  return network.agents.find((agent) => agent.agentId === agentId)?.name ?? agentId;
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter((value) => value !== undefined && value !== null)));
}

function viewCopy(mode: ViewKey): { title: string; subtitle: string } {
  switch (mode) {
    case "dashboard":
      return {
        title: "Command Overview",
        subtitle: "A clean operating surface for your private agent network, live telemetry, controls, and next actions."
      };
    case "network":
      return {
        title: "Live Agent Network",
        subtitle: "Agent bubbles scale with activity, links show collaboration, and every action stays visible."
      };
    case "stats":
      return {
        title: "Agent Stats",
        subtitle: "Computing power, token usage, memory, runtime, spend, and per-agent breakdowns."
      };
    case "cards":
      return {
        title: "Agent Cards",
        subtitle: "Professional agent cards with model, skills, connectors, trust, memory summary, and controls."
      };
    case "activity":
      return {
        title: "Operator Cards",
        subtitle: "Search and filter useful activity cards without exposing hidden chain-of-thought."
      };
    case "costs":
      return {
        title: "Costs And Usage",
        subtitle: "Track estimated spend, model usage, budgets, tokens, and paid service exposure."
      };
    case "security":
      return {
        title: "Security And Audit",
        subtitle: "Control permissions, emergency-stop posture, audit trails, and high-risk operator actions."
      };
    case "settings":
      return {
        title: "Settings",
        subtitle: "Manage dashboard behavior, notifications, connector posture, and local-first storage."
      };
    case "help":
      return {
        title: "Help And Guides",
        subtitle: "Practical setup notes for one-line install, clone-based setup, OpenClaw agents, and safe operations."
      };
  }
}

function buildModelUsage(network: AgentNetworkSnapshot): Array<{ model: string; vendor: string; tokens: number; cost: number; percentage: number }> {
  const rows = new Map<string, { model: string; vendor: string; tokens: number; cost: number }>();
  for (const agent of network.agents) {
    const model = agent.model ?? agent.connectionKind;
    const vendor = agent.vendor ?? agent.connectionKind;
    const key = `${vendor}:${model}`;
    const current = rows.get(key) ?? { model, vendor, tokens: 0, cost: 0 };
    current.tokens += agent.stats.tokens.totalTokens;
    current.cost += agent.stats.estimatedCostUsd;
    rows.set(key, current);
  }
  const totalTokens = Array.from(rows.values()).reduce((sum, row) => sum + row.tokens, 0);
  return Array.from(rows.values())
    .sort((a, b) => b.tokens - a.tokens)
    .map((row) => ({
      ...row,
      percentage: totalTokens > 0 ? (row.tokens / totalTokens) * 100 : 0
    }));
}

function formatCompactNumber(value: number | undefined): string {
  const amount = Math.round(value ?? 0);
  if (amount < 1000) return amount.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

function relativeTime(value: string | undefined): string {
  if (!value) return "unknown";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "unknown";
  const deltaSeconds = Math.round((Date.now() - timestamp) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  const suffix = deltaSeconds >= 0 ? "ago" : "from now";
  if (absSeconds < 45) return "just now";
  if (absSeconds < 90) return deltaSeconds >= 0 ? "1m ago" : "in 1m";
  const minutes = Math.round(absSeconds / 60);
  if (minutes < 60) return deltaSeconds >= 0 ? `${minutes}m ${suffix}` : `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return deltaSeconds >= 0 ? `${hours}h ${suffix}` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return deltaSeconds >= 0 ? `${days}d ${suffix}` : `in ${days}d`;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function stringifyConnectorCommands(commands: ConnectorRegistrationView["commands"] | undefined): string {
  if (!commands) return "";
  const lines: string[] = [];
  if (commands.install?.length) lines.push(...commands.install);
  if (commands.start?.length) lines.push(...commands.start);
  if (commands.powershell?.length) lines.push(...commands.powershell);
  if (commands.validate?.length) lines.push(...commands.validate);
  if (commands.mcpConfig) lines.push(JSON.stringify(commands.mcpConfig, null, 2));
  return lines.join("\n\n");
}

function eventToOperatorCard(event: AgentNetworkSnapshot["events"][number]): AgentNetworkSnapshot["operatorCards"][number] {
  const costUsd = event.usage.estimatedCostUsd ?? 0;
  const tokens = event.usage.totalTokens ?? (event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0);
  const toolUsed = event.toolCalls[0]?.name ?? event.targets[0]?.label ?? event.apiCalls[0] ?? "No tool reported";
  return {
    cardId: `operator-card:${event.eventId}`,
    eventId: event.eventId,
    agentId: event.agentId,
    agentName: event.agentName,
    timestamp: event.timestamp,
    title: `${event.agentName} ${event.status === "blocked" || event.status === "failed" ? "needs attention" : "reported progress"}`,
    whatHappened: event.safeSummary || event.currentTask || "The agent reported activity.",
    whyItMatters: event.riskLevel === "high" || event.riskLevel === "critical"
      ? "This activity carries elevated risk and may need operator review."
      : event.filesAccessed.length > 0
        ? "The agent touched files, so Theia keeps it visible for audit and rollback context."
        : "This keeps the network understandable without exposing hidden chain-of-thought.",
    risk: event.riskLevel,
    status: event.status,
    costUsd,
    tokens,
    toolUsed,
    filesTouched: event.filesAccessed,
    nextAction: event.status === "blocked" || event.status === "failed"
      ? "Query the agent for a safe explanation."
      : event.riskLevel === "high" || event.riskLevel === "critical"
        ? "Review risk and consider pause or emergency stop."
        : "No action required."
  };
}

function connectorErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Connector request failed.";
  const lowered = message.toLowerCase();
  if (lowered.includes("failed to fetch") || lowered.includes("unable to reach")) {
    return `${message} Connection Doctor: local core or CORS is probably blocking the request. Start with cmd /d /c scripts\\start-theia-dashboard.cmd -OpenClawPath "%USERPROFILE%\\src\\openclaw", then refresh and validate again.`;
  }
  if (lowered.includes("auth") || lowered.includes("401") || lowered.includes("403")) {
    return `${message} Connection Doctor: auth failed. Create a fresh pairing token or set the explicit cloud API key for that connector.`;
  }
  if (lowered.includes("schema") || lowered.includes("invalid")) {
    return `${message} Connection Doctor: the payload did not match agent-activity/v1. Update the adapter or use the reporter helper.`;
  }
  return message;
}

function isConnectionDoctorIssue(error: Error): boolean {
  const lowered = error.message.toLowerCase();
  return lowered.includes("failed to fetch") || lowered.includes("unable to reach") || lowered.includes("cors") || lowered.includes("wrong port");
}

function eventIcon(category: string): string {
  const icons: Record<string, string> = {
    coding: "DEV",
    research: "RSH",
    browsing: "WEB",
    planning: "PLN",
    writing: "TXT",
    design: "DSN",
    finance: "FIN",
    operations: "OPS",
    customer_support: "SUP",
    file_management: "FIL",
    memory_update: "MEM",
    tool_execution: "TLS",
    idle: "IDL",
    blocked: "BLK",
    error: "ERR"
  };
  return icons[category] ?? category.slice(0, 3).toUpperCase();
}

function trustPercent(level: AgentCommandCenterAgent["trustLevel"]): number {
  switch (level) {
    case "trusted":
      return 92;
    case "standard":
      return 74;
    case "restricted":
      return 46;
    case "low":
      return 34;
  }
}

function connectionGlyph(kind: AgentConnectionKind): string {
  switch (kind) {
    case "openclaw":
      return "OC";
    case "octopoda":
      return "OCT";
    case "mcp":
      return "MCP";
    case "terminal":
      return "TM";
    case "oauth":
      return "OA";
    case "api":
      return "API";
    case "local":
      return "LOC";
    case "custom":
      return "CUS";
  }
}

function costShare(cost: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (cost / total) * 100));
}

function formatNumber(value: number | undefined): string {
  return Math.round(value ?? 0).toLocaleString();
}

function formatCurrency(value: number | undefined): string {
  return `$${(value ?? 0).toFixed(2)}`;
}

function formatBytes(value: number | undefined): string {
  const bytes = value ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(ms: number | undefined): string {
  const totalSeconds = Math.round((ms ?? 0) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function labelAction(action: string): string {
  return action.replace(/_/g, " ");
}

function isMajorControlAction(action: string): boolean {
  return ["emergency_stop", "focus_together", "make_link", "break_link"].includes(action);
}

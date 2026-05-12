import {
  agentActivityEventSchema,
  agentControlCommandSchema,
  agentProfileSchema,
  collaborationLinkSchema,
  orchestratorConfigSchema,
  resourceSampleSchema,
  type AgentActivityEvent,
  type AgentControlCommand,
  type AgentProfile,
  type CollaborationLink,
  type OrchestratorConfig,
  type ResourceSample
} from "./schema.js";

export function parseAgentProfile(input: unknown): AgentProfile {
  return agentProfileSchema.parse(input);
}

export function parseAgentActivityEvent(input: unknown): AgentActivityEvent {
  return agentActivityEventSchema.parse(input);
}

export function parseCollaborationLink(input: unknown): CollaborationLink {
  return collaborationLinkSchema.parse(input);
}

export function parseAgentControlCommand(input: unknown): AgentControlCommand {
  return agentControlCommandSchema.parse(input);
}

export function parseResourceSample(input: unknown): ResourceSample {
  return resourceSampleSchema.parse(input);
}

export function parseOrchestratorConfig(input: unknown): OrchestratorConfig {
  return orchestratorConfigSchema.parse(input);
}

export function safeParseAgentActivityEvent(input: unknown) {
  return agentActivityEventSchema.safeParse(input);
}

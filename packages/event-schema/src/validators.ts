import {
  agentSchema,
  auditEntrySchema,
  memoryObjectSchema,
  memoryVersionSchema,
  permissionGrantSchema,
  reasoningAlertSchema,
  runSchema,
  runSnapshotSchema,
  taskSchema,
  userFeedbackSchema,
  workflowEventSchema,
  workspaceSchema,
  type Agent,
  type AuditEntry,
  type MemoryObject,
  type MemoryVersion,
  type PermissionGrant,
  type ReasoningAlert,
  type Run,
  type RunSnapshot,
  type Task,
  type UserFeedback,
  type WorkflowEvent,
  type Workspace
} from "./schema.js";

function parseOrThrow<T>(name: string, schema: { parse: (input: unknown) => T }, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    throw new Error(`Invalid ${name}: ${(error as Error).message}`);
  }
}

export const validators = {
  workspace: (input: unknown): Workspace => parseOrThrow("workspace", workspaceSchema, input),
  agent: (input: unknown): Agent => parseOrThrow("agent", agentSchema, input),
  run: (input: unknown): Run => parseOrThrow("run", runSchema, input),
  task: (input: unknown): Task => parseOrThrow("task", taskSchema, input),
  memoryObject: (input: unknown): MemoryObject => parseOrThrow("memoryObject", memoryObjectSchema, input),
  memoryVersion: (input: unknown): MemoryVersion => parseOrThrow("memoryVersion", memoryVersionSchema, input),
  workflowEvent: (input: unknown): WorkflowEvent => parseOrThrow("workflowEvent", workflowEventSchema, input),
  reasoningAlert: (input: unknown): ReasoningAlert => parseOrThrow("reasoningAlert", reasoningAlertSchema, input),
  userFeedback: (input: unknown): UserFeedback => parseOrThrow("userFeedback", userFeedbackSchema, input),
  permissionGrant: (input: unknown): PermissionGrant => parseOrThrow("permissionGrant", permissionGrantSchema, input),
  auditEntry: (input: unknown): AuditEntry => parseOrThrow("auditEntry", auditEntrySchema, input),
  runSnapshot: (input: unknown): RunSnapshot => parseOrThrow("runSnapshot", runSnapshotSchema, input)
};

export function safeValidate<T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { message: string } } },
  input: unknown
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, data: result.data };
}

export {
  workspaceSchema,
  agentSchema,
  runSchema,
  taskSchema,
  memoryObjectSchema,
  memoryVersionSchema,
  workflowEventSchema,
  reasoningAlertSchema,
  userFeedbackSchema,
  permissionGrantSchema,
  auditEntrySchema,
  runSnapshotSchema
};
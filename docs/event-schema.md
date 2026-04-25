# Event Schema Summary

The canonical event schema standardizes operational records across connectors and agent frameworks.

## Canonical Envelope Fields

- `eventId`
- `workspaceId`
- `agentId`
- `runId`
- `taskId` (optional)
- `eventType`
- `timestamp`
- `payload`
- `source`
- `confidence` (optional)
- `evidenceRefs`

See implementation: `packages/event-schema/src/schema.ts` and JSON schemas under `schemas/`.
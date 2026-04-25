# 6. Memory and Workflow Data Model

## Ingested Sources

- `memory.md`
- `bootstrap.md`
- Run/session events
- Tool calls and outputs
- Task plans and checkpoints
- Authorized prompts and metadata

## Core Entities

- Workspace
- Agent
- Run
- Task
- Memory Object
- Memory Version
- Workflow Event
- Reasoning Alert
- User Feedback
- Permission Grant
- Audit Entry

## Versioning and Provenance

- Memory sections are parsed by heading hierarchy and assigned stable section keys.
- Every memory change creates a hash-addressed version entry.
- Workflow events include source references (connector ID, file path, content hash).
- Decision checkpoints can link evidence references back to source events and memory versions.

## Auditability Rules

- All grants and permission checks are audit-recorded.
- Audit entries use hash chaining (`previousHash` + current payload hash).
- Export workflows should preserve chain integrity for incident review.
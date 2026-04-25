# 5. Core Platform Architecture

## End-to-End Architecture

```mermaid
flowchart LR
  A[Desktop App] --> B[Local Theia Core Service]
  B --> C[Permission Manager]
  B --> D[Connector Runtime]
  D --> E[Authorized Agent Workflows]
  D --> F[Authorized State Files]
  B --> G[Ingestion and Normalization]
  G --> H[Event Store]
  G --> I[Memory Version Store]
  B --> J[Reasoning Evaluation Engine]
  J --> K[Alert Store]
  H --> L[Timeline Builder]
  I --> L
  L --> A
  K --> A
  B --> M[Audit Chain]
  M --> A
  B --> N[Optional Secure Cloud Control Plane]
```

## Components

- Desktop App (`apps/desktop`)
  - Multi-view control center for observability and governance

- Local Core (`apps/local-core`)
  - Ingestion, parsing, normalization, timeline reconstruction, alert evaluation

- Optional Control Plane (`apps/control-plane`)
  - SAML-ready authentication, login-volume tracking, and governance surface bootstrap

- Connector SDK (`packages/connector-sdk`)
  - Capability contracts for safe, permission-scoped connectors

- Event Schema (`packages/event-schema`)
  - Canonical model for agents, runs, tasks, memory, events, alerts, and audit

- Reasoning Engine (`packages/reasoning-engine`)
  - Assistive heuristic framework for likely reasoning quality issues

- Policy Engine (`packages/policy-engine`)
  - RBAC + grants + audit chain for access decisions

## Cross-Platform Recommendation

The architecture remains Tauri-ready for Rust-backed local runtime hardening. In this implementation, the desktop shell is React/Vite for rapid delivery and validation.

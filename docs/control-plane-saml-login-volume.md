# Control Plane SAML and Login Volume Guide

## Scope

The optional control plane (`apps/control-plane`) provides:
- SAML-ready authentication
- Session-aware dashboard access
- Local login-volume observability website
- Public lead ingestion endpoint for website forms
- Authenticated lead inbox with status workflow and CSV export

## Free Provider-Friendly Setup

Recommended environment configuration:

- `THEIA_SAML_METADATA_URL=<IdP metadata URL>`
- `THEIA_SAML_ISSUER=theia-control-plane`
- `THEIA_SAML_CALLBACK_URL=http://localhost:4620/auth/saml/callback`

Alternative direct config:

- `THEIA_SAML_ENTRY_POINT=<idp sso url>`
- `THEIA_SAML_CERT=<x509 cert>`

If SAML is not configured, local dev login is available at `/auth/dev/login` for testing the dashboard and login-volume pipeline.

## Lead Intake API and Inbox

Public endpoint (for website forms):

- `POST /api/public/leads`
- CORS allowlist from: `THEIA_LEADS_ALLOW_ORIGINS`

Authenticated operator endpoints:

- `GET /api/leads/report`
- `GET /api/leads?limit=100&status=new&q=search`
- `POST /api/leads/:leadId/status`
- `GET /api/leads/export.csv`

Suggested local env:

- `THEIA_LEADS_ALLOW_ORIGINS=https://aidaking5a.github.io,http://localhost:5173`
- `THEIA_LEADS_IP_HASH_SALT=<random secret>`

## Local Login Volume Dashboard

Access:
- `http://localhost:4620/dashboard`

Metrics shown:
- total logins
- unique users
- last login timestamp
- daily login volume chart
- recent login event table (authenticated users)

Data storage:
- `apps/control-plane/data/login-events.json` (local-only)
- `apps/control-plane/data/lead-submissions.json` (local-only)

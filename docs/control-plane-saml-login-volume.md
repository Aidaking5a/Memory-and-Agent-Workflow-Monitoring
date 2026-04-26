# Control Plane SAML and Login Volume Guide

## Scope

The optional control plane (`apps/control-plane`) provides:
- SAML-ready authentication
- Session-aware dashboard access
- Local login-volume observability website

## Free Provider-Friendly Setup

Recommended environment configuration:

- `THEIA_SAML_METADATA_URL=<IdP metadata URL>`
- `THEIA_SAML_ISSUER=theia-control-plane`
- `THEIA_SAML_CALLBACK_URL=http://localhost:4620/auth/saml/callback`

Alternative direct config:

- `THEIA_SAML_ENTRY_POINT=<idp sso url>`
- `THEIA_SAML_CERT=<x509 cert>`

If SAML is not configured, local dev login is available at `/auth/dev/login` for testing the dashboard and login-volume pipeline.

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
# Keycloak SAML Quickstart (Free, Local)

This project includes a preconfigured local IdP using Keycloak.

## What this gives you

- local IdP (realm: `theia`)
- SAML client precreated (`theia-control-plane`)
- test login user (`theia.user` / `TheiaPass123!`)
- metadata URL for Theia:
  - `http://localhost:8080/realms/theia/protocol/saml/descriptor`

## 1. Start Keycloak

```powershell
cd "C:\Users\admin_1\Documents\feature _ship"
.\scripts\start-keycloak.ps1
```

First run can take 2-6 minutes while Keycloak initializes.

## 2. Set persistent local SAML env vars (recommended)

```powershell
pnpm run setup:local
```

This stores SAML/local-dev variables in your Windows user profile so you do not need to re-export them every terminal session.

## 3. Start Theia stack (one command)

```powershell
pnpm run dev:stack
```

Or double-click:

- `scripts/start-theia-dev.cmd`

The `.cmd` launcher applies a process-scoped PowerShell execution-policy bypass automatically, so global policy changes are not required.

## 4. Optional: transient env vars (same terminal where control-plane runs)

```powershell
.\scripts\set-theia-saml-env.ps1
pnpm.cmd --filter "@theia/control-plane" run dev
```

## 5. Test SAML login

- Open: `http://localhost:4620/auth/saml/login`
- Login with:
  - username: `theia.user`
  - password: `TheiaPass123!`
- You should be redirected to `/dashboard`.

## Notes

- Keycloak admin console: `http://localhost:8080/admin`
- Admin credentials: `admin` / `admin`
- Realm import file: `infra/keycloak/theia-realm.json`

# Desktop Installer Playbook

This playbook covers local and CI generation of Theia desktop installers.

## Scope

- Windows installer: NSIS `.exe`
- macOS installer: `.dmg`

## Local Build Commands

From repository root:

```powershell
pnpm install
pnpm run build:desktop:installer:win
```

macOS host:

```bash
pnpm install
pnpm run build:desktop:installer:mac
```

Generated files:

- `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`
- `apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`

## GitHub Actions Build

Workflow:

- `.github/workflows/desktop-installers.yml`

How to run:

1. Open repository `Actions` tab.
2. Select `Desktop Installers`.
3. Click `Run workflow`.
4. Download artifacts from the run summary.

Automatic release attachment:

- When you push a tag like `v0.1.0`, installers are attached to that GitHub release.

## Trust Hardening Checklist (Next)

- Add Windows code-signing certificate for installer signing.
- Add Apple Developer signing identity.
- Add Apple notarization for `.dmg`.
- Publish checksums (`sha256`) for each installer artifact.
- Document SBOM generation for release bundles.

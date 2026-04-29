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

If `link.exe` is missing, run auto-setup:

```powershell
pnpm run build:desktop:installer:win:auto-setup
```

The auto-setup flow installs Visual Studio Build Tools 2022 with C++ tools and reloads the MSVC environment for the build.

macOS host:

```bash
pnpm install
pnpm run build:desktop:installer:mac
```

Generated files:

- `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`
- `apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`

## Windows Prerequisites

- Rust toolchain (`rustup`)
- Visual Studio Build Tools 2022 with `Microsoft.VisualStudio.Workload.VCTools`

If you prefer manual install:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --accept-package-agreements --accept-source-agreements --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

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

[CmdletBinding()]
param(
  [switch]$SkipKeycloak,
  [switch]$SkipCore,
  [switch]$SkipControlPlane,
  [switch]$SkipDesktop,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

function Get-PnpmCommand {
  if (Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue) {
    return "pnpm.cmd"
  }
  if (Get-Command "pnpm" -ErrorAction SilentlyContinue) {
    return "pnpm"
  }
  throw "pnpm is not installed or not on PATH."
}

function Start-DevWindow {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [string]$CommandLine
  )

  Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd /d ""$ProjectRoot"" && $CommandLine" | Out-Null
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$pnpmCommand = Get-PnpmCommand

Write-Host "Project root: $projectRoot"
Write-Host "Applying local Theia environment defaults..."
& "$PSScriptRoot\configure-theia-local-env.ps1"

if (-not $SkipKeycloak) {
  if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    throw "Docker is required to run local Keycloak. Install Docker Desktop or use -SkipKeycloak."
  }

  Write-Host "Ensuring local Keycloak is running..."
  & "$PSScriptRoot\ensure-keycloak.ps1"
}

if (-not $SkipCore) {
  Write-Host "Starting Theia local core..."
  Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand --filter ""@theia/local-core"" run dev"
}

if (-not $SkipControlPlane) {
  Write-Host "Starting Theia control plane..."
  Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand --filter ""@theia/control-plane"" run dev"
}

if (-not $SkipDesktop) {
  Write-Host "Starting Theia desktop dashboard..."
  Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand --filter ""@theia/desktop"" run dev"
}

if (-not $NoBrowser) {
  Start-Sleep -Seconds 2
  if (-not $SkipDesktop) {
    Start-Process "http://localhost:5173" | Out-Null
  }
  if (-not $SkipControlPlane) {
    Start-Process "http://localhost:4620/dashboard" | Out-Null
  }
}

Write-Host "Theia local dev stack launch complete."
Write-Host "Core API: http://localhost:4318"
Write-Host "Control Plane: http://localhost:4620/dashboard"
Write-Host "Desktop: http://localhost:5173"

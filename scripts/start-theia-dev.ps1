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

function Wait-LocalPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
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
  if (Wait-LocalPort -Port 4318 -TimeoutSeconds 1) {
    Write-Host "Theia local core already running on port 4318."
  } else {
    Write-Host "Starting Theia local core..."
    Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand --filter ""@theia/local-core"" run dev"
  }
}

if (-not $SkipControlPlane) {
  if (Wait-LocalPort -Port 4620 -TimeoutSeconds 1) {
    Write-Host "Theia control plane already running on port 4620."
  } else {
    Write-Host "Starting Theia control plane..."
    Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand --filter ""@theia/control-plane"" run dev"
  }
}

if (-not $SkipDesktop) {
  if (Wait-LocalPort -Port 5173 -TimeoutSeconds 1) {
    Write-Host "Theia desktop dashboard already running on port 5173."
  } else {
    Write-Host "Starting Theia desktop dashboard..."
    Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand --filter ""@theia/desktop"" run dev"
  }
}

if (-not $NoBrowser) {
  if (-not $SkipDesktop) {
    if (Wait-LocalPort -Port 5173 -TimeoutSeconds 25) {
      Start-Process "http://localhost:5173" | Out-Null
    } else {
      Write-Warning "Desktop UI was not detected on port 5173. Check the desktop window for startup errors."
    }
  }
  if (-not $SkipControlPlane) {
    if (Wait-LocalPort -Port 4620 -TimeoutSeconds 25) {
      Start-Process "http://localhost:4620/dashboard" | Out-Null
    } else {
      Write-Warning "Control plane was not detected on port 4620. Check the control-plane window for startup errors."
    }
  }
}

Write-Host "Theia local dev stack launch complete."
Write-Host "Core API: http://localhost:4318"
Write-Host "Control Plane: http://localhost:4620/dashboard"
Write-Host "Desktop: http://localhost:5173"

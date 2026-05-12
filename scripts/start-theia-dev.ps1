[CmdletBinding()]
param(
  [switch]$SkipKeycloak,
  [switch]$SkipCore,
  [switch]$SkipControlPlane,
  [switch]$SkipDesktop,
  [switch]$SkipWebsite,
  [switch]$NoBrowser,
  [switch]$ForceDesktopPort,
  [string]$OpenClawPath = ""
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

function Wait-HttpReady {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSeconds = 70
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 6 -ErrorAction Stop
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      # continue waiting
    }
    Start-Sleep -Milliseconds 800
  }
  return $false
}

function Get-PortOwner {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) {
    return $null
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $process) {
    return [PSCustomObject]@{
      ProcessId = $listener.OwningProcess
      Name = "unknown"
      CommandLine = ""
    }
  }

  return [PSCustomObject]@{
    ProcessId = $process.ProcessId
    Name = $process.Name
    CommandLine = $process.CommandLine
  }
}

function Is-TheiaDesktopProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [PSCustomObject]$Owner
  )

  $commandLine = [string]$Owner.CommandLine
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }

  return $commandLine -like "*$ProjectRoot*apps\\desktop*" -and $commandLine -like "*vite*"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$pnpmCommand = Get-PnpmCommand

Write-Host "Project root: $projectRoot"
Write-Host "Applying local Theia environment defaults..."
if ([string]::IsNullOrWhiteSpace($OpenClawPath)) {
  & "$PSScriptRoot\configure-theia-local-env.ps1"
} else {
  & "$PSScriptRoot\configure-theia-local-env.ps1" -OpenClawPath $OpenClawPath
}

if (-not $SkipKeycloak) {
  if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    throw "Docker is required to run local Keycloak. Install Docker Desktop or use -SkipKeycloak."
  }

  Write-Host "Ensuring local Keycloak is running..."
  & "$PSScriptRoot\ensure-keycloak.ps1"

  $metadataUrl = [Environment]::GetEnvironmentVariable("THEIA_SAML_METADATA_URL")
  if ([string]::IsNullOrWhiteSpace($metadataUrl)) {
    $metadataUrl = "http://localhost:8080/realms/theia/protocol/saml/descriptor"
  }

  if (Wait-HttpReady -Url $metadataUrl -TimeoutSeconds 75) {
    Write-Host "Keycloak metadata endpoint is reachable: $metadataUrl"
  } else {
    Write-Warning "Keycloak metadata endpoint did not become reachable in time: $metadataUrl"
    Write-Warning "Control-plane may start with SAML temporarily disabled until restart."
  }
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
  $desktopOwner = Get-PortOwner -Port 5173
  if ($desktopOwner) {
    if (Is-TheiaDesktopProcess -ProjectRoot $projectRoot -Owner $desktopOwner) {
      Write-Host "Theia desktop dashboard already running on port 5173 (PID $($desktopOwner.ProcessId))."
    } elseif ($ForceDesktopPort) {
      Write-Warning "Port 5173 is owned by PID $($desktopOwner.ProcessId) ($($desktopOwner.Name)). Reclaiming for Theia desktop."
      Stop-Process -Id $desktopOwner.ProcessId -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
      Write-Host "Starting Theia desktop dashboard..."
      Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand --filter ""@theia/desktop"" run dev"
    } else {
      Write-Warning "Port 5173 is currently owned by PID $($desktopOwner.ProcessId) ($($desktopOwner.Name))."
      Write-Warning "Run with -ForceDesktopPort to reclaim 5173 for Theia."
    }
  } else {
    Write-Host "Starting Theia desktop dashboard..."
    Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand --filter ""@theia/desktop"" run dev"
  }
}

if (-not $SkipWebsite) {
  if (Wait-LocalPort -Port 4173 -TimeoutSeconds 1) {
    Write-Host "Theia website already running on port 4173."
  } else {
    Write-Host "Starting Theia website server..."
    Start-DevWindow -ProjectRoot $projectRoot -CommandLine "$pnpmCommand run dev:website"
  }
}

if (-not $NoBrowser) {
  if (-not $SkipDesktop) {
    if (Wait-LocalPort -Port 5173 -TimeoutSeconds 25) {
      $desktopOwner = Get-PortOwner -Port 5173
      if ($desktopOwner -and (Is-TheiaDesktopProcess -ProjectRoot $projectRoot -Owner $desktopOwner)) {
        Start-Process "http://localhost:5173" | Out-Null
      } else {
        Write-Warning "Port 5173 is live but does not appear to be Theia desktop. Browser auto-open skipped."
      }
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
  if (-not $SkipWebsite) {
    if (Wait-LocalPort -Port 4173 -TimeoutSeconds 25) {
      Start-Process "http://localhost:4173" | Out-Null
    } else {
      Write-Warning "Website server was not detected on port 4173. Check the website window for startup errors."
    }
  }
}

Write-Host "Theia local dev stack launch complete."
Write-Host "Core API: http://localhost:4318"
Write-Host "Control Plane: http://localhost:4620/dashboard"
Write-Host "Desktop: http://localhost:5173"
Write-Host "Website: http://localhost:4173"

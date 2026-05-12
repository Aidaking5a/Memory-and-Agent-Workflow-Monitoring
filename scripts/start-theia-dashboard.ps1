[CmdletBinding()]
param(
  [int]$CorePort = 4318,
  [int]$DashboardPort = 5173,
  [switch]$NoBrowser,
  [switch]$ForceDashboardPort,
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

function Test-LocalPort {
  param([Parameter(Mandatory = $true)][int]$Port)
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-PortOwner {
  param([Parameter(Mandatory = $true)][int]$Port)
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) {
    return $null
  }
  return Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
}

function Wait-LocalPort {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutSeconds = 30
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPort -Port $Port) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Start-HiddenCommand {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$CommandLine,
    [Parameter(Mandatory = $true)][string]$LogPath
  )
  $args = "/c cd /d `"$ProjectRoot`" && $CommandLine > `"$LogPath`" 2>&1"
  Start-Process -FilePath "cmd.exe" -ArgumentList $args -WindowStyle Hidden | Out-Null
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$pnpmCommand = Get-PnpmCommand
$logDir = Join-Path $projectRoot ".theia\dev-logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
if ([string]::IsNullOrWhiteSpace($OpenClawPath)) {
  $OpenClawPath = Join-Path $env:USERPROFILE "src\openclaw"
}
$resolvedOpenClawPath = [System.IO.Path]::GetFullPath($OpenClawPath)
$approvedPaths = $projectRoot
if (Test-Path -LiteralPath $resolvedOpenClawPath) {
  $approvedPaths = "$projectRoot,$resolvedOpenClawPath"
}
$allowedOrigins = "http://localhost:$DashboardPort,http://127.0.0.1:$DashboardPort,http://localhost:4173,http://127.0.0.1:4173"
$coreEnvPrefix = "set `"THEIA_CORE_PORT=$CorePort`"&& set `"THEIA_ALLOWED_ORIGINS=$allowedOrigins`"&& set `"THEIA_OPENCLAW_WORKSPACE_PATH=$resolvedOpenClawPath`"&& set `"THEIA_OPENCLAW_DISCOVERY_PATHS=$resolvedOpenClawPath`"&& set `"THEIA_APPROVED_PATHS=$approvedPaths`"&& "
if (Test-Path -LiteralPath $resolvedOpenClawPath) {
  $coreEnvPrefix += "set `"THEIA_OPENCLAW_LOG_SOURCES=$resolvedOpenClawPath`"&& "
}

Write-Host "Theia dashboard one-liner"
Write-Host "Project root: $projectRoot"
Write-Host "OpenClaw path: $resolvedOpenClawPath"
Write-Host "Allowed dashboard origins: $allowedOrigins"
Write-Host "Logs: $logDir"

if (-not (Test-LocalPort -Port $CorePort)) {
  Write-Host "Starting local-core on port $CorePort..."
  $coreLog = Join-Path $logDir "dashboard-local-core.log"
  Start-HiddenCommand -ProjectRoot $projectRoot -LogPath $coreLog -CommandLine "$coreEnvPrefix$pnpmCommand --filter @theia/local-core run dev"
} else {
  Write-Host "local-core is already listening on port $CorePort."
}

$desktopOwner = Get-PortOwner -Port $DashboardPort
if ($desktopOwner) {
  $commandLine = [string]$desktopOwner.CommandLine
  $looksLikeTheia = $commandLine -like "*$projectRoot*" -and (
    $commandLine -like "*@theia/desktop*" -or
    ($commandLine -like "*apps\desktop*" -and $commandLine -like "*vite*")
  )
  if ($looksLikeTheia) {
    Write-Host "Dashboard is already listening on port $DashboardPort."
  } elseif ($ForceDashboardPort) {
    Write-Warning "Stopping process $($desktopOwner.ProcessId) to reclaim dashboard port $DashboardPort."
    Stop-Process -Id $desktopOwner.ProcessId -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 600
  } else {
    throw "Port $DashboardPort is already in use by PID $($desktopOwner.ProcessId). Rerun with -ForceDashboardPort or choose another -DashboardPort."
  }
}

if (-not (Test-LocalPort -Port $DashboardPort)) {
  Write-Host "Starting desktop dashboard on port $DashboardPort..."
  $desktopLog = Join-Path $logDir "dashboard-vite.log"
  Start-HiddenCommand -ProjectRoot $projectRoot -LogPath $desktopLog -CommandLine "set VITE_THEIA_CORE_URL=http://localhost:$CorePort&& $pnpmCommand --filter @theia/desktop run dev -- --host 127.0.0.1 --port $DashboardPort"
}

$coreReady = Wait-LocalPort -Port $CorePort -TimeoutSeconds 35
$dashboardReady = Wait-LocalPort -Port $DashboardPort -TimeoutSeconds 35

Write-Host ""
Write-Host "Dashboard infrastructure:"
Write-Host "  Local core: http://localhost:$CorePort ($coreReady)"
Write-Host "  Dashboard:  http://localhost:$DashboardPort ($dashboardReady)"
Write-Host "  Stop:       pnpm.cmd run dev:stop"

if ($dashboardReady -and -not $NoBrowser) {
  Start-Process "http://localhost:$DashboardPort" | Out-Null
}

if (-not ($coreReady -and $dashboardReady)) {
  exit 1
}

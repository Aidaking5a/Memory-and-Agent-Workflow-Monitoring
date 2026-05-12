[CmdletBinding()]
param(
  [int]$Port = 4173,
  [switch]$NoBrowser,
  [switch]$ForcePort
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

function Wait-HttpReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSeconds = 25
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 -ErrorAction Stop
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
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
$siteRoot = Join-Path $projectRoot "website\site"
if (-not (Test-Path (Join-Path $siteRoot "index.html"))) {
  throw "Marketing site root is missing: $siteRoot"
}

$pnpmCommand = Get-PnpmCommand
$logDir = Join-Path $projectRoot ".theia\dev-logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

Write-Host "Theia marketing site one-liner"
Write-Host "Project root: $projectRoot"
Write-Host "Site root: $siteRoot"
Write-Host "Logs: $logDir"

$owner = Get-PortOwner -Port $Port
if ($owner) {
  $commandLine = [string]$owner.CommandLine
  $looksLikeTheiaWebsite = $commandLine -like "*$projectRoot*" -and ($commandLine -like "*serve-website.mjs*" -or $commandLine -like "*dev:website*")
  if ($looksLikeTheiaWebsite) {
    Write-Host "Marketing site is already listening on port $Port."
  } elseif ($ForcePort) {
    Write-Warning "Stopping process $($owner.ProcessId) to reclaim marketing site port $Port."
    Stop-Process -Id $owner.ProcessId -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 600
  } else {
    throw "Port $Port is already in use by PID $($owner.ProcessId). Rerun with -ForcePort or choose another -Port."
  }
}

if (-not (Test-LocalPort -Port $Port)) {
  Write-Host "Starting marketing site on port $Port..."
  $websiteLog = Join-Path $logDir "marketing-site.log"
  Start-HiddenCommand -ProjectRoot $projectRoot -LogPath $websiteLog -CommandLine "set THEIA_WEBSITE_PORT=$Port&& $pnpmCommand run dev:website"
}

$url = "http://localhost:$Port"
$ready = Wait-HttpReady -Url $url -TimeoutSeconds 30

Write-Host ""
Write-Host "Marketing site infrastructure:"
Write-Host "  Website: $url ($ready)"
Write-Host "  Home:    $url/"
Write-Host "  Contact: $url/contact.html"
Write-Host "  Stop:    pnpm.cmd run dev:stop"

if ($ready -and -not $NoBrowser) {
  Start-Process $url | Out-Null
}

if (-not $ready) {
  exit 1
}

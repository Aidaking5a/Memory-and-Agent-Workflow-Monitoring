[CmdletBinding()]
param(
  [switch]$LeaveKeycloakRunning
)

$ErrorActionPreference = "Continue"

function Stop-ByPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $listeners) {
    Write-Host "$Name is not listening on port $Port."
    return
  }

  $processIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $processIds) {
    if ($procId -eq $PID) {
      continue
    }
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Host "Stopped $Name process id $procId (port $Port)."
    } catch {
      Write-Host "Failed to stop process id $procId for $Name on port $Port."
    }
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot

function Stop-ProjectProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string[]]$CommandPatterns
  )

  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $commandLine = [string]$_.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine) -or $commandLine -notlike "*$projectRoot*") {
      return $false
    }
    foreach ($pattern in $CommandPatterns) {
      if ($commandLine -like $pattern) {
        return $true
      }
    }
    return $false
  }

  foreach ($process in $processes) {
    if ($process.ProcessId -eq $PID) {
      continue
    }
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-Host "Stopped orphan $Name process id $($process.ProcessId)."
    } catch {
      Write-Host "Failed to stop orphan $Name process id $($process.ProcessId)."
    }
  }
}

Stop-ByPort -Port 4318 -Name "Theia local core"
Stop-ByPort -Port 4620 -Name "Theia control plane"
Stop-ByPort -Port 5173 -Name "Theia desktop"
Stop-ByPort -Port 4173 -Name "Theia website"

Stop-ProjectProcess -Name "Theia local core" -CommandPatterns @("*@theia/local-core*", "*tsx*watch*src/index.ts*")
Stop-ProjectProcess -Name "Theia desktop" -CommandPatterns @("*@theia/desktop*", "*apps\desktop*")
Stop-ProjectProcess -Name "Theia website" -CommandPatterns @("*serve-website.mjs*", "*dev:website*")

if (-not $LeaveKeycloakRunning) {
  $running = docker ps --format "{{.Names}}" 2>$null | Select-String -SimpleMatch "theia-keycloak"
  if ($running) {
    docker stop theia-keycloak | Out-Null
    Write-Host "Stopped Docker container: theia-keycloak"
  } else {
    Write-Host "Docker container theia-keycloak is not running."
  }
}

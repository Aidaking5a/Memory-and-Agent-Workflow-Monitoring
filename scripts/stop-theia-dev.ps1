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

Stop-ByPort -Port 4318 -Name "Theia local core"
Stop-ByPort -Port 4620 -Name "Theia control plane"
Stop-ByPort -Port 5173 -Name "Theia desktop"

if (-not $LeaveKeycloakRunning) {
  $running = docker ps --format "{{.Names}}" 2>$null | Select-String -SimpleMatch "theia-keycloak"
  if ($running) {
    docker stop theia-keycloak | Out-Null
    Write-Host "Stopped Docker container: theia-keycloak"
  } else {
    Write-Host "Docker container theia-keycloak is not running."
  }
}

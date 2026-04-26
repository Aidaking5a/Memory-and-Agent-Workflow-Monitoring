param(
  [string]$ContainerName = "theia-keycloak"
)

function Wait-KeycloakReady {
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = Invoke-WebRequest -Uri "http://localhost:8080/realms/theia/.well-known/openid-configuration" -UseBasicParsing -TimeoutSec 3
      if ($health.StatusCode -eq 200) {
        return $true
      }
    } catch {
    }

    $logs = docker logs --tail 50 $ContainerName 2>$null
    if ($logs -match "Listening on: http://0.0.0.0:8080") {
      return $true
    }
  }
  return $false
}

$running = docker ps --format "{{.Names}}" | Select-String -SimpleMatch $ContainerName
if ($running) {
  Write-Host "Keycloak container already running: $ContainerName"
  if (Wait-KeycloakReady) {
    Write-Host "Keycloak is ready."
    exit 0
  }
  Write-Host "Keycloak running but readiness check failed."
  exit 1
}

$existing = docker ps -a --format "{{.Names}}" | Select-String -SimpleMatch $ContainerName
if ($existing) {
  Write-Host "Starting existing Keycloak container: $ContainerName"
  docker start $ContainerName | Out-Null
  if (Wait-KeycloakReady) {
    Write-Host "Keycloak is ready."
    exit 0
  }
  Write-Host "Keycloak failed readiness after start."
  exit 1
}

Write-Host "Keycloak container not found. Bootstrapping new container..."
& "$PSScriptRoot\start-keycloak.ps1"
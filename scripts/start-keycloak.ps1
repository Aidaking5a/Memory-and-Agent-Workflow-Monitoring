param(
  [string]$ContainerName = "theia-keycloak",
  [string]$Image = "quay.io/keycloak/keycloak:26.1"
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$importPath = Join-Path $projectRoot "infra\keycloak"

Write-Host "Using import path: $importPath"

$exists = docker ps -a --format "{{.Names}}" | Select-String -SimpleMatch $ContainerName
if ($exists) {
  Write-Host "Removing existing container: $ContainerName"
  docker rm -f $ContainerName | Out-Null
}

Write-Host "Starting Keycloak container..."
docker run -d `
  --name $ContainerName `
  -p 8080:8080 `
  -e KEYCLOAK_ADMIN=admin `
  -e KEYCLOAK_ADMIN_PASSWORD=admin `
  -v "${importPath}:/opt/keycloak/data/import" `
  $Image `
  start-dev --import-realm | Out-Null

Write-Host "Waiting for Keycloak to be ready (this can take a few minutes on first run)..."
for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Seconds 2

  try {
    $health = Invoke-WebRequest -Uri "http://localhost:8080/realms/theia/.well-known/openid-configuration" -UseBasicParsing -TimeoutSec 4
    if ($health.StatusCode -eq 200) {
      Write-Host "Keycloak is ready."
      Write-Host "Admin console: http://localhost:8080/admin"
      Write-Host "Realm: theia"
      Write-Host "Test user: theia.user / TheiaPass123!"
      Write-Host "SAML metadata URL: http://localhost:8080/realms/theia/protocol/saml/descriptor"
      exit 0
    }
  } catch {
    # keep waiting
  }

  $logs = docker logs --tail 50 $ContainerName 2>$null
  if ($logs -match "Listening on: http://0.0.0.0:8080") {
    Write-Host "Keycloak appears ready (log-based check)."
    Write-Host "Admin console: http://localhost:8080/admin"
    Write-Host "Realm: theia"
    Write-Host "Test user: theia.user / TheiaPass123!"
    Write-Host "SAML metadata URL: http://localhost:8080/realms/theia/protocol/saml/descriptor"
    exit 0
  }
}

Write-Host "Keycloak did not become ready in time."
exit 1

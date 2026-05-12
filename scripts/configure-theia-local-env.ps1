param(
  [string]$MetadataUrl = "http://localhost:8080/realms/theia/protocol/saml/descriptor",
  [string]$Issuer = "theia-control-plane",
  [string]$CallbackUrl = "http://localhost:4620/auth/saml/callback",
  [string]$Provider = "keycloak-local",
  [string]$OpenClawPath = "",
  [string]$CoreAllowedOrigins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
  [string]$LeadAllowedOrigins = "https://aidaking5a.github.io,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
)

function New-StrongSecret {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

$sessionSecret = [Environment]::GetEnvironmentVariable("THEIA_SESSION_SECRET", "User")
if ([string]::IsNullOrWhiteSpace($sessionSecret)) {
  $sessionSecret = New-StrongSecret
  Write-Host "Generated strong THEIA_SESSION_SECRET for your user profile."
}

$leadIpSalt = [Environment]::GetEnvironmentVariable("THEIA_LEADS_IP_HASH_SALT", "User")
if ([string]::IsNullOrWhiteSpace($leadIpSalt)) {
  $leadIpSalt = New-StrongSecret
  Write-Host "Generated THEIA_LEADS_IP_HASH_SALT for privacy-preserving lead dedupe."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OpenClawPath)) {
  $OpenClawPath = Join-Path $env:USERPROFILE "src\openclaw"
}
$resolvedOpenClawPath = [System.IO.Path]::GetFullPath($OpenClawPath)
$approvedPaths = $projectRoot
if (Test-Path -LiteralPath $resolvedOpenClawPath) {
  $approvedPaths = "$projectRoot,$resolvedOpenClawPath"
  setx THEIA_OPENCLAW_WORKSPACE_PATH $resolvedOpenClawPath | Out-Null
  setx THEIA_OPENCLAW_DISCOVERY_PATHS $resolvedOpenClawPath | Out-Null
  setx THEIA_OPENCLAW_LOG_SOURCES $resolvedOpenClawPath | Out-Null
} else {
  Write-Warning "OpenClaw path not found yet: $resolvedOpenClawPath"
  Write-Warning "Theia will still use this as the default discovery path once it exists."
  setx THEIA_OPENCLAW_WORKSPACE_PATH $resolvedOpenClawPath | Out-Null
  setx THEIA_OPENCLAW_DISCOVERY_PATHS $resolvedOpenClawPath | Out-Null
}

setx THEIA_SAML_METADATA_URL $MetadataUrl | Out-Null
setx THEIA_SAML_ISSUER $Issuer | Out-Null
setx THEIA_SAML_CALLBACK_URL $CallbackUrl | Out-Null
setx THEIA_SAML_PROVIDER $Provider | Out-Null
setx THEIA_APPROVED_PATHS $approvedPaths | Out-Null
setx THEIA_ALLOWED_ORIGINS $CoreAllowedOrigins | Out-Null
setx THEIA_SESSION_SECRET $sessionSecret | Out-Null
setx THEIA_LEADS_ALLOW_ORIGINS $LeadAllowedOrigins | Out-Null
setx THEIA_LEADS_IP_HASH_SALT $leadIpSalt | Out-Null
setx THEIA_LEADS_NOTIFY_TO "windsurf345@outlook.com" | Out-Null
setx THEIA_LEADS_NOTIFY_ENABLED "true" | Out-Null

Write-Host "Persistent Theia env vars saved for current Windows user."
Write-Host "THEIA_SAML_METADATA_URL=$MetadataUrl"
Write-Host "THEIA_SAML_ISSUER=$Issuer"
Write-Host "THEIA_SAML_CALLBACK_URL=$CallbackUrl"
Write-Host "THEIA_SAML_PROVIDER=$Provider"
Write-Host "THEIA_OPENCLAW_WORKSPACE_PATH=$resolvedOpenClawPath"
Write-Host "THEIA_OPENCLAW_DISCOVERY_PATHS=$resolvedOpenClawPath"
Write-Host "THEIA_APPROVED_PATHS=$approvedPaths"
Write-Host "THEIA_ALLOWED_ORIGINS=$CoreAllowedOrigins"
Write-Host "THEIA_SESSION_SECRET=<stored>"
Write-Host "THEIA_LEADS_ALLOW_ORIGINS=$LeadAllowedOrigins"
Write-Host "THEIA_LEADS_IP_HASH_SALT=<stored>"
Write-Host "THEIA_LEADS_NOTIFY_TO=windsurf345@outlook.com"
Write-Host "THEIA_LEADS_NOTIFY_ENABLED=true"
Write-Host "Open a NEW terminal before running services so env vars are loaded."

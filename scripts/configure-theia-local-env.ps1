param(
  [string]$MetadataUrl = "http://localhost:8080/realms/theia/protocol/saml/descriptor",
  [string]$Issuer = "theia-control-plane",
  [string]$CallbackUrl = "http://localhost:4620/auth/saml/callback",
  [string]$Provider = "keycloak-local",
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

setx THEIA_SAML_METADATA_URL $MetadataUrl | Out-Null
setx THEIA_SAML_ISSUER $Issuer | Out-Null
setx THEIA_SAML_CALLBACK_URL $CallbackUrl | Out-Null
setx THEIA_SAML_PROVIDER $Provider | Out-Null
setx THEIA_SESSION_SECRET $sessionSecret | Out-Null
setx THEIA_LEADS_ALLOW_ORIGINS $LeadAllowedOrigins | Out-Null
setx THEIA_LEADS_IP_HASH_SALT $leadIpSalt | Out-Null

Write-Host "Persistent Theia env vars saved for current Windows user."
Write-Host "THEIA_SAML_METADATA_URL=$MetadataUrl"
Write-Host "THEIA_SAML_ISSUER=$Issuer"
Write-Host "THEIA_SAML_CALLBACK_URL=$CallbackUrl"
Write-Host "THEIA_SAML_PROVIDER=$Provider"
Write-Host "THEIA_SESSION_SECRET=<stored>"
Write-Host "THEIA_LEADS_ALLOW_ORIGINS=$LeadAllowedOrigins"
Write-Host "THEIA_LEADS_IP_HASH_SALT=<stored>"
Write-Host "Open a NEW terminal before running services so env vars are loaded."

$env:THEIA_SAML_METADATA_URL = "http://localhost:8080/realms/theia/protocol/saml/descriptor"
$env:THEIA_SAML_ISSUER = "theia-control-plane"
$env:THEIA_SAML_CALLBACK_URL = "http://localhost:4620/auth/saml/callback"

Write-Host "SAML env vars set for this terminal session."
Write-Host "THEIA_SAML_METADATA_URL=$env:THEIA_SAML_METADATA_URL"
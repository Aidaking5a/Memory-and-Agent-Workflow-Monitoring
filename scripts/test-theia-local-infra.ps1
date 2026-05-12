[CmdletBinding()]
param(
  [string]$CoreUrl = "http://localhost:4318",
  [string]$DashboardUrl = "http://localhost:5173",
  [string]$MarketingUrl = "http://localhost:4173",
  [string]$ControlPlaneUrl = "http://localhost:4620",
  [switch]$SkipCore,
  [switch]$SkipDashboard,
  [switch]$SkipMarketing,
  [switch]$IncludeControlPlane
)

$ErrorActionPreference = "Continue"

function Test-Http {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Url,
    [int[]]$ExpectedStatus = @(200),
    [string]$Contains
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 10 -ErrorAction Stop
    $content = [string]$response.Content
    $statusOk = $ExpectedStatus -contains [int]$response.StatusCode
    $contentOk = [string]::IsNullOrWhiteSpace($Contains) -or $content.Contains($Contains)
    return [PSCustomObject]@{
      Name = $Name
      Url = $Url
      StatusCode = [int]$response.StatusCode
      Passed = [bool]($statusOk -and $contentOk)
      Detail = if ($contentOk) { "ok" } else { "Missing expected content: $Contains" }
    }
  } catch {
    $response = $_.Exception.Response
    if ($response -and ($ExpectedStatus -contains [int]$response.StatusCode)) {
      return [PSCustomObject]@{
        Name = $Name
        Url = $Url
        StatusCode = [int]$response.StatusCode
        Passed = $true
        Detail = "expected status"
      }
    }
    return [PSCustomObject]@{
      Name = $Name
      Url = $Url
      StatusCode = if ($response) { [int]$response.StatusCode } else { 0 }
      Passed = $false
      Detail = $_.Exception.Message
    }
  }
}

$checks = @()

if (-not $SkipCore) {
  $checks += Test-Http -Name "local-core health" -Url "$CoreUrl/health" -Contains '"service":"theia-local-core"'
  $checks += Test-Http -Name "local-core protected snapshot requires auth" -Url "$CoreUrl/dashboard/snapshot" -ExpectedStatus @(401)
}

if (-not $SkipDashboard) {
  $checks += Test-Http -Name "desktop dashboard shell" -Url $DashboardUrl -Contains "Theia Control Center"
}

if (-not $SkipMarketing) {
  $checks += Test-Http -Name "marketing home" -Url "$MarketingUrl/" -Contains "Theia"
  $checks += Test-Http -Name "marketing product" -Url "$MarketingUrl/product.html" -Contains "Product"
  $checks += Test-Http -Name "marketing contact" -Url "$MarketingUrl/contact.html" -Contains "contact"
  $checks += Test-Http -Name "marketing sitemap" -Url "$MarketingUrl/sitemap.xml" -Contains "<urlset"
  $checks += Test-Http -Name "marketing robots" -Url "$MarketingUrl/robots.txt" -Contains "Sitemap"
}

if ($IncludeControlPlane) {
  $checks += Test-Http -Name "control-plane dashboard" -Url "$ControlPlaneUrl/dashboard" -ExpectedStatus @(200, 302, 401)
}

$checks | Format-Table -AutoSize

$failed = @($checks | Where-Object { -not $_.Passed })
if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Failed checks: $($failed.Count)" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "All selected infrastructure checks passed." -ForegroundColor Green

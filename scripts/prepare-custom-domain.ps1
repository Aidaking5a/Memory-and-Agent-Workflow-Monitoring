[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PrimaryDomain,
  [string]$SecondaryDomain = "",
  [string]$ApiBaseUrl = "",
  [string]$MailDomain = "",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

function Assert-Domain {
  param([string]$Domain, [string]$Name)

  if ([string]::IsNullOrWhiteSpace($Domain)) {
    throw "$Name is required."
  }

  if ($Domain -notmatch '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$') {
    throw "$Name is not a valid domain: $Domain"
  }
}

Assert-Domain -Domain $PrimaryDomain -Name "PrimaryDomain"
if (-not [string]::IsNullOrWhiteSpace($SecondaryDomain)) {
  Assert-Domain -Domain $SecondaryDomain -Name "SecondaryDomain"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$siteRoot = Join-Path $projectRoot "website\site"

if (-not (Test-Path $siteRoot)) {
  throw "Website folder not found at $siteRoot"
}

$canonicalBase = "https://$PrimaryDomain"
$oldBase = "https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring"
$resolvedMailDomain = if ([string]::IsNullOrWhiteSpace($MailDomain)) { $PrimaryDomain -replace '^www\.', '' } else { $MailDomain }

$preview = [ordered]@{
  PrimaryDomain = $PrimaryDomain
  SecondaryDomain = if ([string]::IsNullOrWhiteSpace($SecondaryDomain)) { "(none)" } else { $SecondaryDomain }
  CanonicalBase = $canonicalBase
  ApiBaseUrl = if ([string]::IsNullOrWhiteSpace($ApiBaseUrl)) { "(unchanged)" } else { $ApiBaseUrl }
  MailDomain = $resolvedMailDomain
}

Write-Host "Planned domain cutover:"
$preview.GetEnumerator() | ForEach-Object { Write-Host " - $($_.Key): $($_.Value)" }

if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry run only. Re-run with -Apply to modify website files and generate CNAME."
  exit 0
}

$files = Get-ChildItem -Path $siteRoot -File | Where-Object {
  $_.Extension -in ".html", ".xml", ".txt"
}

foreach ($file in $files) {
  $content = Get-Content -Path $file.FullName -Raw
  $updated = $content -replace [Regex]::Escape($oldBase), $canonicalBase
  $updated = $updated -replace "theiaops\.ai", $resolvedMailDomain
  if ($updated -ne $content) {
    Set-Content -Path $file.FullName -Value $updated -Encoding UTF8
  }
}

if (-not [string]::IsNullOrWhiteSpace($ApiBaseUrl)) {
  $contactPath = Join-Path $siteRoot "contact.html"
  $contact = Get-Content -Path $contactPath -Raw
  $contactUpdated = [Regex]::Replace(
    $contact,
    'data-api-base-url="[^"]*"',
    ('data-api-base-url="{0}"' -f $ApiBaseUrl.TrimEnd('/'))
  )
  if ($contactUpdated -ne $contact) {
    Set-Content -Path $contactPath -Value $contactUpdated -Encoding UTF8
  }
}

$cnamePath = Join-Path $siteRoot "CNAME"
Set-Content -Path $cnamePath -Value "$PrimaryDomain`n" -Encoding ASCII

$summaryPath = Join-Path $projectRoot "docs\domain-cutover-summary.md"
$summary = @"
# Domain Cutover Summary

- Primary domain: $PrimaryDomain
- Secondary domain: $(if ([string]::IsNullOrWhiteSpace($SecondaryDomain)) { "(none)" } else { $SecondaryDomain })
- Canonical base: $canonicalBase
- Mail domain used in website copy: $resolvedMailDomain
- API base for lead form: $(if ([string]::IsNullOrWhiteSpace($ApiBaseUrl)) { "(unchanged)" } else { $ApiBaseUrl.TrimEnd('/') })
- Generated CNAME: website/site/CNAME

Next:
1. Configure DNS at registrar.
2. Verify domain in GitHub Pages settings.
3. Re-submit sitemap in Google Search Console.
"@
Set-Content -Path $summaryPath -Value $summary -Encoding UTF8

Write-Host ""
Write-Host "Domain cutover files updated successfully."
Write-Host "Generated:"
Write-Host " - website/site/CNAME"
Write-Host " - docs/domain-cutover-summary.md"

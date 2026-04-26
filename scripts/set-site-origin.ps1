param(
  [Parameter(Mandatory = $true)]
  [string]$NewOrigin,
  [string]$CurrentOrigin = "https://aidaking5a.github.io/Memory-and-Agent-Workflow-Monitoring",
  [string]$CustomDomainHost = ""
)

$ErrorActionPreference = "Stop"

function Normalize-Origin {
  param([string]$Origin)
  return $Origin.Trim().TrimEnd("/")
}

$newValue = Normalize-Origin $NewOrigin
$oldValue = Normalize-Origin $CurrentOrigin

if ([string]::IsNullOrWhiteSpace($newValue)) {
  throw "NewOrigin cannot be empty."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$siteDir = Join-Path $projectRoot "website\site"

$targets = Get-ChildItem -Path $siteDir -File -Include *.html,*.xml,robots.txt,manifest.webmanifest
foreach ($target in $targets) {
  $raw = Get-Content -Path $target.FullName -Raw
  $updated = $raw.Replace($oldValue, $newValue)
  if ($updated -ne $raw) {
    Set-Content -Path $target.FullName -Value $updated -NoNewline
    Write-Host "Updated origin in $($target.Name)"
  }
}

if (-not [string]::IsNullOrWhiteSpace($CustomDomainHost)) {
  $cnamePath = Join-Path $siteDir "CNAME"
  Set-Content -Path $cnamePath -Value $CustomDomainHost.Trim() -NoNewline
  Write-Host "Wrote CNAME: $CustomDomainHost"
}

Write-Host "Site origin update complete."
Write-Host "Old origin: $oldValue"
Write-Host "New origin: $newValue"

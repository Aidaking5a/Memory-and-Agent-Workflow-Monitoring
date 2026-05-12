param(
  [string]$InstallDir = "$env:USERPROFILE\TheiaCommandCenter",
  [string]$RepoUrl = "https://github.com/aidaking5a/Memory-and-Agent-Workflow-Monitoring.git",
  [string]$Branch = "main",
  [switch]$Yes,
  [switch]$BuildDashboard,
  [switch]$StartAfterInstall
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "[theia-install] $Message" -ForegroundColor Cyan
}

function Require-Command([string]$Name, [string]$InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Missing required command '$Name'. $InstallHint"
  }
  return $command.Source
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
  Write-Step "$FilePath $($Arguments -join ' ')"
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -Wait -NoNewWindow -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Command failed with exit code $($process.ExitCode): $FilePath $($Arguments -join ' ')"
  }
}

$resolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$parentDir = Split-Path -Parent $resolvedInstallDir

Write-Host ""
Write-Host "Theia Agent Command Center installer" -ForegroundColor White
Write-Host "This script is local-first and reversible. It will not install Node, pnpm, Git, Rust, WSL, Docker, Visual Studio Build Tools, or paid connectors." -ForegroundColor Gray
Write-Host ""
Write-Host "Plan:" -ForegroundColor White
Write-Host "  Install directory: $resolvedInstallDir"
Write-Host "  Repository:        $RepoUrl"
Write-Host "  Branch:            $Branch"
Write-Host "  Build dashboard:   $($BuildDashboard.IsPresent)"
Write-Host "  Start services:    $($StartAfterInstall.IsPresent)"
Write-Host ""

if (-not $Yes) {
  $answer = Read-Host "Continue? Type YES"
  if ($answer -ne "YES") {
    Write-Host "Cancelled."
    exit 0
  }
}

$git = Require-Command "git.exe" "Install Git for Windows from https://git-scm.com/download/win, then rerun this script."
$node = Require-Command "node.exe" "Install Node.js 22 LTS from https://nodejs.org/, then rerun this script."
$pnpm = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
if (-not $pnpm) {
  $pnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
}
if (-not $pnpm) {
  throw "Missing required command 'pnpm'. Install with Corepack or npm after reviewing your Node setup, then rerun this script."
}

if (-not (Test-Path $parentDir)) {
  New-Item -ItemType Directory -Path $parentDir | Out-Null
}

if (Test-Path $resolvedInstallDir) {
  if (-not (Test-Path (Join-Path $resolvedInstallDir ".git"))) {
    throw "Install directory exists but is not a Git repository: $resolvedInstallDir"
  }
  Write-Step "Updating existing checkout"
  Invoke-Checked $git @("-C", $resolvedInstallDir, "fetch", "--tags", "origin") $resolvedInstallDir
  Invoke-Checked $git @("-C", $resolvedInstallDir, "checkout", $Branch) $resolvedInstallDir
  Invoke-Checked $git @("-C", $resolvedInstallDir, "pull", "--ff-only", "origin", $Branch) $resolvedInstallDir
} else {
  Write-Step "Cloning repository"
  Invoke-Checked $git @("clone", "--branch", $Branch, "--single-branch", $RepoUrl, $resolvedInstallDir) $parentDir
}

$manifestDir = Join-Path $resolvedInstallDir ".theia"
if (-not (Test-Path $manifestDir)) {
  New-Item -ItemType Directory -Path $manifestDir | Out-Null
}
$manifestPath = Join-Path $manifestDir "install-manifest.json"
@{
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
  installDir = $resolvedInstallDir
  repoUrl = $RepoUrl
  branch = $Branch
  node = & $node "--version"
  pnpm = & $pnpm.Source "--version"
} | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8

$lockfilePath = Join-Path $resolvedInstallDir "pnpm-lock.yaml"
Write-Step "Installing workspace dependencies"
if (Test-Path -LiteralPath $lockfilePath) {
  Invoke-Checked $pnpm.Source @("install", "--frozen-lockfile") $resolvedInstallDir
} else {
  Write-Step "No pnpm-lock.yaml found in checkout; using pnpm install --no-frozen-lockfile"
  Invoke-Checked $pnpm.Source @("install", "--no-frozen-lockfile") $resolvedInstallDir
}

Write-Step "Building shared agent protocol"
Invoke-Checked $pnpm.Source @("--filter", "@theia/agent-protocol", "build") $resolvedInstallDir

if ($BuildDashboard) {
  Write-Step "Building local core and desktop dashboard"
  Invoke-Checked $pnpm.Source @("--filter", "@theia/local-core", "build") $resolvedInstallDir
  Invoke-Checked $pnpm.Source @("--filter", "@theia/desktop", "build") $resolvedInstallDir
}

Write-Host ""
Write-Host "Theia Agent Command Center is installed." -ForegroundColor Green
Write-Host "Manifest: $manifestPath"
Write-Host ""
Write-Host "Start locally:" -ForegroundColor White
Write-Host "  cd `"$resolvedInstallDir`""
Write-Host "  pnpm.cmd run dev:stack"
Write-Host ""
Write-Host "Reversible cleanup:" -ForegroundColor White
Write-Host "  1. Stop services with: pnpm.cmd run dev:stop"
Write-Host "  2. Remove the install directory after reviewing any local .theia state you want to keep."

if ($StartAfterInstall) {
  Write-Step "Starting local stack"
  Invoke-Checked $pnpm.Source @("run", "dev:stack") $resolvedInstallDir
}

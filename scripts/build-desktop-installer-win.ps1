[CmdletBinding()]
param(
  [switch]$InstallBuildTools,
  [switch]$InstallOnly
)

$ErrorActionPreference = "Stop"

function Get-PnpmCommand {
  if (Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue) {
    return "pnpm.cmd"
  }
  if (Get-Command "pnpm" -ErrorAction SilentlyContinue) {
    return "pnpm"
  }
  throw "pnpm is not installed or not on PATH."
}

function Import-CmdEnvironment {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BatchFile,
    [string]$Arguments = ""
  )

  $command = "`"$BatchFile`" $Arguments >nul && set"
  $envLines = & cmd.exe /d /s /c $command
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to load Visual Studio environment from $BatchFile."
  }

  foreach ($line in $envLines) {
    if ($line -match "^(?<name>[^=]+)=(?<value>.*)$") {
      [System.Environment]::SetEnvironmentVariable($matches["name"], $matches["value"], "Process")
    }
  }
}

function Get-VsDevCmdPath {
  $knownLocations = @(
    "$env:ProgramFiles(x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
    "$env:ProgramFiles(x86)\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
    "$env:ProgramFiles(x86)\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
    "$env:ProgramFiles(x86)\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat"
  )

  foreach ($candidate in $knownLocations) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $vsWhere = "$env:ProgramFiles(x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vsWhere) {
    $installPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($installPath)) {
      $candidate = Join-Path $installPath "Common7\Tools\VsDevCmd.bat"
      if (Test-Path $candidate) {
        return $candidate
      }
    }
  }

  return $null
}

function Test-LinkExe {
  $linkCommand = Get-Command "link.exe" -ErrorAction SilentlyContinue
  return $null -ne $linkCommand
}

function Wait-VisualStudioInstaller {
  param(
    [int]$TimeoutMinutes = 30
  )

  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  while ((Get-Date) -lt $deadline) {
    $runningInstaller = Get-Process -Name "setup", "vs_setup_bootstrapper", "vs_installer" -ErrorAction SilentlyContinue
    if (-not $runningInstaller) {
      return $true
    }
    Write-Host "Visual Studio installer is already running. Waiting for it to finish..."
    Start-Sleep -Seconds 10
  }

  return $false
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-ElevatedBuildToolsInstall {
  Write-Host "Requesting Administrator approval (UAC) to install Visual Studio Build Tools..."
  $quotedScriptPath = '"' + $PSCommandPath + '"'
  $elevatedScript = "& $quotedScriptPath -InstallBuildTools -InstallOnly"
  $encodedCommand = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($elevatedScript))

  try {
    $proc = Start-Process -FilePath "powershell.exe" `
      -Verb RunAs `
      -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedCommand" `
      -Wait `
      -PassThru
  } catch {
    throw "Administrator approval was not granted. Cannot install Build Tools without elevation."
  }

  if ($proc.ExitCode -ne 0) {
    throw "Elevated Build Tools installer failed with exit code $($proc.ExitCode)."
  }
}

function Install-BuildTools {
  if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
    throw "winget is not available. Install Visual Studio Build Tools manually."
  }

  if (-not (Test-IsAdmin)) {
    Invoke-ElevatedBuildToolsInstall
    return
  }

  Write-Host "Installing Visual Studio Build Tools (C++ workload). This may take several minutes..."
  & winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --accept-package-agreements --accept-source-agreements --override "--passive --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --includeRecommended"
  if ($LASTEXITCODE -ne 0) {
    throw "Build Tools installation failed. Please install Visual Studio Build Tools manually and rerun this script."
  }
}

Write-Host "Preparing Windows toolchain for Theia desktop installer..."

if (-not (Wait-VisualStudioInstaller -TimeoutMinutes 45)) {
  throw "Visual Studio installer is still running after 45 minutes. Complete/close it, then rerun this command."
}

if (-not (Test-LinkExe)) {
  $vsDevCmd = Get-VsDevCmdPath
  if ($vsDevCmd) {
    Write-Host "Loading MSVC environment from: $vsDevCmd"
    Import-CmdEnvironment -BatchFile $vsDevCmd -Arguments "-arch=x64 -host_arch=x64"
  }
}

if (-not (Test-LinkExe) -and (-not $InstallBuildTools)) {
  Write-Warning "MSVC linker not found. Attempting automatic Build Tools installation..."
  $InstallBuildTools = $true
}

if (-not (Test-LinkExe) -and $InstallBuildTools) {
  Install-BuildTools
  if (-not (Wait-VisualStudioInstaller -TimeoutMinutes 45)) {
    throw "Visual Studio installer did not finish within 45 minutes. Re-run this command after installation completes."
  }
  $vsDevCmd = Get-VsDevCmdPath
  if ($vsDevCmd) {
    Write-Host "Loading MSVC environment from: $vsDevCmd"
    Import-CmdEnvironment -BatchFile $vsDevCmd -Arguments "-arch=x64 -host_arch=x64"
  }
}

if ($InstallOnly) {
  Write-Host "Build Tools install-only mode complete."
  exit 0
}

if (-not (Test-LinkExe)) {
  throw @"
MSVC linker link.exe is not available.

Fix:
1) Install Visual Studio Build Tools 2022 with C++ tools:
   winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --accept-package-agreements --accept-source-agreements --override "--passive --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --includeRecommended"
2) Open a NEW terminal and run:
   pnpm run build:desktop:installer:win

Tip: if you cancel the UAC prompt, rerun this command and allow elevation, or install manually in an Administrator shell.
"@
}

$pnpmCommand = Get-PnpmCommand
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:NODE_OPTIONS = "--max-old-space-size=4096"

Write-Host "Building Theia Windows installer (.exe)..."
& $pnpmCommand --filter "@theia/desktop" run tauri:build:win
if ($LASTEXITCODE -ne 0) {
  throw "Windows installer build failed."
}

Write-Host "Windows installer build succeeded."
Write-Host "Output: apps\desktop\src-tauri\target\release\bundle\nsis"

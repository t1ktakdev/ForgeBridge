[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\ForgeBridge'),
  [switch]$InstallChromium
)

$ErrorActionPreference = 'Stop'
$package = (Resolve-Path -LiteralPath $PackagePath).Path
if ([IO.Path]::GetExtension($package) -ne '.tgz') {
  throw 'PackagePath must point to a locally produced .tgz artifact.'
}
$root = [IO.Path]::GetFullPath($InstallRoot)
$driveRoot = [IO.Path]::GetPathRoot($root)
if ($root -eq $driveRoot -or $root -eq [Environment]::GetFolderPath('UserProfile')) {
  throw "Refusing unsafe installation root: $root"
}

$nodeVersion = (& node --version).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 22) { throw 'ForgeBridge requires Node.js 22 or newer.' }

New-Item -ItemType Directory -Path $root -Force | Out-Null
& npm install --prefix $root --no-audit --no-fund $package
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }

$cli = Join-Path $root 'node_modules\.bin\forgebridge.cmd'
if (-not (Test-Path -LiteralPath $cli)) { throw "Installed CLI was not found at $cli" }
& $cli --version
if ($LASTEXITCODE -ne 0) { throw 'The installed ForgeBridge CLI smoke test failed.' }

if ($InstallChromium) {
  $playwright = Join-Path $root 'node_modules\playwright\cli.js'
  & node $playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium installation failed.' }
}

Write-Host "ForgeBridge installed at $root"
Write-Host "CLI: $cli"
Write-Host 'No service, scheduled task, startup entry, firewall rule, or PATH entry was created.'
Write-Host 'Run forgebridge init explicitly before starting the agent.'
Write-Host 'Optional logon autostart can be configured explicitly with scripts\configure-autostart-windows.ps1.'

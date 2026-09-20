[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\ForgeBridge'),
  [switch]$RemoveState,
  [switch]$KeepAutostart,
  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'ForgeBridge')
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot)
$packageName = 'forgebridge'
$packageRoot = Join-Path $root 'node_modules\forgebridge'
$manifest = Join-Path $packageRoot 'package.json'
if (Test-Path -LiteralPath $manifest) {
  $package = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
  if ($package.name -ne $packageName) { throw "Unexpected package at $manifest" }
  if (-not $KeepAutostart) {
    $removeAutostart = Join-Path $packageRoot 'scripts\remove-autostart-windows.ps1'
    if (Test-Path -LiteralPath $removeAutostart) {
      & $removeAutostart -StateDirectory $StateDirectory -Confirm:$false
    }
  }
  if ($PSCmdlet.ShouldProcess($root, 'Uninstall the ForgeBridge package')) {
    & npm uninstall --prefix $root --no-audit --no-fund $packageName
    if ($LASTEXITCODE -ne 0) { throw "npm uninstall failed with exit code $LASTEXITCODE" }
  }
} else {
  Write-Host "No ForgeBridge package was found below $root"
}

if ($RemoveState) {
  $state = [IO.Path]::GetFullPath($StateDirectory)
  $driveRoot = [IO.Path]::GetPathRoot($state)
  $userProfilePath = [IO.Path]::GetFullPath([Environment]::GetFolderPath('UserProfile'))
  if ($state -eq $driveRoot -or $state -eq $userProfilePath) { throw "Refusing unsafe state path: $state" }
  $hasForgeBridgeState =
    (Test-Path -LiteralPath (Join-Path $state 'config.json')) -or
    (Test-Path -LiteralPath (Join-Path $state 'identity.json'))
  if ((Test-Path -LiteralPath $state) -and -not $hasForgeBridgeState) {
    throw "Refusing to remove a directory without recognizable ForgeBridge state: $state"
  }
  if ((Test-Path -LiteralPath $state) -and $PSCmdlet.ShouldProcess($state, 'Permanently remove ForgeBridge configuration, keys, logs, and job records')) {
    Remove-Item -LiteralPath $state -Recurse -Force
  }
} else {
  Write-Host "ForgeBridge state was preserved at $([IO.Path]::GetFullPath($StateDirectory))"
  Write-Host 'Use -RemoveState only after revoking tunnel credentials and retaining any required audit records.'
}

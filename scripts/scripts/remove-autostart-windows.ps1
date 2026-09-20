[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'ForgeBridge'),
  [ValidatePattern('^[A-Za-z0-9 ._-]{1,128}$')]
  [string]$TaskName = 'ForgeBridge',
  [switch]$RemoveCredential
)

$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task -and $PSCmdlet.ShouldProcess($TaskName, 'Remove ForgeBridge logon autostart task')) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
} elseif (-not $task) {
  Write-Host "Scheduled task '$TaskName' is not installed."
}

if ($RemoveCredential) {
  $state = [IO.Path]::GetFullPath($StateDirectory)
  $keyFile = Join-Path $state 'autostart\control-plane-key.dpapi'
  if ((Test-Path -LiteralPath $keyFile) -and $PSCmdlet.ShouldProcess($keyFile, 'Remove DPAPI-encrypted tunnel credential')) {
    Remove-Item -LiteralPath $keyFile -Force
    Write-Host 'Removed the stored autostart credential.'
  }
}

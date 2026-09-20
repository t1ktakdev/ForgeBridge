[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\ForgeBridge'),
  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'ForgeBridge'),
  [Parameter(Mandatory = $true)]
  [string]$TunnelClientPath,
  [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')]
  [string]$TunnelProfile = 'forgebridge-local',
  [ValidatePattern('^[A-Za-z0-9 ._-]{1,128}$')]
  [string]$TaskName = 'ForgeBridge',
  [ValidateRange(0, 300)]
  [int]$DelaySeconds = 15,
  [switch]$ReplaceCredential,
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot)
$state = [IO.Path]::GetFullPath($StateDirectory)
$client = (Resolve-Path -LiteralPath $TunnelClientPath).Path
$packageRoot = Join-Path $root 'node_modules\forgebridge'
$runner = Join-Path $packageRoot 'scripts\run-autostart-windows.ps1'
$cli = Join-Path $packageRoot 'dist\cli.js'
$keyDirectory = Join-Path $state 'autostart'
$keyFile = Join-Path $keyDirectory 'control-plane-key.dpapi'

foreach ($value in @($root, $state, $client, $runner)) {
  if ($value.Contains('"')) { throw 'Autostart paths containing a double quote are not supported.' }
}
if (-not (Test-Path -LiteralPath $runner)) { throw "Autostart runner not found at $runner" }
if (-not (Test-Path -LiteralPath $cli)) { throw "ForgeBridge CLI not found at $cli" }
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
if ($ReplaceCredential -or -not (Test-Path -LiteralPath $keyFile)) {
  $secureKey = Read-Host 'Paste the least-privilege tunnel runtime API key' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    if ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Length -lt 8) {
      throw 'The runtime key is unexpectedly short.'
    }
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  $cipherText = ConvertFrom-SecureString $secureKey
  Set-Content -LiteralPath $keyFile -Value $cipherText -Encoding ASCII -NoNewline
}

$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [Security.AccessControl.PropagationFlags]::None
$allow = [Security.AccessControl.AccessControlType]::Allow
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($currentSid, 'FullControl', $inheritance, $propagation, $allow)))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($systemSid, 'FullControl', $inheritance, $propagation, $allow)))
Set-Acl -LiteralPath $keyDirectory -AclObject $acl
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$argumentList = @(
  '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
  '-File', ('"{0}"' -f $runner),
  '-InstallRoot', ('"{0}"' -f $root),
  '-StateDirectory', ('"{0}"' -f $state),
  '-TunnelClientPath', ('"{0}"' -f $client),
  '-TunnelProfile', $TunnelProfile,
  '-DelaySeconds', [string]$DelaySeconds
) -join ' '

$action = New-ScheduledTaskAction -Execute $powerShell -Argument $argumentList
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$userId = $identity.Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description 'Starts ForgeBridge Secure MCP Tunnel for the current user at logon.' `
  -Force | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }

Write-Host "ForgeBridge autostart task '$TaskName' configured for $userId."
Write-Host "Credential is DPAPI-encrypted for this Windows user at $keyFile"
Write-Host "Profile: $TunnelProfile"
Write-Host "Status: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"

[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\ForgeBridge'),
  [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'ForgeBridge'),
  [Parameter(Mandatory = $true)]
  [string]$TunnelClientPath,
  [string]$TunnelProfile = 'forgebridge-local',
  [ValidateRange(0, 300)]
  [int]$DelaySeconds = 15
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot)
$state = [IO.Path]::GetFullPath($StateDirectory)
$client = (Resolve-Path -LiteralPath $TunnelClientPath).Path
$packageRoot = Join-Path $root 'node_modules\forgebridge'
$cli = Join-Path $packageRoot 'dist\cli.js'
$keyFile = Join-Path $state 'autostart\control-plane-key.dpapi'
$logDirectory = Join-Path $state 'logs'
$logFile = Join-Path $logDirectory 'autostart.log'

if (-not (Test-Path -LiteralPath $cli)) { throw "ForgeBridge CLI not found at $cli" }
if (-not (Test-Path -LiteralPath $keyFile)) { throw "Autostart credential not found at $keyFile" }
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-AutostartLog([string]$Message) {
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}
if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds }

$mutexNameBytes = [Text.Encoding]::UTF8.GetBytes($state.ToLowerInvariant())
$sha = [Security.Cryptography.SHA256]::Create()
try { $mutexHash = ([BitConverter]::ToString($sha.ComputeHash($mutexNameBytes))).Replace('-', '').Substring(0, 24) }
finally { $sha.Dispose() }
$mutex = New-Object Threading.Mutex($false, "Local\ForgeBridgeAutostart-$mutexHash")
$ownsMutex = $false
try {
  $ownsMutex = $mutex.WaitOne(0)
  if (-not $ownsMutex) {
    Write-AutostartLog 'Another ForgeBridge autostart supervisor is already running; exiting.'
    exit 0
  }

  $cipherText = (Get-Content -Raw -LiteralPath $keyFile).Trim()
  if (-not $cipherText) { throw 'Autostart credential file is empty.' }
  $secureKey = ConvertTo-SecureString $cipherText
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = $null
  try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if (-not $plainKey) { throw 'Autostart credential decrypted to an empty value.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $env:CONTROL_PLANE_API_KEY = $plainKey
    Write-AutostartLog "Starting ForgeBridge tunnel profile '$TunnelProfile'."
    & $node $cli tunnel run --profile $TunnelProfile --tunnel-client $client --state $state
    $exitCode = $LASTEXITCODE
    Write-AutostartLog "ForgeBridge tunnel exited with code $exitCode."
    exit $exitCode
  } finally {
    Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $plainKey = $null
  }
} catch {
  Write-AutostartLog ("Autostart failure: " + $_.Exception.Message)
  throw
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}

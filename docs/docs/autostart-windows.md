# Windows autostart

ForgeBridge can optionally start its Secure MCP Tunnel automatically when the current Windows user
logs on. Autostart is deliberately opt-in: the normal installer still creates no service, scheduled
task, registry Run entry, or machine-wide persistence.

The autostart design is user-scoped and reversible:

- one Windows Scheduled Task runs only for the current interactive user;
- the task runs with limited/current-user privileges, never elevated;
- the tunnel runtime key is entered through a SecureString prompt, never a command-line argument;
- the stored credential is encrypted with Windows DPAPI for the current user;
- only the hidden supervisor process receives `CONTROL_PLANE_API_KEY` in its environment;
- ForgeBridge continues to filter the tunnel credential from the spawned MCP server environment;
- removing the task does not delete configuration or audit logs.

## Configure

First install the reviewed ForgeBridge tarball and create the Secure MCP Tunnel profile. Then run:

```powershell
$fb = "$env:LOCALAPPDATA\Programs\ForgeBridge\node_modules\forgebridge"
& "$fb\scripts\configure-autostart-windows.ps1" `
  -TunnelClientPath "$env:LOCALAPPDATA\Programs\OpenAI\tunnel-client\v0.0.14\tunnel-client.exe" `
  -TunnelProfile forgebridge-local
```

The script asks for the least-privilege tunnel runtime key without echoing it. By default the task
starts about 15 seconds after sign-in. Add `-StartNow` only when no manual ForgeBridge tunnel is
already running. Use `-ReplaceCredential` after rotating the runtime key.

The task executes the packaged `run-autostart-windows.ps1`, not a source checkout. It waits on the
`tunnel run` process so Task Scheduler can restart the supervisor after an unexpected non-zero exit.
A named per-state mutex prevents duplicate autostart supervisors for the same state directory.

Inspect the task without exposing the stored credential:

```powershell
Get-ScheduledTask -TaskName ForgeBridge
Get-ScheduledTask -TaskName ForgeBridge | Get-ScheduledTaskInfo
Get-Content "$env:LOCALAPPDATA\ForgeBridge\logs\autostart.log" -Tail 30
```

## Remove or rotate

Remove only the scheduled task:

```powershell
& "$fb\scripts\remove-autostart-windows.ps1" -Confirm:$false
```

Remove the task and the DPAPI-encrypted credential:

```powershell
& "$fb\scripts\remove-autostart-windows.ps1" -RemoveCredential -Confirm:$false
```

The package uninstaller removes the scheduled task by default before uninstalling ForgeBridge. Pass
`-KeepAutostart` only when intentionally preserving the task during an in-place maintenance flow.
State removal still requires the existing explicit `-RemoveState` switch.

## Security limits

DPAPI protects the stored key against casual file disclosure and other Windows users, but it is not
a containment boundary against malware or an administrator running as the same user. Keep the tunnel
runtime key least-privilege (Tunnels Read + Use), rotate it if the account may be compromised, and
use a dedicated low-privilege Windows account or VM when stronger isolation is required.

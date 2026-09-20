# Secure remote connection

ForgeBridge uses
[OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) for
private ChatGPT, Codex, and Responses API connections. The official `tunnel-client` starts
ForgeBridge over stdio and makes outbound HTTPS requests to OpenAI. ForgeBridge does not open a
public port or operate a relay.

Secure MCP Tunnel supports private and developer-mode connections. It is not a deployment target for
public plugin submission, which requires a stable public HTTPS MCP endpoint.

[Русская пошаговая инструкция](secure-tunnel.ru.md)

## Do you need Secure MCP Tunnel?

**No**, when your MCP client runs on the same machine and can launch ForgeBridge over stdio. In that
case, install ForgeBridge and run `forgebridge serve --transport stdio`; no OpenAI Platform tunnel,
`tunnel_id`, or tunnel runtime API key is required.

**Yes**, when a supported OpenAI product such as ChatGPT needs to reach ForgeBridge running on your
private workstation or private network without exposing a public MCP endpoint. ChatGPT does not
connect directly to a local MCP server, so use Secure MCP Tunnel for this private remote path.

The runtime API key authenticates the official `tunnel-client` to the OpenAI tunnel control plane.
It is not embedded in ForgeBridge and should never be committed to the repository. Using the
Responses API is a separate API scenario with its own authentication and billing.

## Prerequisites

1. Build and install ForgeBridge so `forgebridge` is on `PATH`.
2. Download the current official `tunnel-client` release from the link in the OpenAI tunnel settings
   page or from the upstream latest-release page linked by the official guide.
3. In OpenAI Platform tunnel settings, create a tunnel and associate the intended Platform
   organization and ChatGPT workspace.
4. Use a runtime key whose role has only Tunnels **Read** + **Use**. Creating or editing tunnels is
   a separate **Manage** permission and should not be present on the runtime key.
5. Put the runtime key only in the process environment when running `doctor` or `run`. ForgeBridge
   does not accept the key as a command-line argument or write its value to configuration, the
   tunnel profile, or the ForgeBridge audit log.

```powershell
$env:CONTROL_PLANE_API_KEY = Read-Host -MaskInput 'Tunnel runtime API key'
```

## Create and validate the profile

The wrapper delegates to the official client using its documented `sample_mcp_stdio_local` profile.
A tunnel ID uses `tunnel_` followed by exactly 32 lowercase hexadecimal characters. `tunnel init`
does not require the runtime key; it only writes the local profile. `doctor` and `run` require the
runtime key in the environment.

```powershell
forgebridge tunnel init --tunnel-id tunnel_0123456789abcdef0123456789abcdef
forgebridge tunnel doctor
forgebridge tunnel run
```

Use `--profile NAME` on all three commands for a non-default profile, and `--tunnel-client PATH` if
the official binary is not on `PATH`. `--profile-dir PATH` is available for an isolated profile
directory. `--mcp-command` remains an escape hatch for unusual portable installations, but normal
Windows users should not need it.

ForgeBridge generates the stdio command using the tunnel client's command-argument grammar rather
than PowerShell or Windows CRT shell quoting. Packaged and development launchers preserve
executable, configuration, and state paths containing spaces, backslashes, forward slashes, Unicode,
and quotes. The wrapper itself never invokes a shell: it passes an argument array directly to
`tunnel-client` and uses hidden Windows process creation.

The generated profile binds the tunnel client's health listener to `127.0.0.1:0`, allowing Windows
to choose an unused loopback port instead of assuming port 8080 is free. ForgeBridge never kills or
reconfigures an unrelated process to obtain a health port. The MCP backend remains stdio, and all
other local ForgeBridge HTTP/control listeners remain loopback-only.

`CONTROL_PLANE_API_KEY` is referenced as an environment variable by the tunnel profile; its value is
not embedded. The default stdio backend also avoids placing ForgeBridge's local bearer token in the
tunnel profile.

When ForgeBridge is serving MCP over stdio it also publishes a small, non-secret loopback control
endpoint record for the same state directory. This lets local `forgebridge status`, `approve`, and
related control commands reach the running tunneled agent. The endpoint record contains only
loopback host/port ownership metadata; the local [REDACTED] stays in ForgeBridge's protected state
and normal CSRF/authentication checks still apply.

Keep `tunnel-client run` active during discovery and tool calls. Use the client's loopback health,
readiness, metrics, and UI surfaces, or run `forgebridge tunnel doctor`, when diagnosing a
connection. Do not run multiple local clients against the same tunnel/profile as a substitute for
process supervision.

On Windows, an explicitly configured current-user scheduled task can supervise the packaged tunnel
at logon. Its runtime key is stored with Windows DPAPI rather than in the tunnel profile or task
arguments. This is opt-in and is never exposed as a model tool; see
[Windows autostart](autostart-windows.md).

## Connect ChatGPT

Enable developer mode in **Settings → Security and login** if the account and workspace policy allow
it. Go to [ChatGPT Plugins](https://chatgpt.com/plugins), create a developer-mode app, choose
**Tunnel** as the connection, and select the associated tunnel or enter its `tunnel_id`. Refresh the
connection after ForgeBridge tool metadata changes so the model receives the latest schemas,
descriptions, annotations, and server instructions.

## Revoke and recover

`forgebridge revoke` rotates the local HTTP credential, clears grants and pending approvals, closes
browser contexts, and pauses new privileged work. It cannot revoke an OpenAI credential. If a tunnel
runtime key may be compromised, revoke or rotate it in OpenAI Platform, stop `tunnel-client`, review
both ForgeBridge and Platform audit logs, then run the profile with a replacement least-privilege
key.

The tunnel transports MCP arguments and results through the selected OpenAI product and tunnel
service. Use direct stdio instead when data must remain entirely local.

## Official references

- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Add UI to an MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Plugin UI reference](https://developers.openai.com/plugins/reference)

## Local client verification

The 2026-09-14 Windows validation installed official tunnel-client version
`0.0.14+0f870e50a973fa820d4c409000059e181e8d242b`. Its release archive matched the official
`SHA256SUMS.txt`; the installed executable SHA-256 was
`fcc85a69ec0ad82518e4f8964f60c45e31787957782a0fc9c1b0c44e82d61b9b`.

On 2026-09-15 the hardening checkout ran the real Windows client against both the packaged and
development ForgeBridge launch forms in temporary directories containing spaces. Both `tunnel init`
flows were accepted, generated an ephemeral loopback health binding, and used no runtime credential.
This local hardening run did not perform a new live OpenAI/ChatGPT remote connection after the MCP
metadata changes. A separate earlier operator session had already established that the real ChatGPT
→ Secure MCP Tunnel → local ForgeBridge path works; another live test is still recommended to
validate the updated model-facing metadata end to end.

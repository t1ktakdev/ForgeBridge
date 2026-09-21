# Installation and packaging

ForgeBridge v0.1 is distributed as an npm-compatible tarball, not as a single executable. This is
intentional: `node-pty` contains platform-native code, Playwright manages platform-specific browser
binaries separately, and the optional Windows UI Automation helper uses Windows PowerShell and the
installed .NET UI Automation assemblies. Bundling one opaque executable would make those
dependencies harder to update and audit.

## Requirements

- Node.js 22 or newer.
- Windows 10 version 1809 or newer for ConPTY; Windows 11 is used for release validation.
- Git for Git operations.
- PowerShell 5.1 for optional Windows UI Automation.
- A supported Chromium binary. Install Playwright's pinned Chromium build after package install, or
  configure `browser.executablePath` to a reviewed local Chrome/Edge executable.

Linux and macOS support filesystem, terminal, jobs, Git, browser, MCP, and control-plane features.
Windows UI Automation reports `platform_unsupported` outside Windows.

## Public alpha install

After the npm alpha is published:

```sh
npm install --global forgebridge@next
forgebridge init --root /path/to/your/project
forgebridge doctor
forgebridge browser install
```

On Linux, use `forgebridge browser install --with-deps` when the host also needs Chromium system
libraries. The browser command resolves the Playwright version bundled with ForgeBridge instead of
asking the user to install an unrelated global Playwright version.

## Guided setup

Use `forgebridge setup` for a guided first-run flow. It creates the protected ForgeBridge state,
configuration, device identity, and local control credential, then prints connection instructions
for the clients you select. It does not silently edit Cursor/Claude configuration files and never
writes the OpenAI tunnel runtime key to ForgeBridge configuration.

```powershell
forgebridge setup
```

For scripted or managed environments, use explicit non-interactive flags:

```powershell
forgebridge setup --non-interactive --root D:\\Projects\\MyProject --local --cursor --claude --mode balanced --autonomy standard
```

Add `--chatgpt` to generate the Secure MCP Tunnel setup plan. If the tunnel already exists, pass
`--tunnel-id tunnel_...`; otherwise the generated command contains a `<TUNNEL_ID>` placeholder. The
runtime key remains environment-only and is used later by `forgebridge tunnel doctor` and
`forgebridge tunnel run`.

By default an existing ForgeBridge configuration is reused rather than overwritten. Use `--force`
only when you intentionally want setup to recreate the configuration for the selected root and
policy. The generated Windows commands are PowerShell-safe for executable and configuration paths
that contain spaces.

The client flags can be combined:

```text
--local --cursor --claude --chatgpt
```

For stdio MCP clients, a global install is optional:

```sh
npx -y forgebridge@next serve --transport stdio
```

## Build a local release artifact

From a clean checkout with the locked dependencies installed:

```powershell
pnpm install --frozen-lockfile
pnpm run package:artifact
pnpm run package:validate
```

The first command creates `release/forgebridge-VERSION.tgz`, `release/SHA256SUMS`, and a matching
CycloneDX SBOM. Packaging runs a clean production TypeScript build. Validation inspects the tarball,
checks its SHA-256 digest, installs it into a disposable prefix, runs the installed CLI, performs an
MCP stdio handshake and representative filesystem/terminal/browser calls, uninstalls it, and removes
the disposable environment. It never publishes.

The tarball contains compiled application code, declarations/source maps, the license, security and
installation documentation, changelog, and SBOM. It excludes source tests, repository metadata,
local state, browser profiles, logs, screenshots, environment files, keys, and release working
files.

The alpha workflow does not yet cryptographically sign the tarball or checksum file. Obtain
artifacts from a trusted channel and compare `SHA256SUMS`. A separate clean Windows VM repetition is
required before publishing a release candidate.

## Windows local installation

The reviewed installer accepts only a local `.tgz` path and creates no service, startup item,
scheduled task, firewall rule, or PATH entry:

```powershell
.\scripts\install-windows.ps1 -PackagePath .\release\forgebridge-0.1.0-alpha.4.tgz -InstallChromium
& "$env:LOCALAPPDATA\Programs\ForgeBridge\node_modules\.bin\forgebridge.cmd" init --root C:\Projects\MyProject
```

Omit `-InstallChromium` when using `browser.executablePath` or when browser automation is not
needed. The default state remains `%LOCALAPPDATA%\ForgeBridge`, outside the installation directory.

For a portable or developer-scoped installation on any supported platform:

```sh
npm install --prefix /chosen/forgebridge ./release/forgebridge-0.1.0-alpha.4.tgz
/chosen/forgebridge/node_modules/.bin/forgebridge --version
/chosen/forgebridge/node_modules/.bin/playwright install chromium
```

Use `playwright install --with-deps chromium` on Linux when the host needs system browser libraries.

## Optional Windows autostart

After the package and Secure MCP Tunnel profile are installed, Windows users can explicitly enable
current-user logon autostart. The runtime key is entered through a SecureString prompt and stored
DPAPI-encrypted for that Windows user; it is not placed in the task command line or tunnel profile.

```powershell
$fb = "$env:LOCALAPPDATA\Programs\ForgeBridge\node_modules\forgebridge"
& "$fb\scripts\configure-autostart-windows.ps1" `
  -TunnelClientPath "$env:LOCALAPPDATA\Programs\OpenAI\tunnel-client\v0.0.14\tunnel-client.exe" `
  -TunnelProfile forgebridge-local
```

The task runs with the current user's limited token and can be removed independently. See
[Windows autostart](autostart-windows.md) for status, rotation, removal, and security details.

## Upgrade and uninstall

Verify `SHA256SUMS` before an upgrade, retain the previous tarball for rollback, stop the running
agent, then run the installer with the new local tarball and the same installation root. Config,
identity, approvals, jobs, and audit logs remain in the separate state directory and are preserved.
Review release notes for config migrations before restarting.

Uninstalling the package removes the optional ForgeBridge scheduled task by default, but does not
silently delete keys, configuration, or audit evidence:

```powershell
.\scripts\uninstall-windows.ps1
```

Before removing state, stop ForgeBridge, run `forgebridge revoke` while the local HTTP control plane
is available, revoke the Secure MCP Tunnel runtime key in the OpenAI Platform organization, and
retain any audit records required by policy. State deletion is explicit and permanent:

```powershell
.\scripts\uninstall-windows.ps1 -RemoveState
```

The script validates that the target contains recognizable ForgeBridge state and refuses drive-root
or user-profile deletion. The package uninstall itself delegates to npm and does not recursively
delete the installation prefix, which may contain unrelated packages.

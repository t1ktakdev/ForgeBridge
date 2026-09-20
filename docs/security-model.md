# ForgeBridge security model

## Security statement

ForgeBridge is a privileged local developer tool. If a user grants arbitrary terminal execution
under their OS account, the model can exercise most of that account's authority. The permission
engine, path policy, and command checks are valuable defense in depth, but only an OS sandbox, VM,
or separate low-privilege account is a containment boundary against a malicious authorized shell.

ForgeBridge's goal is least privilege, explicit scope, strong transport identity, safe defaults,
visible approvals, bounded execution, and complete local accountability. It does not attempt
stealth, credential collection, security bypass, or access to unregistered devices.

## Trust boundaries

Trusted for v0.1:

- the local ForgeBridge binary and pinned dependencies;
- machine-level policy and device identity stored under the user's profile;
- an interactive local user approving actions;
- the OS account and OS security mechanisms used to launch the agent.

Authenticated but not intrinsically trusted:

- ChatGPT or another MCP client;
- the Secure MCP Tunnel service and tunnel client;
- an OAuth identity and bearer token;
- an Apps UI iframe.

Always untrusted data:

- model-generated arguments;
- repository files, `AGENTS.md`, README files, comments, build logs, and test output;
- web pages, accessibility trees, downloads, browser dialogs, and clipboard contents;
- filenames, symlink targets, Git refs, commit messages, and remote output;
- environment variables and child-process output.

Untrusted data cannot grant permissions, approve requests, change roots, or alter policy merely by
containing instructions.

## Identity and authentication

### Local device

First run creates:

- a random UUID device ID;
- an Ed25519 signing key;
- a human-readable device name chosen from non-sensitive OS information;
- a monotonically incremented identity format version.

The state directory and private files receive per-user ACLs on Windows and restrictive POSIX modes.
The signing key is reserved for future authenticated checkpoints or challenges; v0.1 does not yet
emit either. It is not used as a bearer token and is never returned through an MCP tool.

### MCP client

- stdio inherits authentication from the process launcher and is disabled for multi-user service
  contexts unless explicitly configured;
- loopback HTTP requires a random local bearer token and validates `Origin`;
- local control mutations additionally require a random per-process CSRF token, which rotates on
  access revocation;
- non-loopback HTTP is not configurable in v0.1;
- ChatGPT web should connect through Secure MCP Tunnel. The tunnel runtime key must have only
  Tunnels Read + Use, never broad organization administration.

Authorization is re-evaluated locally after authentication. Identity proves who is calling, not what
the caller may do.

## Transport protection

- Bind local HTTP to `127.0.0.1` and `::1` only.
- Reject unexpected Origin values with 403.
- Enforce body, header, concurrency, and duration limits before dispatch.
- Use outbound HTTPS for the official tunnel and validate the platform CA.
- Prefer the stdio tunnel profile so no local HTTP credential is placed in the tunnel profile.
- Never log Authorization, cookies, API keys, approval tokens, or private keys.
- Reject replay of approval tokens and idempotency records outside their TTL.

The official tunnel transports MCP payloads through OpenAI. Users requiring strict local-only data
flow must use stdio or loopback with a local MCP client.

## Filesystem protection

1. Normalize and reject device paths, alternate data streams, NUL bytes, and traversal before
   access.
2. Find the nearest existing ancestor and resolve it with `realpath`.
3. Verify the canonical ancestor is inside a canonical allowed root using platform-appropriate case
   rules and path separators.
4. For mutations, re-resolve immediately before open/rename and use exclusive or atomic operations
   where possible.
5. Do not follow a final symlink for destructive operations unless the policy explicitly grants link
   operations.
6. Enforce file size, count, depth, output, and time limits.
7. Require an expected content hash for patch/update unless an explicit overwrite permission was
   approved.

Default sensitive locations include common OS credential stores, private-key directories, browser
profile stores, and ForgeBridge's entire state directory even if a broad parent directory is
accidentally configured. File listing, content search, read, copy, move, upload, and mutation paths
filter or reject those locations.

## Terminal and process protection

- Spawn executables with argument arrays where the API is structured.
- Shell tools intentionally accept a command string; their risk is classified as terminal execution
  and cannot be made safe by regex blocklists.
- Working directories must be in an allowed root unless separately granted.
- Environment inheritance is filtered; secret-like variables are omitted by default and values are
  redacted in output.
- Interactive processes and jobs have random ForgeBridge handles, and kill/cancel operations resolve
  those handles to a process currently owned by this agent. v0.1 does not reattach processes by PID
  after restart.
- Timeouts and cancellations terminate the owned process tree.
- Windows child processes are created hidden. BACKGROUND and GAMING use a configurable shared
  concurrency ceiling; GAMING requests below-normal worker priority where supported.
- The structured permission surface hard-denies elevation, persistence, and security-control
  capabilities. Command classification catches common spellings for an additional approval/deny, but
  it is not a shell sandbox and must not be treated as one.
- A locally selected `trusted-local` project profile removes the repeat `repository-code` approval
  for reviewed, hash-bound project validation inside that canonical root. It does not remove a
  `destructive` classification, explicit deny/ask rules, hard denies, root capability limits, Git
  push approval, secret boundaries, or consequential browser/desktop submission approval. Repository
  content cannot enable this profile; only the authenticated local control plane can persist it.

## Git protection

- Repository paths must be allowed roots.
- Git uses no shell interpolation.
- Commit inspects the exact staged file set first. Push is separately approval-gated; scanning
  staged content would not prove that already committed history is free of secrets.
- `.env*`, common private-key formats, credential stores, and staged blobs too large to scan within
  the configured output bound are rejected.
- Common secret patterns are scanned across each bounded staged text blob and sensitive filenames;
  matches are reported by rule ID and path, never by secret value.
- Force push, destructive reset, and clean are denied through structured tools. ForgeBridge does not
  expose filter-repo or Git-configuration operations.
- ForgeBridge's own Git commands override `core.hooksPath`, disable filesystem-monitor hooks and
  repository-selected content filters/text converters, clear credential helpers, pin SSH to a
  trusted absolute executable, disable commit signing, disable the `ext` transport, and remove
  process-control Git environment variables. Authenticated network Git operations therefore require
  a separately reviewed credential strategy rather than a repository-configured helper.
- Structured Git worktree mutations suppress configured clean, smudge, and process filters. Projects
  that require Git LFS or another content filter must use an explicitly approved terminal workflow
  until ForgeBridge can broker trusted filter executables without inheriting repository commands.
- Existing Git author configuration is preserved; ForgeBridge does not forge an author or append a
  false co-author.

## Browser protection

- Isolated browser contexts are the default. Everyday user profiles and cookies are not imported
  implicitly.
- BACKGROUND and GAMING force headless Chromium and impose a configurable browser-session limit.
- Navigation policy checks the initial URL and every redirect/request origin.
- Every request and redirect is constrained by the configured origin allowlist; the default allows
  only explicit localhost origins.
- Page content is labelled untrusted. It cannot approve a tool call or change policy.
- Typing, submitting, uploading, and downloading use separate capabilities. Consequential purpose
  labels are supplied by the caller, so they are useful for policy but are not a substitute for
  treating an authorized browser client as trusted.
- Browser-side evaluation is not exposed in v0.1.
- Downloads are bounded, written under a random-prefixed new filename in an allowed directory, and
  never executed automatically.

## Secret handling

Optional Windows autostart stores only the tunnel runtime key ciphertext under the protected
ForgeBridge state directory using current-user DPAPI. The plaintext is reconstructed only inside the
hidden autostart supervisor long enough to populate the tunnel process environment and is never
written to the task command line, profile, config, or audit log. Same-user malware or an
administrator is outside that storage guarantee.

`secrets.read` is hard-denied by default. The filesystem and terminal layers also recognize
sensitive paths and secret-like environment keys so a broad read does not silently become secret
access.

The redactor combines:

- exact registered secret values;
- key-name rules (`token`, `secret`, `password`, `authorization`, and similar);
- private-key and common credential patterns;
- URL user-info removal and common bearer/cloud-token patterns.

Redaction happens before serialization to logs or tool results. Logs record the redaction rule and
count, not the removed value.

## Windows UI Automation protection

- Windows UI Automation is disabled by default and runs only after a local configuration opt-in.
- `windows_read` exposes bounded semantic element data; password values are never returned.
- `windows_act` accepts only element locators and named UI Automation control patterns. It does not
  expose arbitrary PowerShell, keystroke scripts, or mouse coordinates. A target-window-only image
  is available as visual fallback, but never drives actions.
- Desktop interaction is separately permissioned, and submit, purchase, account deletion, and
  permission-change purposes always require a fresh approval.
- `SetFocus` is classified as foreground-required. BACKGROUND and GAMING durably defer it; only the
  authenticated local control plane can approve it, and execution waits until NORMAL is selected.
- The helper records foreground-window handles around semantic actions and exposes no
  `SetForegroundWindow`, `SendInput`, coordinate, global keyboard/mouse, or clipboard operation.
- Requests are serialized as base64 JSON to a fixed helper program, so locator or value text is
  never evaluated as PowerShell source.
- Locked desktops, other user sessions, and higher-integrity processes are reported as limitations;
  ForgeBridge does not attempt to bypass Windows integrity boundaries.

## Audit and accountability

Every action that reaches authorization, including denied requests, emits an audit event. Reads of
the model-visible status resource also pass through authorization and audit. Malformed protocol
inputs are rejected by the schema or transport boundary before dispatch and are not action audit
events. Events are append-only, sequence-numbered, and hash-chained. Startup verifies the previous
records and every subsequent read reports malformed, reordered, or rewritten entries. A hash chain
alone cannot detect tail truncation or deletion; signed external checkpoints are not implemented in
v0.1.

Audit access is itself permissioned and paginated. Export may omit sensitive argument summaries.
Local deletion is a separate administrative operation and is never exposed to the AI tool surface.

## Revocation and shutdown

- Pause rejects new privileged actions but permits status, audit, and cleanup.
- Disconnect stops transports and tunnel integration without deleting state.
- Revoke rotates the local bearer token, removes session grants and pending approvals, cancels
  queued foreground actions, closes browser contexts, and instructs the operator how to revoke the
  tunnel/runtime key upstream.
- Shutdown closes browser contexts and interactive terminals. Durable jobs remain alive by default;
  explicit cleanup terminates only jobs owned by the current agent.
- Uninstall and auto-start are explicit local commands, never model tools. On Windows, optional
  logon autostart uses a current-user Scheduled Task and a DPAPI-protected tunnel runtime key; the
  normal installer creates no persistence.

## Security claims intentionally not made

- Policy rules do not contain a malicious arbitrary shell.
- A hash chain does not stop a local administrator from deleting all logs.
- Redaction cannot prove that no unknown secret format exists.
- Browser semantic automation does not make hostile websites safe.
- TLS does not make an authenticated but over-privileged client trustworthy.

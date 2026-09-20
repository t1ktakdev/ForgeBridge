# ForgeBridge architecture

Status: v0.1 implementation architecture, 2026-09-14.

## Decision summary

ForgeBridge is a local, background-by-default MCP agent with modular privileged services. It is
reachable in three ways:

1. **stdio** for local MCP clients;
2. **loopback Streamable HTTP** for local clients and an outbound tunnel;
3. **OpenAI Secure MCP Tunnel** for ChatGPT web and other supported OpenAI products without exposing
   an inbound port.

The v0.1 release does not operate a custom hosted gateway. Reimplementing an OAuth provider, device
relay, Internet edge, queue, abuse controls, key rotation, and incident response would expand the
trusted computing base without improving the local developer workflow. A vendor-neutral hosted relay
can be evaluated separately later against the then-current MCP authorization and transport
specifications.

```text
ChatGPT / supported OpenAI client
              |
              | MCP at OpenAI-hosted tunnel endpoint
              v
      OpenAI Secure MCP Tunnel
              ^
              | outbound HTTPS long-poll; optional mTLS
              |
      official tunnel-client
              |
              | stdio or loopback Streamable HTTP
              v
  +----------------------------------------+
  | ForgeBridge Agent                     |
  | MCP adapter -> authorization pipeline |
  |                 |                      |
  |  permission engine -- audit ledger    |
  |                 |                      |
  | fs terminal jobs git browser system   |
  +----------------------------------------+
              |
      explicitly allowed roots
```

For local Codex, Claude Desktop, VS Code, or other MCP clients, the upper tunnel layers are omitted
and the client starts ForgeBridge over stdio.

## Architectural invariants

1. Every privileged operation is authorized inside the local agent immediately before execution.
   Upstream OAuth, MCP annotations, and UI confirmations are additional controls, never
   replacements.
2. An approval is bound to the canonical digest of one action, subject, scope, and expiry. A model
   cannot approve its own request.
3. Paths are canonicalized against configured roots. Existing ancestors are resolved before create
   operations to block symlink and junction escapes.
4. Tool output is bounded. Large data is read through cursors or durable log offsets.
5. Long-lived work belongs to the Job Manager, not an MCP transport request.
6. External text (web pages, repository files, command output) is data, not an instruction source,
   and is marked as untrusted in results and audit entries.
7. Secrets are denied by default, redacted before logging, and never returned merely because a broad
   filesystem or environment read was requested.
8. The agent accepts only `127.0.0.1` or `::1` HTTP bindings. Remote access uses the outbound
   official tunnel client; ForgeBridge has no non-loopback listener mode.
9. Auto-start is never installed without an explicit user command.
10. The interactive desktop belongs to the user. Background and gaming profiles force headless
    browsing and durably defer focus-changing desktop actions for local approval.

## Components

### MCP adapter

Registers a compact, versioned tool surface and maps transport cancellation to an `AbortSignal`. It
handles protocol negotiation, schema validation, result shaping, annotations, resources, and
optional UI. It contains no direct OS operations.

The stable v0.1 tools are grouped by safety behavior rather than exposing one tool per syscall:

- `project_inspect`, `project_scripts`, `project_check`

- `fs_read`, `fs_write`
- `terminal`, `process`
- `jobs`
- `git_read`, `git_write`
- `browser_read`, `browser_act`
- `windows_read`, `windows_act` (optional on Windows)
- `foreground` (read-only queue and policy status)
- `system_info`
- `permissions_status`, `audit_read`

Each tool uses a discriminated `operation` input. Read and write families stay separate so MCP
annotations remain honest.

Project inspection and Git/filesystem reads are the preferred model path for ordinary development
work. `project_check` is intentionally separate from read-only discovery because a
repository-defined validation script is arbitrary executable code even when it is named `test` or
`lint`. Generic terminal execution remains available for advanced cases and keeps conservative
execution annotations.

### Authorization pipeline

All adapters call one dispatcher:

```text
schema validation
 -> canonicalize request
 -> classify capability/risk/provenance
 -> hard-deny checks
 -> scope checks
 -> policy evaluation
 -> approval validation or approval request
 -> execute with cancellation/deadline
 -> redact and bound result
 -> append audit event
```

Policy is immutable for the lifetime of one dispatched action. Reloaded policy applies to the next
action. TOCTOU-sensitive filesystem operations recheck the resolved target immediately before
mutation.

### Permission engine

The engine combines a mode, project profile, user rules, temporary grants, and hard denies. It
returns `allow`, `ask`, or `deny` plus the rule and scope that decided the result. Details are in
`docs/permission-model.md`.

### Audit ledger

Append-only JSON Lines records contain timestamps, correlation IDs, actor and session IDs, tool and
operation, redacted argument summary, policy decision, matched rule, result category, duration, and
optional error code. Runtime schemas and a hash chain detect malformed records, reordering, and
rewriting. A local attacker can still truncate the tail or delete the ledger; an external checkpoint
would be required to detect that class of tampering.

### Filesystem service

The service provides stat/list/tree/read/range/search/create/patch/move/copy/ mkdir/delete. It owns:

- allowed-root resolution and link/junction checks;
- byte, entry, depth, and search-time limits;
- UTF-8/binary detection;
- content hashes and optimistic concurrency;
- atomic replacement for full-file create/write paths;
- unified-diff application for normal edits;
- opaque continuation cursors.

Content search traverses bounded directory entries internally. Regular-expression matching runs in a
disposable worker with a hard deadline, so a pathological expression cannot block the agent event
loop. Search never resolves an executable from repository content.

### Terminal and process service

Interactive terminal sessions use ConPTY on Windows through `node-pty`, with configured selections
for PowerShell, cmd, Git Bash, and WSL. A terminal handle is random and distinct from the OS PID.
Output goes into a bounded ring buffer with monotonic byte offsets. Calls return promptly with a
handle; reads, input, resize, interrupt, and kill are separate operations.

Non-interactive short commands have strict deadlines. Process termination is tree-aware. Environment
overrides reject secret-like keys and inherited secret-valued variables are omitted. Windows child
processes use hidden/no-window creation. A shared resource governor limits concurrent terminal/job
workers, and GAMING requests below-normal worker priority where the operating system permits it.

### Job Manager

Jobs are durable records with append-only log files. The agent keeps jobs alive across MCP
disconnects. State is atomically persisted after transitions:

```text
queued -> running -> succeeded | failed | cancelled
queued | running -> interrupted (after an agent restart)
```

Each record has ID, type, timestamps, redacted command, working directory, PID, log file, exit code,
signal, and redacted metadata. On agent restart, records that were queued or running are marked
`interrupted`; ForgeBridge does not attempt unsafe PID-based reattachment. This v0.1 guarantee is
MCP reconnect durability while the agent remains alive, not daemon-crash recovery.

### Git service

Git is invoked with argument arrays and an explicit repository working directory. Read and mutation
methods are distinct. Commit checks staged filenames, bounds the complete staged blobs it scans, and
detects common secret patterns. Push is a separately approval-gated capability; it does not claim
that a staged scan covers existing commits or every secret format. The service uses the user's
configured author and never inserts synthetic authorship trailers. Reset, clean, and force push are
hard-denied through the structured tool surface.

### Browser service

Playwright Chromium is the v0.1 engine. Each ForgeBridge browser session gets an isolated,
non-persistent context. Pages have random stable handles. Actions use role/name, label, text,
test-id, or explicit CSS locators; screenshots are evidence, not the primary control plane.

The service supports navigation, semantic snapshot, tabs, click, type, press, select, hover, wait,
download, upload, screenshot, dialogs, and bounded console and network observations. Arbitrary
browser-side evaluation is not exposed. Browser transfers are size-limited, sensitive paths are
rejected, and downloads use new random-prefixed filenames inside an allowed root rather than
overwriting existing files. BACKGROUND and GAMING always force headless Chromium, even if a visible
browser is configured for NORMAL. Session count is profile-limited and each context remains
isolated.

### Windows UI Automation service

The optional Windows adapter invokes the operating system's UI Automation client APIs from a fixed,
non-interactive PowerShell helper. It discovers top-level windows and walks the control view, then
uses `Invoke`, `Value`, `Toggle`, `SelectionItem`, and `ExpandCollapse` patterns. Requests cross the
helper boundary as JSON data, not script text. Snapshots and strings are bounded, password values
are omitted, and no mouse-coordinate or arbitrary-script operation is exposed. The adapter stays
disabled by default and does not bypass locked desktops, session isolation, or integrity levels. A
bounded `PrintWindow` capture is available as visual fallback without scraping other overlapping
windows. The helper records the foreground handle around actions and never exposes coordinate or
global-input APIs. `SetFocus` is classified as foreground-required and is queued while BACKGROUND or
GAMING is active.

### Background execution and foreground queue

The execution policy has NORMAL, BACKGROUND, and GAMING profiles plus an explicit `backgroundMode`
boolean. The default is BACKGROUND. A durable queue records foreground-required requests, their
reason and estimated interruption. MCP clients can inspect it but cannot approve it; approval,
deferral, cancellation, and profile changes require the authenticated local control plane. Approved
items execute only after the user selects NORMAL. See `docs/background-execution.md`.

### Local control plane and UI

A loopback-only control API and static UI show device state, mode, roots, temporary grants, pending
approvals, jobs, and recent audit events. State-changing requests require a per-start CSRF secret
delivered only to the local launcher/browser. The Apps UI resource presents the same status and
approval request, but an approval becomes effective only after the local control plane verifies a
user-originated response.

### Device identity and state

First run generates an Ed25519 device key and random device ID. Private state is stored below the
per-user application-data directory with restrictive ACLs; future Windows releases can replace the
storage port with DPAPI/CNG without changing callers. The identity supports signing, but v0.1 does
not yet emit signed audit checkpoints or custom tunnel registration proofs. The private key is not
sent to MCP clients.

## Data locations

Defaults are outside repositories:

```text
%LOCALAPPDATA%\ForgeBridge\
  config.json
  identity.json             # private; restrictive ACL
  local-token.json          # private loopback bearer credential
  state\approvals.json
  state\jobs.json
  state\foreground-actions.json
  logs\jobs\<job-id>.log
  logs\audit.jsonl
```

Tests use an isolated temporary directory. Repository configuration may define project policy but
cannot weaken machine-level hard denies.

## Failure and reconnect behavior

- MCP disconnect aborts only request-scoped work. Terminal sessions and jobs continue while the
  ForgeBridge process remains alive.
- Browser contexts are owned by the agent and survive client reconnect while the agent is running;
  they close explicitly, on access revocation/profile changes, or when the agent shuts down. v0.1
  has no browser idle TTL.
- Mutating calls are non-idempotent unless their specific operation says otherwise. Approval IDs
  prevent replay of approved actions but are not general request-idempotency keys.
- Output cursors are monotonic. If old output was evicted, reads return an `offset_expired` error
  with the oldest available offset.
- Shutdown closes browser contexts and interactive terminals. Durable jobs remain running by default
  and are cancelled only when the caller explicitly requests job cleanup.

## Compatibility strategy

The local domain APIs do not expose SDK types. `src/mcp` owns the pinned MCP adapter and offers
capability-based behavior:

- stable tool calls always work;
- durable ForgeBridge job tools always work;
- UI resources are additive and ignored by clients without MCP Apps support.

## Repository layout

The implementation is a single TypeScript package: `src/core` and the domain folders contain the
privileged services, `src/mcp` and `src/transports` are adapters, `src/control` contains the local
and MCP Apps views, `tests` contains unit/integration/E2E coverage, and `scripts` owns packaging.

## Release boundaries

v0.1 includes filesystem, terminal/process, jobs, Git, Playwright, permissions, audit,
stdio/loopback MCP, the local control UI, and a documented Secure MCP Tunnel path. Optional Windows
UI Automation is separately permissioned and disabled by default. A ForgeBridge-operated hosted
relay is not part of v0.1.

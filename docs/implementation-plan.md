# ForgeBridge implementation plan

Each phase ends with a runnable repository and an explicit verification gate. Later phases may
tighten an earlier interface, but may not weaken a failing security test to make a build green.

## Phase 0 — research and architecture

Deliverables: research, architecture, security, permissions, threat model, and protocol documents;
version and source inventory; ADRs for transport and language.

Gate: architecture traces every v0.1 scenario through an authenticated local authorization decision
and identifies non-goals honestly.

## Phase 1 — agent foundation and identity

Deliverables: TypeScript workspace, CLI/config, state directories, Ed25519 device identity,
restrictive file permissions, lifecycle/shutdown, structured logging, health/status,
formatter/linter/typecheck/test/CI.

Gate: clean install/start/stop on Windows; identity persists; no auto-start; logs contain no
generated private material.

Current status: the local lifecycle and identity gate passes. CI runs the complete quality gate and
build on Node 22 for Ubuntu and Windows, with a separate production dependency audit job.

## Phase 2 — filesystem and permissions

Deliverables: policy parser/evaluator, approval store, scoped and temporary grants, canonical path
resolver, bounded filesystem read/search/write/patch operations, audit ledger.

Gate: unit and native tests for traversal, junction/symlink escape, optimistic concurrency, hard
deny, approval replay, large/binary files, and redaction.

## Phase 3 — terminal and processes

Deliverables: discovered shells, ConPTY sessions, run/start/input/read/resize/ interrupt/kill,
bounded output, deadlines, owned-process registry.

Gate: real PowerShell and cmd sessions on Windows; interactive input; timeout, cancellation, output
eviction, and process-tree cleanup tests.

## Phase 4 — Git

Deliverables: typed read/write Git API, staged-diff workflow, author preservation,
destructive-operation classification, secret and large-binary preflight.

Gate: integration repository proves status/diff/branch/commit and blocks credential fixtures, force
push, and unapproved mutation.

## Phase 5 — durable jobs

Deliverables: persistent records/logs, state machine, start/status/logs/list/ cancel, reconnect
behavior, restart reconciliation.

Gate: a dev-server job survives MCP disconnect; logs resume by cursor; cancel terminates the owned
tree; a simulated agent crash produces honest interrupted state.

## Phase 6 — Playwright browser

Deliverables: isolated sessions, page handles, semantic snapshots and locators, tabs, form actions,
waits, downloads/uploads/dialogs/screenshots, redirect and origin policy, teardown.

Gate: a local fixture app is opened, inspected, edited through its UI, verified, downloaded from,
and closed; external navigation and unsafe evaluation policy tests pass.

Current status: isolated browser sessions and the complete v0.1 action surface are implemented. Real
MCP calls cover bounded console/network observations, upload/download, dialog approval, and
redirect-origin enforcement. Browser-side arbitrary evaluation remains intentionally unavailable.

## Phase 7 — MCP and remote transport

Deliverables: compact versioned tool schemas, stdio and loopback Streamable HTTP, Origin/auth
limits, cancellation mapping, resources, official tunnel-client profile and operator runbook.

Gate: MCP Inspector/client calls every tool family; malformed and oversized requests fail safely;
local HTTP rejects foreign Origin; client disconnect does not kill durable jobs.

Current status: stdio and authenticated loopback Streamable HTTP are implemented. The official
Secure MCP Tunnel stdio profile has a local CLI wrapper and operator runbook. On 2026-09-15 a
user-owned least-privilege tunnel completed a live ChatGPT developer-mode connection to the Windows
agent and exercised the current semantic MCP tool surface end to end.

## Phase 8 — ChatGPT plugin/UI integration

Deliverables: status/audit/approval MCP Apps component, CSP, tool metadata and annotations,
developer-mode setup, OAuth/tunnel documentation.

Gate: UI builds independently; non-UI MCP clients still receive complete structured results; live
ChatGPT validation is recorded when operator tunnel credentials are available.

Current status: the status component uses MCP Apps metadata and bridge notifications, with ChatGPT
compatibility aliases, strict CSP metadata, and complete model-readable structured results. Live
ChatGPT validation passed on 2026-09-15 after refreshing the app manifest as `ForgeBridge v2`;
`project_inspect` was selected first and provided the complete project context in one MCP call.

## Phase 9 — Windows UI Automation

Deliverables: optional helper using Windows UI Automation element trees and control patterns,
separate permissions, and visual fallback interface.

Gate: Notepad/Calculator fixtures work semantically on an unlocked interactive desktop;
elevated/cross-user limitations are surfaced rather than bypassed.

Current status: the opt-in Windows helper exposes bounded semantic trees and UI Automation control
patterns through separately permissioned MCP tools. The native Notepad/Calculator test is gated by
`FORGEBRIDGE_NATIVE_UIA_TEST=1` because it requires an unlocked interactive Windows desktop. The
default BACKGROUND profile and conservative GAMING profile force headless browser operation, limit
configurable concurrency, keep spawned consoles hidden, and durably defer focus-changing UIA actions
for local approval.

## Phase 10 — hardening

Deliverables: dependency review, fuzz/property tests around parsers and paths, audit verification,
quotas/backpressure, update signature design, SBOM.

Gate: threat-model test matrix passes and high-severity dependency findings are resolved or
explicitly accepted with a documented mitigation.

Current status: adversarial tests cover traversal/junction escape, Git ref and hook injection,
malformed and oversized requests, secret redaction, bounded output, cancellation, connection loss,
approval replay, permission precedence, background resource limits, and durable foreground-action
deferral. `pnpm audit --prod` reported no known vulnerabilities on 2026-09-15. A deterministic
CycloneDX SBOM is generated with each package; artifact signing and external audit checkpoints are
not implemented.

## Phase 11 — end-to-end validation

Run the exact workflow against a disposable Windows fixture repository: inspect, search, patch
multiple files, test, start a dev server job, inspect localhost in the browser, patch again, view
diff, approve commit, and inspect audit events.

Gate: all twelve v0.1 Definition of Done steps pass with timestamps and command output captured in
`docs/validation.md`.

Current status: the disposable Windows workflow passes through the authenticated loopback MCP
transport, including filesystem changes, terminal tests, durable dev server, browser inspection, Git
diff, local-control approval, commit, and audit verification. Native Notepad and Calculator UIA
validation also passes. A live ChatGPT -> Secure MCP Tunnel -> ForgeBridge workflow additionally
validated one-call project discovery and hash-bound semantic project validation without terminal
fallback.

## Phase 12 — packaging and release readiness

Deliverables: npm package or signed standalone distribution, opt-in service installer,
uninstall/revoke paths, checksums/SBOM, migration notes, security reporting policy, release
checklist.

Gate: clean Windows VM install/uninstall; no implicit startup; keys and state are removed only by
explicit choice; release artifacts reproduce from tag.

Current status: the production-only TypeScript build produces an npm-compatible tarball with a
deterministic CycloneDX dependency SBOM and SHA-256 checksum. Automated validation inspects package
contents, installs the artifact into a disposable prefix, exercises the installed CLI, MCP stdio,
filesystem/search, terminal, native `node-pty`, and headless Playwright paths, then uninstalls it.
The Windows scripts install only from an explicit local tarball, create no startup entry or service,
and preserve state unless `-RemoveState` is explicitly selected. The repository-wide local audit is
recorded in `docs/release-readiness.md`; external clean-VM, artifact-signing, and independent
security-review gates remain.

## v0.1 versus later work

v0.1 must complete Phases 0–8 and 10–12 for daily web-development use. Phase 9 is deliberately
outside the v0.1 critical path. A self-hosted vendor-neutral gateway, Rust service host, DPAPI/CNG
storage backend, remote audit sink, and crash-reattachable PTY supervisor are candidates for v0.2+
and are not to be represented as v0.1 features before implementation and native validation.

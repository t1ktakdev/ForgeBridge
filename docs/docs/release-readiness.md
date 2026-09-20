# Release-readiness audit

Audit date: 2026-09-15. Target: `0.1.0-alpha.2`.

This is a source, security, documentation, and locally installed-artifact audit. It is not an
independent penetration test. Command results from the final candidate are recorded in
[`validation.md`](validation.md).

## Audit disposition

|   # | Area                         | Disposition                                                                                                                                                                                                                                                                                                                                                  |
| --: | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | Architecture                 | The privileged core, MCP adapters, local transports, and optional UIA helper remain separated. No custom public relay was added.                                                                                                                                                                                                                             |
|   2 | Permission model             | Deny-first evaluation, scoped roots, explicit modes, and project profiles have executable coverage.                                                                                                                                                                                                                                                          |
|   3 | ASK / BALANCED / FULL        | Mode defaults, `trusted-local` project autonomy, and consequential-action exceptions are tested. Trusted local validation removes repeat repository-code approval only inside the selected canonical project; an authorized shell is explicitly not an OS sandbox.                                                                                           |
|   4 | Hard denies                  | Structured elevation, persistence, credential-dump, destructive Git, browser-evaluation, and policy-management capabilities cannot be allowed by a rule or grant. An allowed shell can invoke arbitrary OS-account functionality and must be sandboxed externally when containment is required.                                                              |
|   5 | Grants                       | One-time approvals bind exact action digests. Session grants are transport-bound and cleared by pause/disconnect; temporary grants persist with expiry and use limits.                                                                                                                                                                                       |
|   6 | Approval binding             | Actor, session, capability, operation, canonical scope, arguments, and risk flags are hashed and replay-tested.                                                                                                                                                                                                                                              |
|   7 | Revoke / pause               | Pause stops new privileged actions and clears session grants. Revoke also clears all grants/approvals, cancels foreground items, closes browsers, rotates the local bearer token, and closes HTTP MCP sessions. Upstream tunnel keys require operator revocation.                                                                                            |
|   8 | Filesystem boundaries        | Existing ancestors and targets are canonicalized, configured roots are component-compared, and mutations re-resolve targets. Remaining TOCTOU risk requires handle-relative OS APIs to eliminate completely.                                                                                                                                                 |
|   9 | Links and NTFS paths         | Traversal, root-prefix confusion, symlink/junction escape, device namespaces, and alternate data streams are tested. Directory mutations scan sensitive descendants.                                                                                                                                                                                         |
|  10 | Terminal lifecycle           | Short commands have bounded output, deadlines, cancellation, hidden Windows process creation, owned-tree termination, and filtered environments.                                                                                                                                                                                                             |
|  11 | Durable jobs                 | State transitions and logs persist independently of MCP connections. Restarts mark live records interrupted; v0.1 does not reattach after an agent crash. Persisted log paths are validated.                                                                                                                                                                 |
|  12 | Git safety                   | Git uses a trusted absolute executable, structured arguments, disabled hooks/fsmonitor/content filters/text converters/signing/credential helpers, disabled `ext`, validated refs, bounded staged-blob scanning, and no synthetic authorship. Authenticated remotes need an operator-reviewed credential strategy.                                           |
|  13 | Browser origin policy        | Initial navigation, subrequests, and redirects use the configured origin allowlist. Default access is localhost-only. DNS resolution is not an OS network sandbox.                                                                                                                                                                                           |
|  14 | Redirects                    | A redirect outside policy is aborted and reported with no query or credential data in observations.                                                                                                                                                                                                                                                          |
|  15 | Uploads / downloads          | Paths are canonical and sensitive paths denied. Transfers are size-bounded; downloads use exclusive random filenames and partial files are removed on failure.                                                                                                                                                                                               |
|  16 | Browser observations         | Console and network observations are bounded, cursor-aware, provenance-labelled, and strip URL query/fragment data.                                                                                                                                                                                                                                          |
|  17 | MCP schemas / metadata       | Inputs are strict and bounded, outputs are structured, and annotations distinguish read, destructive, and open-world behavior.                                                                                                                                                                                                                               |
|  18 | MCP Apps UI                  | The bundled component is read-only, uses text-only DOM rendering, declares a no-network CSP, and leaves approvals to the local control plane.                                                                                                                                                                                                                |
|  19 | HTTP transport               | Binding is restricted to loopback, bearer authentication precedes MCP/control access, Host and Origin are checked, request sizes/concurrency are bounded, and MCP sessions are explicit.                                                                                                                                                                     |
|  20 | stdio transport              | It uses the official MCP SDK transport and clears session grants on close. Durable jobs are not coupled to transport lifetime.                                                                                                                                                                                                                               |
|  21 | Secure MCP Tunnel            | Only the official outbound tunnel client workflow is integrated. Runtime keys are environment-only and filtered from the spawned MCP process. A live ChatGPT developer-mode connection over the official tunnel was validated on 2026-09-15.                                                                                                                 |
|  22 | CSRF / bearer credentials    | Mutations require a per-start CSRF token in addition to the local bearer token. Token comparison is timing-safe and revocation rotates both credentials.                                                                                                                                                                                                     |
|  23 | Secret redaction             | Structured keys, bearer/JWT/private-key text, OpenAI/GitHub/AWS patterns, URLs, job output, tool results, and audit arguments are covered. Unknown formats remain residual risk.                                                                                                                                                                             |
|  24 | Audit integrity              | Runtime schemas and a hash chain are verified at startup and on every read. Writes are serialized. Tail deletion still needs an external signed checkpoint to detect.                                                                                                                                                                                        |
|  25 | Windows UI Automation        | The optional helper uses UIA control patterns and bounded semantic trees. It exposes no coordinate, global input, clipboard, or arbitrary-script operation.                                                                                                                                                                                                  |
|  26 | Native Windows tests         | Opt-in Notepad/Calculator and background fixtures exercise real controls on an unlocked desktop and verify foreground-handle, cursor, clipboard-sequence, hidden-console, and headless-browser behavior.                                                                                                                                                     |
|  27 | Malicious content boundaries | Repository, process, web, and desktop outputs carry explicit untrusted provenance. Repository-local Git executable/config execution paths are constrained.                                                                                                                                                                                                   |
|  28 | Oversized output             | File, process, job, browser observation/transfer, UIA, HTTP, and Git paths have explicit bounds or truncation behavior. A single oversized terminal chunk is tail-bounded without first retaining the discarded prefix.                                                                                                                                      |
|  29 | Malformed requests           | Strict Zod schemas, HTTP JSON handling, cursor validation, audit schemas, and state schemas fail closed.                                                                                                                                                                                                                                                     |
|  30 | Cancellation / cleanup       | MCP cancellation terminates request-owned process trees; a native child-PID test verifies descendants are gone before success is reported. Browser and terminal cleanup are explicit; jobs survive disconnect by design and can be cancelled separately.                                                                                                     |
|  31 | Reconnect / restart          | Transport reconnect does not own durable jobs. Temporary grants restore within expiry/use bounds; session grants do not. Live process reattachment is not implemented.                                                                                                                                                                                       |
|  32 | Packaging / uninstall        | A production npm tarball is installed into a disposable prefix and exercises stdio/HTTP MCP, filesystem mutation, terminal/PTY, Git, durable jobs, browser, audit, background policy, and uninstall. The default installer creates no startup entry; optional Windows logon autostart is a separate explicit action and is removable without deleting state. |
|  33 | CI                           | Ubuntu and Windows jobs run the full quality gate, browser setup, dependency audit, build, and installed-artifact validation. Native interactive UIA remains a manual release gate.                                                                                                                                                                          |
|  34 | Documentation                | Architecture, security, permissions, background behavior, tunnel operations, installation, and validation documents were reconciled with implementation.                                                                                                                                                                                                     |
|  35 | README claims                | The README states pre-release status and current limitations. Live tunnel validation is recorded as a bounded validation result, not a compatibility guarantee; no OS-sandbox claim is made.                                                                                                                                                                 |
|  36 | Security policy              | `SECURITY.md` documents safe operation and the absence of an established private disclosure channel.                                                                                                                                                                                                                                                         |
|  37 | Changelog                    | Unreleased behavior and security hardening are recorded without fabricated adoption or performance claims.                                                                                                                                                                                                                                                   |
|  38 | Version consistency          | Package and CLI versions are checked automatically; the current version is `0.1.0-alpha.2`.                                                                                                                                                                                                                                                                  |
|  39 | Licenses / dependencies      | Production dependencies are represented in the CycloneDX SBOM and checked by `pnpm audit --prod`; the package does not vendor their source trees.                                                                                                                                                                                                            |
|  40 | Secrets / local data         | Package allowlists and artifact inspection exclude source tests, `.env*`, private keys, state, logs, browser profiles, screenshots, Git metadata, and release work files.                                                                                                                                                                                    |
|  41 | Torture workload             | A disposable frontend/backend repository covers multi-file and concurrency fixes, stale-patch reconciliation, live browser confirmation, reconnect-safe jobs, hostile content, hostile Git hooks, large/binary files, path escapes, diff review, and local commit.                                                                                           |
|  42 | Short soak                   | Repeated MCP reads, terminals, durable jobs, browser contexts/snapshots, and reconnects complete with resource counters returned to zero and RSS growth below the automated guard. This is leak-oriented evidence, not a throughput benchmark.                                                                                                               |

## Findings fixed during this audit

- Protected state nested under an allowed root could be reached indirectly through directory
  operations and searches. Sensitive descendants are now filtered or rejected consistently.
- Filesystem content search previously depended on executable resolution and then used an event-loop
  regular expression implementation. It now uses bounded traversal and deadline-enforced worker
  isolation.
- Large file reads allocated bounded output but hashed by reading the whole file into memory; hashes
  now stream through the already-open handle, and patch input is size-limited.
- Audit reads parsed records but did not re-check the chain after startup. Every read now verifies
  schema, ordering, and hashes.
- Browser downloads and screenshots could overwrite caller-selected files or leave partial output.
  New files are created exclusively and failures clean up partial artifacts. UIA screenshot export
  uses the same no-clobber rule.
- Git accepted an unvalidated branch start point and inherited repository-controlled helper paths.
  Refs are validated, staged blobs are addressed by object ID, and executable Git configuration,
  including clean/smudge/process filters and diff text converters, is overridden for agent-owned
  operations.
- Windows terminal/job launchers used PATH or `ComSpec` for several shells. Built-in launchers now
  use absolute system/install paths; optional overrides must be existing absolute files.
- Persisted job records could name a log outside the state log directory. Initialization now rejects
  that state.
- Audit, job, and approval persistence ordering was tightened to avoid stale concurrent writes or
  lost initial transitions.
- Cloud credential and agent-socket variables were added to environment filtering and redaction.
- Audit pagination previously materialized the entire ledger before slicing. Reads now stream a
  bounded page while continuing to verify every record in the chain.
- A single oversized process-output chunk could cause transient retention well above the configured
  output limit. The ring buffer now retains only the bounded tail.
- A disconnected Chromium process left its manager instance unusable. Browser launch now discards
  stale sessions and starts a fresh process after disconnect.
- Malformed partial job state and HTTP bind failures surfaced inconsistent low-level errors. They
  now produce stable structured errors, with occupied ports marked retryable.

## External gates and residual limitations

- Live Secure MCP Tunnel and ChatGPT developer-mode validation passed on 2026-09-15 using the
  operator-owned tunnel and a least-privilege runtime key. The refreshed `ForgeBridge v2` app
  exposed all 19 tools; ChatGPT selected `project_inspect` first, then completed a hash-bound
  `project_check` workflow and a final semantic Git status without terminal fallback. This is one
  verified product/workspace configuration, not a guarantee for every ChatGPT deployment.
- The package workflow was validated in disposable environments on this Windows host and in CI
  configuration. A separate clean Windows VM installation/uninstallation run is still required by
  the release gate.
- Release artifacts have SHA-256 checksums and an SBOM but are not cryptographically signed.
- Audit chains have no external signed checkpoints or remote sink, so deletion or tail truncation by
  the local account/administrator is not detectable.
- Structured Git operations suppress content filters to prevent repository-selected command
  execution. Projects that require Git LFS or custom filters need an explicitly approved terminal
  workflow.
- ForgeBridge has not received an independent security assessment, and a private vulnerability
  disclosure channel must be established before a public alpha.
- UI Automation cannot guarantee that a third-party application will never surface itself after a
  semantic pattern call. Keep it disabled or use GAMING when any desktop interruption is
  unacceptable.

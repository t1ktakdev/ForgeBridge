# Windows validation record

## 2026-09-14 local release-candidate run

Environment:

- Microsoft Windows 11 Pro, version 10.0.26200, build 26200, 64-bit
- Node.js 24.18.0
- pnpm 11.22.0
- Git for Windows 2.55.0
- Base packaging checkpoint: `20a15bf358354a247d35020b9e88982f80ba96e4`
- Torture/hardening checkpoint: `f01e7e7c3a20519fa0a6a3de8904a836d056f5ae`

Validated flows:

- An official MCP TypeScript SDK client connected over ForgeBridge's authenticated loopback
  Streamable HTTP transport.
- The client listed and searched a disposable Git repository, patched multiple files with content
  hashes, and ran the repository test through the terminal tool.
- A durable dev-server job started, served localhost, and remained independently managed.
- A Playwright session navigated to the service, read its semantic snapshot, observed the changed
  page, and closed cleanly.
- The client inspected Git status and diff, staged changes, obtained a one-time approval through the
  authenticated CSRF-protected local control endpoint, and created a local commit.
- The final audit query contained the approval request and successful Git operation.
- The opt-in native UI Automation fixture edited Notepad with `ValuePattern`, captured the target
  window as a PNG, invoked Calculator buttons by automation ID, and required a fresh approval for
  the consequential action. No coordinates or arbitrary input script were used.
- The background-safety fixture held Notepad as the foreground application while ForgeBridge ran a
  filesystem write, hidden terminal command, durable job, Git operation, headless Chromium session,
  and non-activating UIA value change. The foreground handle remained unchanged and no browser or
  console window appeared; the cursor position and clipboard sequence number also remained
  unchanged. A focus request was durably deferred in GAMING, remained queued after approval, and
  completed only after the local profile changed to NORMAL.
- A disposable multi-directory frontend/backend repository reproduced a browser-visible rendering
  defect and a concurrent lost-update defect. ForgeBridge rejected a stale patch, applied reconciled
  fixes, passed the unit/integration tests, verified the UI through Chromium, created a local
  commit, suppressed a hostile pre-commit hook, and retained a durable dev-server job across MCP
  reconnect.
- The same torture fixture treated hostile README, AGENTS, source-comment, and page text as
  untrusted content; bounded a 1.5 MB log read; identified a binary file without text-decoding it;
  and rejected traversal and Windows-junction escapes.
- Failure injection verified recovery after a disconnected Chromium instance, a crashed job,
  malformed persisted job records, an occupied HTTP port, malformed requests, cancellation, and
  oversized output. Process-tree cancellation recorded the spawned child PID and verified that it no
  longer existed after cancellation.
- A short MCP soak made 100 filesystem calls, 12 terminal calls, four durable jobs, 25 browser
  snapshots across five fresh browser sessions, and five MCP reconnects. All resource-governor
  counters returned to zero and observed RSS growth remained below the test's 256 MiB guard.
- A graceful agent restart preserved the device identity, configuration and project profile,
  completed job metadata/logs, audit chain, and a bounded temporary grant. A session-only grant was
  discarded, and the restored temporary grant stopped authorizing after its persisted use limit.

Commands and observed results:

```text
pnpm run check
Test Files  26 passed | 2 skipped (28)
Tests       93 passed | 2 skipped (95)

pnpm run test:e2e
Test Files  6 passed | 2 skipped (8)
Tests       8 passed | 2 skipped (10)

$env:FORGEBRIDGE_NATIVE_UIA_TEST='1'; pnpm run test:e2e:native
Test Files  8 passed (8)
Tests       10 passed (10)

pnpm audit --prod
No known vulnerabilities found

pnpm run sbom:check
Result: passed

pnpm licenses list --prod --json
Observed license groups: Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT
```

Packaging validation used the generated artifact, not imports from the source checkout:

```text
pnpm run package:artifact (two consecutive runs)
Result   byte-for-byte reproducible
Digest   recorded in release/SHA256SUMS (not embedded here, because this document is in the artifact)

pnpm run package:validate
CLI version         passed
MCP stdio           passed
authenticated HTTP  passed
filesystem read/write passed
content search      passed
terminal call       passed
node-pty call       passed
Git status          passed
durable job/logs    passed
headless Playwright passed
audit read          passed
background profile passed
official tunnel-client binary/version passed
npm uninstall       passed
Windows installer   passed
state preservation  passed
explicit removal    passed
```

The inspected tarball contained only the declared production build, declarations/source maps,
license, README, changelog, project documentation, Windows scripts, package manifest, and CycloneDX
SBOM. It contained no source tests, repository metadata, local state, `.env` files, or key files.

The two skipped default tests are the native UI Automation and background-focus fixtures. They are
intentionally opt-in because a headless runner cannot prove desktop availability.

## 2026-09-15 live ChatGPT and Secure MCP Tunnel validation

A user-owned Secure MCP Tunnel connected ChatGPT developer mode to the disposable Windows checkout.
The original app entry retained an older tool snapshot, so it was refreshed as `ForgeBridge v2`. The
refreshed app exposed all 19 current tools. In the first live model-first test, ChatGPT called
`project_inspect` first and used that single call to recover project root, language/runtime/package
manager, validation tooling, Git state, OS, and shell without terminal fallback.

A second live workflow resolved the reviewed `check` plan and its exact `planSha256`, requested the
expected local approval, retried the identical `project_check`, and completed with exit code 0. The
live check ran `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`, after which semantic
`git_read` reported `## master`. No terminal call or package installation was used by ChatGPT in
these validation flows.

The official Windows tunnel client `0.0.14+0f870e50a973fa820d4c409000059e181e8d242b` was also
version/checksum verified locally. A separate clean Windows VM run, artifact signing, and
independent security review remain release gates; live ChatGPT/tunnel connectivity is no longer an
untested gate for this configuration.

## 2026-09-15 alpha.2 final local candidate

The alpha.2 candidate incorporated the live Auralis site-building workload and reduced model-facing
schema ambiguity without widening the security boundary. Filesystem mutation gained an optimistic
whole-file update operation, browser reads gained direct console/network operations, semantic key
presses may target a locator, and jobs/browser descriptions now include canonical argument guidance.

The same candidate added opt-in Windows logon autostart for the packaged Secure MCP Tunnel. The
default installer still creates no startup entry. The separate autostart configurator creates a
limited current-user scheduled task and stores the least-privilege tunnel runtime key encrypted by
Windows DPAPI for that user. A disposable package install created and removed a test scheduled task,
verified its hidden runner/action arguments, and removed the DPAPI test credential successfully.

Final observed local results:

` ext pnpm run check Test Files 30 passed | 2 skipped (32) Tests 132 passed | 2 skipped (134)

FORGEBRIDGE_NATIVE_UIA_TEST=1 pnpm run test:e2e:native Test Files 9 passed (9) Tests 29 passed (29)

pnpm audit --prod No known vulnerabilities found

pnpm run sbom:check Result: passed

pnpm licenses list --prod --json Observed license groups: Apache-2.0, BSD-2-Clause, BSD-3-Clause,
ISC, MIT

pnpm run package:artifact (two consecutive runs) Result: byte-for-byte reproducible Artifact:
release/forgebridge-0.1.0-alpha.2.tgz SHA-256:
e73a612ceacea388a388fdbd8629b59248608e2d1a3cfdf87b0401109a3ff953

pnpm run package:validate project passed stdioApproval passed trustedLocal passed mcp passed http
passed filesystem passed terminal passed pty passed git passed jobs passed browser passed audit
passed background passed tunnelClient binary verified uninstall passed windowsInstaller passed `

The default test command now uses a 30-second per-test bound with file-level serialization. This
removes previously observed five-second load flakes in Git/restart integration tests while retaining
timeouts and deterministic cleanup. No test failure was hidden: the previously flaky tests pass in
the serialized full gate and independently.

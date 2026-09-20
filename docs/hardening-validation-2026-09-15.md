# Model-UX hardening validation - 2026-09-15rdening validation вЂ” 2026-09-15

This record covers the disposable Windows hardening checkout after the model-first MCP and Secure
MCP Tunnel changes. It supplements the earlier Windows release-candidate record in `validation.md`.

## Environment

- Windows 11 Pro, kernel release `10.0.26200`, x64
- Node.js `v24.18.0`
- pnpm `11.22.0`
- Package `forgebridge@0.1.0-alpha.2`
- Validation checkout: `D:\Projects\ForgeBridge-hardening-20260914\ForgeBridge`

Dependencies were repaired before source changes with an offline frozen install:

```text
pnpm install --offline --frozen-lockfile --ignore-scripts
Result: passed; lockfile already up to date
```

## Baseline before the remaining hardening edits

```text
pnpm format:check     passed
pnpm lint             passed
pnpm typecheck        passed
pnpm test
  Test Files 29 passed | 2 skipped (31)
  Tests      127 passed | 2 skipped (129)
pnpm build            passed
pnpm test:e2e:native
  Test Files 7 passed | 2 skipped (9)
  Tests      26 passed | 2 skipped (28)
FORGEBRIDGE_NATIVE_UIA_TEST=1 pnpm test:e2e:native
  Test Files 9 passed (9)
  Tests      28 passed (28)
```

The opt-in native run exercised semantic Notepad and Calculator UI Automation plus the
background-safety fixture that checks foreground window, cursor, clipboard sequence, hidden worker
behavior, and deferred foreground actions.

## Final source validation

```text
pnpm check
  format check: passed
  lint:         passed
  typecheck:    passed
  Test Files    30 passed | 2 skipped (32)
  Tests         132 passed | 2 skipped (134)

pnpm test:unit
  Test Files 15 passed (15)
  Tests      68 passed (68)

pnpm test:integration
  Test Files 8 passed (8)
  Tests      37 passed (37)

pnpm test:e2e
  Test Files 7 passed | 2 skipped (9)
  Tests      27 passed | 2 skipped (29)

FORGEBRIDGE_NATIVE_UIA_TEST=1 pnpm test:e2e:native
  Test Files 9 passed (9)
  Tests      29 passed (29)
```

The model-workflow suite covers one-call project context, reviewed validation plus approval retry,
ASK-mode approval collection, explicit `trusted-local` validation without repeat approval,
manifest-plan binding, exact delete approval, terminal deletion-bypass rejection, path
traversal/junction/ADS/state protection, malicious repository text, bounded malformed/oversized
manifests and output, timeout cleanup, schema/tool-choice contracts, Windows PowerShell `&&`
diagnosis, and no implicit package lifecycle hooks. Existing integration/torture coverage
additionally exercises hostile Git hooks/filter/textconv configuration, browser boundaries,
malformed durable state, grant exhaustion/persistence, process-tree cancellation, audit integrity,
and resource soak behavior.

## Secure MCP Tunnel validation

The installed verified Windows client reported:

```text
0.0.14+0f870e50a973fa820d4c409000059e181e8d242b
```

`node scripts/validate-tunnel.mjs <verified-tunnel-client.exe>` created isolated temporary profiles
with spaced paths and exercised both packaged and development launch forms. Results:

```text
packaged:    profileCreated=true, ephemeralHealth=true, initAccepted=true
development: profileCreated=true, ephemeralHealth=true, initAccepted=true
runtimeCredentialsUsed=false
liveTunnel=not-run
```

The generated profile uses `127.0.0.1:0` for the loopback health listener. Unit tests independently
round-trip Program Files paths, configuration/state paths with spaces, backslashes, forward slashes,
Unicode and quotes through the tunnel client's command grammar and reject malformed tunnel IDs.

No runtime key value was written to a file, CLI argument, or validation output. A live ChatGPT
developer-mode connection over the operator-owned Secure MCP Tunnel was then refreshed as
`ForgeBridge v2`. The refreshed app exposed all 19 tools, selected `project_inspect` first, and
completed a hash-bound `project_check` plus semantic Git status without terminal fallback.

## Package and installed-artifact validation

Two consecutive package builds were byte-for-byte identical:

```text
artifact: release/forgebridge-0.1.0-alpha.2.tgz
SHA-256: recorded in `release/SHA256SUMS` (not embedded here because this document is packaged)
```

`pnpm package:validate` ran against the tarball rather than source imports and reported:

```text
project          passed
stdioApproval    passed
trustedLocal     passed
mcp              passed
http             passed
filesystem       passed
terminal         passed
pty              passed
git              passed
jobs             passed
browser          passed
audit            passed
background       passed
tunnelClient     binary verified
uninstall        passed
windowsInstaller passed
```

The tarball contains the compiled production build, declarations/source maps, documentation,
license/readme/changelog/security files, Windows install scripts, package manifest, and CycloneDX
SBOM. Source tests, Git metadata, local state, environment files, and credentials are not included.

## Dependency, SBOM, license, and secret checks

```text
pnpm sbom:check                   passed
pnpm audit --prod                 No known vulnerabilities found
pnpm licenses list --prod --json  passed
```

Observed production license groups: Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT.

`gitleaks` and `trufflehog` were not installed on this Windows host, so no external secret-scanner
result is claimed. ForgeBridge's own Git commit preflight remains part of local commit validation
and tests cover sensitive filenames plus secret-like added lines.

## Model-task performance

`node scripts/benchmark-model-ux.mjs final .validation-tmp/benchmark-final.json` used in-memory MCP
transport with real disk, audit, and Git operations. Eleven samples were taken per operation and
warm medians exclude the first sample.

```text
permissions_status   1.46 ms median
fs_read              1.79 ms median
git_read status    103.72 ms median
system_info           2.12 ms median (220.28 ms first probe)
project_inspect     121.86 ms median
project_scripts       4.29 ms median
```

A same-build task proxy compared the pre-semantic five-call discovery pattern (`permissions_status`,
`system_info`, manifest read, tree, Git status) with one `project_inspect` call:

```text
legacy multi-call:       5 calls, 7733 response bytes, 129.12 ms median
semantic project_inspect: 1 call, 5505 response bytes, 132.26 ms median
```

This is intentionally not presented as an internal CPU speedup: fresh Git status dominates both
paths and the one-call local median was slightly slower. The measured improvement is an 80%
reduction in MCP call count and about 29% less structured response data for the discovery task.
Remote ChatGPT/model reasoning and network latency are excluded from this benchmark, so no
fabricated end-to-end latency number is reported.

## Remaining external validation

The live ChatGPT to Secure MCP Tunnel to updated ForgeBridge path passed for the recorded Windows
configuration. Remaining external gates are a second clean Windows VM install/uninstall run,
artifact/code-signing validation, an independent third-party security review, and a private
vulnerability disclosure channel before public alpha. The live result is evidence for this tested
product/workspace configuration, not a universal compatibility guarantee.

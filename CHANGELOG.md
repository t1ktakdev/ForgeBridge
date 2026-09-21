# Changelog

All notable changes are recorded here. ForgeBridge follows Semantic Versioning after v0.1.

## [Unreleased]

No changes yet.

## [0.1.0-alpha.4] - 2026-09-21

### Added

- Guided `forgebridge setup` onboarding for local MCP clients and Secure MCP Tunnel planning without
  persisting tunnel runtime credentials.
- Local device management with persistent device naming, runtime health metadata, CLI
  list/status/ping/rename/revoke commands, and Control Center device controls.
- A redesigned routed Control Center with Overview, Projects, Devices, Jobs, Sessions, Approvals,
  Audit, and Settings views, persistent RU/EN localization, theme controls, search/filtering,
  responsive layouts, and product-quality motion.
- Real Control Center lifecycle actions for cancelling durable jobs, stopping terminal sessions,
  closing browser sessions, revoking grants, and handling foreground actions.
- In-chat approval UX improvements for MCP Apps, including preserved capability metadata for secure
  confirmation flows.

### Fixed

- Canonical filesystem and repository policy scopes now match the same physical paths enforced by
  the filesystem guard.
- Durable jobs finalize completion only after output is flushed, preventing stale running states.
- macOS package installation repairs the executable bit on the published node-pty spawn helper.
- Git network operations preserve reviewed credential helpers while repository-controlled hooks,
  filters, prompts, and unsafe transports remain disabled.
- Cross-platform release tooling now supports Registry-only recovery, stable pnpm invocation, and
  deterministic package/SBOM validation.
- Control Center regression coverage now validates generated browser JavaScript syntax and
  authenticated lifecycle actions.

## [0.1.0-alpha.3] - 2026-09-20

### Added

- Public npm package identity and one-command install path for `forgebridge`.
- MCP Registry metadata in `server.json` for `io.github.t1ktakdev/forgebridge`.
- Tag-driven GitHub Actions publishing workflow prepared for npm Trusted Publishing/OIDC and MCP
  Registry publication.
- `forgebridge doctor` for first-run diagnostics and actionable setup guidance.
- `forgebridge browser install [--with-deps]` to install ForgeBridge's pinned Playwright Chromium.
- Public-alpha release runbook and quick-start documentation.

### Fixed

- Release artifact naming and installed-package validation no longer hardcode a package directory
  and support both scoped and unscoped npm names.
- Text redaction preserves safe permission literals such as GitHub Actions id-token: write while
  still redacting real token assignments.
- Packaged artifact validation checks that npm, CLI, SBOM, and MCP Registry identities/versions stay
  synchronized.
- CI and release workflows use pnpm/setup@v2.

## [0.1.0-alpha.2] - 2026-09-15

### Added

- Research, architecture, permission, security, and threat-model baselines.
- Initial TypeScript project and quality-gate configuration.
- ASK, BALANCED, and FULL policy behavior with persistent per-project mode profiles.
- Session and expiring temporary grants with use limits and local revocation.
- CSRF-bound pause, mode, approval, project-profile, grant-revocation, and access-revocation
  controls.
- MCP Apps-standard tool/resource metadata, output schemas, server instructions, and a read-only
  status, approval, grant, job, and audit component.
- A least-privilege wrapper and operator runbook for the official OpenAI Secure MCP Tunnel client.
- Background-by-default and GAMING execution profiles with forced headless browsing, hidden worker
  processes, configurable concurrency limits, and durable local approval for foreground actions.
- Reproducible npm-compatible release artifacts with a CycloneDX production SBOM, SHA-256 checksums,
  clean-install MCP smoke testing, and explicit Windows install/uninstall scripts.
- Model-first project inspection that reports bounded manifest/language/runtime/package-manager,
  validation, Git, OS, shell, and permission-root context without executing repository content.
- Reviewed project validation plans with command hashes and fresh approval for repository-defined
  `test`, `lint`, `typecheck`, `build`, and `check` scripts.
- Explicit per-project `trusted-local` autonomy for reviewed repository-code execution without
  repeat approval, while preserving destructive, push, elevation, persistence, secret, submit, and
  scope boundaries.
- Structured model-readable approval and denial details, including the blocker, capability, scope,
  approval IDs, allowed responses, expiry, retryability, and next action.
- Explicit Windows shell metadata and diagnostic errors for Windows PowerShell syntax mismatches.
- Native Secure MCP Tunnel profile validation for packaged and development CLIs, including paths
  with spaces and an ephemeral loopback health listener.
- Safe ecosystem evidence for Python, Rust, Go, .NET, and Java in addition to Node/TypeScript.

- A disposable multi-directory torture lab and short resource soak covering multi-file debugging,
  concurrency, stale writes, hostile content, MCP reconnects, browser interaction, path escapes,
  hostile Git hooks, process-tree cleanup, and bounded resource reuse.
- Installed-artifact validation for filesystem mutation, Git, durable jobs and logs, audit reads,
  background policy, authenticated HTTP, and the optional official tunnel-client binary.
- Opt-in Windows logon autostart for the packaged tunnel using a limited current-user scheduled task
  and a DPAPI-protected least-privilege runtime key, with explicit removal and rotation scripts.
- Model-facing filesystem/browser ergonomics from the live site-building torture test: optimistic
  whole-file `fs_write update`, direct console/network browser reads, locator-targeted key presses,
  and clearer canonical argument guidance for jobs and browser operations.

### Security

- Protected ForgeBridge state and common credential paths are excluded from filesystem reads,
  searches, transfers, and ancestor-directory mutations.
- Content-search regular expressions execute behind a deadline in a disposable worker, and large
  file hashes stream without bypassing read bounds.
- Audit chains are schema- and hash-verified on every read; approval and job persistence is
  serialized.
- Terminal deletion attempts are rejected rather than becoming a bypass for exact filesystem-delete
  approval.
- Repository-defined validation remains arbitrary code. Standard projects require a fresh exact
  approval; only a locally configured `trusted-local` project can skip the repeat repository-code
  approval, while destructive classification and other consequential boundaries still apply.
- Tunnel MCP commands use the official client's argument grammar instead of Windows shell quoting;
  runtime tunnel credentials remain environment-only.
- Stdio agents expose only non-secret loopback control endpoint metadata so local approval commands
  can reach the running process without weakening authentication.
- Git disables repository-controlled hooks, filesystem monitors, content filters, text converters,
  credential helpers, signing, and extended transports for agent-owned commands, and validates every
  ref-like argument.
- Browser and Windows UI screenshots use no-clobber output semantics; failed transfers remove
  partial files.
- Windows process launchers use trusted absolute executable paths rather than repository-influenced
  PATH or `ComSpec` resolution.
- Audit reads stream bounded pages while verifying the full chain, oversized process chunks retain
  only their bounded tail, and disconnected Chromium processes recover with fresh sessions.
- Malformed persisted job state and loopback HTTP bind failures return stable structured errors.

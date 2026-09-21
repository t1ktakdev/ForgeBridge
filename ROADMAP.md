# ForgeBridge Road to 1.0

> **Current release:** `v0.1.0-alpha.4`  
> **Next milestone:** `v0.2.0-beta.1`  
> **Estimated v1.0 readiness:** **≈68%**

ForgeBridge is actively developed. This roadmap is intentionally conservative: a capability counts
as "ready" only when it has a real implementation, tests, documentation where needed, and a release
path.

The percentage is a **weighted engineering milestone estimate**. It is not a quality score, SLA,
release date, or promise that the remaining work has equal difficulty.

## How the 68% estimate is calculated

| Milestone                                                     |   Weight | Current readiness | Contribution |
| ------------------------------------------------------------- | -------: | ----------------: | -----------: |
| Core local agent and execution model                          |      20% |              100% |        20.0% |
| Permissions, approvals, audit and local security boundaries   |      15% |               90% |        13.5% |
| Control Center and onboarding UX                              |      15% |               85% |        12.8% |
| Packaging, CI, npm, MCP Registry and release artifacts        |      10% |               90% |         9.0% |
| Update / repair / recovery lifecycle                          |      10% |               45% |         4.5% |
| Public API stability, migrations and deprecations             |      10% |               40% |         4.0% |
| Multi-device / remote routing                                 |      10% |               20% |         2.0% |
| Compatibility matrix and independent production security gate |      10% |               20% |         2.0% |
| **Estimated total**                                           | **100%** |                   |     **≈68%** |

This estimate is updated at public release milestones rather than after every commit.

## Shipped today

The following areas are already implemented and exercised in the public alpha:

- local device identity and permissioned execution;
- canonical filesystem boundaries and policy enforcement;
- semantic project inspection and project-defined validation;
- filesystem read/search/write/patch operations;
- Git read/write workflows with protected mutation paths;
- terminal/PTY and durable jobs;
- isolated browser automation;
- approvals, temporary grants and redacted audit logging;
- stdio and authenticated loopback MCP transports;
- Secure MCP Tunnel integration and operator runbooks;
- guided setup and local device management;
- Control Center with Overview, Projects, Devices, Jobs, Sessions, Approvals, Audit and Settings;
- English/Russian localization and dark/light themes;
- Windows/macOS/Linux CI;
- npm package validation from the actual release tarball;
- SHA-256 checksums and deterministic CycloneDX SBOM;
- npm prerelease publication and MCP Registry publication.

## Next: v0.2.0-beta.1

The first beta should focus on product infrastructure rather than adding dozens of new tools.

### 1. Multi-device foundation

Planned work:

- known-device directory;
- online/offline and last-seen state;
- selected/active device;
- safe routing abstraction;
- local route as the first concrete route;
- remote route boundary without fake connectivity;
- device selection in the Control Center;
- permission checks that bind operations to the addressed device.

A real remote coordinator or hosted cloud service is **not** required for the first beta.

### 2. Update, repair and recovery

Target UX:

```text
forgebridge update --check
forgebridge update
forgebridge repair
forgebridge doctor
```

Goals:

- preserve user state and configuration during updates;
- validate the newly installed version before switching to it;
- provide rollback/recovery after an interrupted or corrupt update;
- detect damaged installs and missing runtime dependencies;
- show lifecycle state in the Control Center.

### 3. First compatibility freeze

Before beta, public surfaces should be classified as:

- **stable**
- **beta**
- **experimental**
- **deprecated**

This includes MCP tool schemas, CLI commands, configuration format, permission semantics and the
local Control API.

## Beta hardening

After `0.2.0-beta.1`, the focus moves from major product blocks to compatibility and failure
behavior.

Expected beta work:

- config/schema migration paths;
- deprecation warnings with replacements;
- upgrade testing from alpha and earlier beta builds;
- network interruption and reconnect behavior;
- corrupt state and partial-install recovery;
- PowerShell 5.1/7 coverage;
- Chrome/Chromium variation testing;
- larger audit/job datasets;
- Control Center accessibility and keyboard polish;
- better live activity/log viewers and pagination.

## 1.0 release candidate gate

ForgeBridge should not become `1.0.0` only because the feature list looks complete.

A `1.0.0-rc.1` should require:

- clean Windows install/update/uninstall validation;
- Linux and macOS real-host validation;
- no critical permission bypass, path traversal, symlink/junction escape or secret-leak findings;
- update rollback and repair validation;
- public API inventory and migration policy;
- artifact provenance/signing strategy;
- independent security review or an equivalent external review pass;
- complete troubleshooting and support-policy documentation;
- no known release-blocking regressions.

## Release ladder

| Release            | Goal                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| ✅ `0.1.0-alpha.4` | Public alpha with polished Control Center, onboarding, device management and release pipeline |
| 🟡 `0.2.0-beta.1`  | Multi-device foundation, update/repair lifecycle, first compatibility freeze                  |
| ⏭ `0.2.0-beta.2+`  | Compatibility, failure recovery, UX and security hardening                                    |
| ⏭ `1.0.0-rc.1`     | Production validation candidate; no major new features                                        |
| 🎯 `1.0.0`         | Stable public API and documented support contract                                             |

## What is intentionally not promised yet

The following ideas may happen after 1.0 or in a later milestone, but they are not presented as
current features:

- a hosted ForgeBridge cloud service;
- a vendor-neutral remote coordinator;
- billing/accounts;
- cross-user or privilege-boundary bypasses;
- arbitrary desktop automation outside the permission model;
- a guarantee that every MCP client supports every optional UI feature.

## Project health

A healthy ForgeBridge release should keep these signals green:

- public CI on Windows, macOS and Ubuntu;
- production dependency audit;
- deterministic release artifact validation;
- npm package install validation;
- MCP Registry metadata validation;
- secret preflight before publishing;
- release checksums and SBOM;
- clean public Git history and documented release notes.

For the detailed engineering phase plan, see
[docs/implementation-plan.md](docs/implementation-plan.md).

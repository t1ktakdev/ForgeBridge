# Public alpha release

Target: `0.1.0-alpha.3`.

This document is the operator checklist for publishing ForgeBridge without copying local state,
credentials, browser profiles, audit logs, screenshots, or private Git history into the public
release.

## Public identities

- GitHub repository: `t1ktakdev/ForgeBridge`
- npm package: `forgebridge`
- CLI command: `forgebridge`
- MCP Registry name: `io.github.t1ktakdev/forgebridge`
- License: Apache-2.0

## Release order

1. Run `pnpm run check`, `pnpm run package:artifact`, and `pnpm run package:validate`.
2. Inspect the tarball allowlist and `SHA256SUMS`; never publish the local state directory.
3. Publish a sanitized source snapshot to the public GitHub repository. Do not push an unreviewed
   private/local Git history merely to preserve commit history.
4. Enable GitHub private vulnerability reporting before advertising the alpha broadly.
5. Because a brand-new npm package cannot have a trusted publisher configured until the package
   exists, publish the first version interactively with an npm account protected by 2FA:
   `npm publish --access public --tag next`.
6. On npmjs.com, configure the trusted GitHub Actions publisher for user `t1ktakdev`, repository
   `ForgeBridge`, workflow `publish.yml`, and allow the intended publish action.
7. After the trusted publisher is configured, create the matching Git tag. The workflow first checks
   npm and skips publishing when that exact version already exists, so the initial manually
   published alpha can still use the same tag to publish Registry metadata safely.
8. Subsequent tag releases use `.github/workflows/publish.yml` and npm OIDC instead of a long-lived
   npm write token, then validate and publish `server.json` to the official MCP Registry.

## Required release evidence

- lint and typecheck exit 0;
- complete automated tests pass, with native/manual gates called out separately;
- production build exit 0;
- installed-artifact validation passes for MCP, HTTP, filesystem, terminal/PTY, Git, jobs, browser,
  audit, background policy, uninstall, and the Windows installer;
- no private keys, environment files, credentials, local ForgeBridge state, or browser profiles are
  present in the tarball;
- package, CLI, SBOM, and `server.json` versions agree.

## External gates

Before calling the project production-ready, repeat installation/uninstallation on a separate clean
Windows VM, establish a private security-reporting channel, and obtain an independent security
review. Artifact signing and an external audit-chain checkpoint remain future hardening work.

The alpha label is intentional: ForgeBridge has a strong local validation suite, but an approved
arbitrary shell still has the authority of the OS account running the agent and is not an OS
sandbox.

## Cross-platform packaging checks

The release packer resolves pnpm JavaScript launchers, native executables, and Windows npm/Corepack
shims without passing bare `pnpm` to Node or relying on shell quoting. Run `pnpm test:release` for
launcher regression tests. The CI quality and installed-package matrix covers Windows, Linux, and
macOS; a configured matrix is not evidence that those jobs have passed.

When updating a public snapshot, copy individual files to their exact destinations. Recursively
copying a directory into an existing directory can create `tests/tests`, `src/src`, `docs/docs`,
`scripts/scripts`, or `.github/.github`. The metadata test rejects these accidental duplicates. Do
not suppress lint errors from broken relative imports in duplicated tests.

Package validation checks both the CLI JavaScript entry point and the installed npm executable via
offline `npm exec`. It uses temporary installation, state, project roots, and a separate HTTP port.
The running development agent and its tunnel are not replaced. Native interactive desktop tests
remain separate opt-in gates.

## Recovering MCP Registry publication

If npm publication succeeded but Registry publication failed, keep the existing release tag. After
cross-platform CI passes on main, run the Publish workflow from main with `registry_only=true`:

```sh
gh workflow run publish.yml --ref main -f registry_only=true
```

This path runs the quality gate and installed-package validation, verifies the exact published npm
version and MCP identity, then publishes Registry metadata using GitHub OIDC. It does not publish
npm or move tags. The publisher binary is pinned and its SHA-256 checksum is verified before use. A
normal manual dispatch with the input left false runs validation only.

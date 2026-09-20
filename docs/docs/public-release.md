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

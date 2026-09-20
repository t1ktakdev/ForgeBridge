# Security policy

ForgeBridge is pre-release software and has not received an independent security audit. Do not
expose its loopback endpoint publicly or use it with irreplaceable data.

## Reporting

Until a private disclosure channel is published, do not include live credentials, private source, or
personal data in a public issue. Provide a minimal synthetic reproduction and mark the report as
security-sensitive. A dedicated private advisory process is required before the first public
release.

## Operating model

- Run ForgeBridge as a standard user, never as Administrator.
- Configure only the project roots needed for the current work.
- Prefer ASK or BALANCED mode; use timed grants for autonomous work.
- Use an isolated browser profile.
- Use an OS sandbox or VM when arbitrary shell containment is required.
- Revoke the tunnel/runtime credential and local sessions after suspected compromise.
- Verify the release tarball against `SHA256SUMS`. Install Playwright browsers explicitly; the
  ForgeBridge installer creates no service, startup entry, PATH change, or firewall rule.
- Uninstall preserves local keys, configuration, jobs, and audit evidence unless `-RemoveState` is
  explicitly selected. Revoke local and tunnel access before deleting that state.

The detailed trust and threat models are in [docs/security-model.md](docs/security-model.md) and
[docs/threat-model.md](docs/threat-model.md).

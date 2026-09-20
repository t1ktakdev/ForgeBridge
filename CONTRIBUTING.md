# Contributing

ForgeBridge accepts changes only with tests proportionate to their privilege and failure modes.

1. Open an issue or design note for changes to protocol, policy precedence, trust boundaries, or
   persistent state formats.
2. Run `pnpm check` before submitting a change.
3. Add Windows-native coverage for filesystem, terminal, process, browser, or installer behavior.
4. Do not weaken a hard deny or security assertion merely to make a test pass.
5. Do not add telemetry, auto-start, a public listener, or credential collection without an explicit
   design review and opt-in UX.

Commits must not include `.env` files, private keys, tokens, generated browser profiles, or large
binaries. Use the repository's existing Git author configuration; do not add false attribution.

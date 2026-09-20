# Permission model

## Goals

The permission system must be understandable by a developer, enforceable without model cooperation,
scoped to explicit resources, and useful in both interactive and autonomous work. It uses three
decisions:

- `allow`: execute now;
- `ask`: create a pending approval and do not execute;
- `deny`: reject without an override path in the current call.

## Modes

| Capability class                  | ASK   | BALANCED                  | FULL                            |
| --------------------------------- | ----- | ------------------------- | ------------------------------- |
| Safe reads inside roots           | allow | allow                     | allow                           |
| File writes/patches inside roots  | ask   | allow                     | allow                           |
| File delete/move overwrite        | ask   | ask                       | allow if explicitly scoped      |
| Short non-elevated commands       | ask   | allow inside scope        | allow inside scope              |
| Long-running process/job start    | ask   | allow inside scope        | allow inside scope              |
| Process interrupt/owned kill      | ask   | allow                     | allow                           |
| Git read                          | allow | allow                     | allow                           |
| Git commit                        | ask   | ask unless profile allows | allow if profile allows         |
| Git push                          | ask   | ask                       | ask unless a timed grant allows |
| Force push/reset/clean            | deny  | deny                      | deny by default                 |
| Browser read/snapshot             | allow | allow                     | allow                           |
| External navigation               | ask   | allow by origin policy    | allow by origin policy          |
| Type into a form                  | ask   | allow unless sensitive    | allow unless sensitive          |
| Submit/purchase/delete account    | ask   | ask                       | ask                             |
| Windows UI inspect                | allow | allow                     | allow                           |
| Windows UI interaction            | ask   | ask                       | allow                           |
| Windows UI submit/security action | ask   | ask                       | ask                             |
| Secret read/elevation/persistence | deny  | deny                      | deny by default                 |

`FULL` means autonomous work inside a named scope. It never overrides hard denies, secret
boundaries, ownership checks, or non-bypassable consequential actions.

A project profile may additionally set `autonomy: trusted-local`. That setting is an explicit local
trust decision for repository-defined code inside that canonical project root. It removes repeat
approval for the `repository-code` risk flag, including a hash-bound `project_check`, but does not
remove approval for a `destructive` risk flag and does not change hard-deny or always-fresh classes.

## Capability vocabulary

```text
filesystem.read       filesystem.write      filesystem.delete
terminal.readonly     terminal.execute      terminal.admin
process.inspect       process.start         process.kill
git.read              git.commit            git.push
git.reset             git.clean             git.force_push
browser.read          browser.navigate      browser.type
browser.submit        browser.download      browser.upload
browser.evaluate
windows.read          windows.interact       windows.submit
system.inspect        system.modify
network.inspect       network.modify
packages.install      secrets.read
agent.configure       agent.revoke
audit.read             approvals.respond
```

Sub-capabilities may be added without changing the decision algorithm. A policy file rejects unknown
capability names rather than silently accepting them.

## Evaluation order

Highest precedence wins:

1. hard-deny rule compiled into the agent or signed machine policy;
2. explicit machine/project `deny`;
3. scope validation and resource ownership checks;
4. a valid one-time approval bound to this action digest;
5. a valid temporary or session grant;
6. explicit machine/project `ask`;
7. explicit machine/project `allow`;
8. mode default;
9. deny if no rule exists.

A narrow allow never overrides a broader matching deny. Policy load failures fail closed. The
decision object identifies the decisive rule and canonical action digest; the implementation does
not retain a verbose trace of every non-decisive rule.

## Scopes

Filesystem scopes use canonical roots, not string prefixes:

```yaml
roots:
  - path: C:\src\frontend
    capabilities: [filesystem.read, filesystem.write, terminal.execute, git.read]
  - path: C:\src\api
    capabilities: [filesystem.read, filesystem.write, git.read, git.commit]
```

Other implemented scope types are canonical repository paths, browser origins, opaque owned
process/job handles, the local device identity, and global read-only status. Executable-prefix and
network-destination policy scopes are not part of v0.1.

Windows comparisons are case-insensitive after canonicalization. UNC roots are allowed only when
explicitly configured. Device namespaces and alternate data streams are rejected.

## Grants

Grants are additive only below hard deny and explicit deny:

- **once**: one exact canonical action digest;
- **session**: capability and scope until the MCP client session ends or the agent is
  paused/revoked;
- **temporary**: capability and scope until a wall-clock expiry, for example full project access for
  30 minutes;
- **project profile**: persistent versioned policy selected for one canonical project root.

Temporary and session grants carry issuer, created time, expiry, reason, and maximum uses. Clock
rollback does not extend a grant: monotonic elapsed time is tracked in memory and wall time is
checked after restart.

The local control plane can revoke an individual active grant. Temporary grants and their remaining
use count are persisted; session grants are removed when the associated MCP transport closes and are
never restored after restart.

## Approval protocol

An `ask` decision creates a random approval ID and stores:

- canonical action digest;
- capability, normalized scope, and risk explanation;
- redacted preview of arguments and expected side effects;
- requesting client/device/session IDs;
- creation and expiry timestamps;
- allowed response choices (`once`, `session`, bounded duration, `deny`).

The MCP call returns `approval_required` and performs no side effect. The user responds through the
local UI/CLI or a verified host UI channel. On retry, the agent consumes the approval only when the
digest and caller match exactly. One-time approvals cannot be replayed or widened.

Approval of a command does not automatically approve a later command with different whitespace,
environment, working directory, executable resolution, or redirection. The digest is computed from a
canonical structured form.

## Policy hard denies in v0.1

- access through file/browser tools to ForgeBridge state, device private keys, and local tokens;
- credential dumping, browser credential databases, LSASS access, SAM/SECURITY hives, and known
  cloud/SSH private-key stores through generic tools;
- elevation (`runas`, UAC manipulation) and security-control disabling;
- hidden persistence, autoruns, service/scheduled-task creation;
- non-loopback listener creation through agent configuration;
- operations outside canonical allowed roots unless a machine administrator explicitly changes the
  root policy locally;
- Git force push, destructive reset, clean, and history rewriting through structured tools;
- browser purchases, account deletion, or security-setting changes without a fresh human approval,
  even in FULL;
- Windows UI submit, purchase, account deletion, or permission changes without a fresh human
  approval, even in FULL;
- approval or policy mutation initiated solely through the model tool surface.

These are guarantees of ForgeBridge's structured tools and authorization pipeline, not an OS
sandbox. Once `terminal.execute` is authorized, a shell can invoke other programs and attempt
actions that lexical command-risk classification misses. Use ASK mode and an OS sandbox, VM, or
dedicated low-privilege account when that distinction matters.

## Project profiles

A project profile is data, not executable code. A user creates or changes it through the local
control UI/CLI, after which its canonical root, mode, autonomy setting, and rules are stored in
machine configuration. Repository-local files are not imported as policy, so untrusted repository
content cannot silently enable FULL or `trusted-local` autonomy.

`forgebridge project trust PATH` is a convenience for `mode: full` plus `autonomy: trusted-local`.
`forgebridge project set PATH --mode ... --autonomy ...` updates the persistent profile, and
`forgebridge project remove PATH` returns the project to global policy.

When profiles are nested, the profile with the longest matching canonical root supplies the
effective mode. Machine and matching project rules are evaluated together, with any matching deny or
ask taking precedence over an allow. Root capability limits are always enforced before a project
profile, so a project mode cannot add a capability absent from the machine root policy.

## Audit requirements

Every dispatched decision records the requested capability, normalized scope, decision, decisive
rule ID, result, and redacted arguments. Approval and grant IDs appear in the decisive rule ID when
they authorize an action. The current mode and human-readable policy rationale are available through
status but are not duplicated into every ledger entry. Denied actions are logged as carefully as
allowed actions.

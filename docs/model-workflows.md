# Model-first development workflow

ForgeBridge exposes a small semantic layer for routine development work so an MCP client does not
need to guess the host shell, inspect manifests one file at a time, or use arbitrary command
execution for ordinary reads.

## Start with project inspection

For project work, call `project_inspect` with the project directory:

```json
{ "workingDirectory": "C:\\src\\project" }
```

The result is a bounded snapshot built from known manifests and directory metadata. It can report
the canonical project and Git roots, permitted ForgeBridge root, language evidence, declared and
installed runtime versions where safely discoverable, package-manager evidence, lockfiles, workspace
metadata, source/test directories, major dependencies and frameworks, validation scripts, Git state,
operating system, default shell, and execution profile.

ForgeBridge does not execute repository content to build this snapshot. It does not use README
files, source comments, or other project text as instructions. Manifest and filename evidence
remains untrusted repository data. Detectors currently understand useful evidence for
Node/JavaScript/TypeScript, Python, Rust, Go, .NET, and Java projects. A missing or uncertain fact
is reported as unknown rather than inferred.

Runtime-version discovery uses fixed version probes from a neutral working directory. Those host
facts are cached for the lifetime of the ForgeBridge process. Project manifests and Git status are
inspected fresh; Git status is not cached because stale dirty/clean state would be misleading.

## Prefer semantic tools

Use the narrowest tool that describes the intended operation:

- `project_inspect` for project, runtime, package-manager, validation, Git, OS, and shell context.
- `project_scripts` to review repository-defined validation commands without executing them.
- `project_check` to run a reviewed `test`, `lint`, `typecheck`, `build`, or `check` plan.
- `git_read` for status, diff, log, show, branches, and commit preflight.
- `git_write` for deliberate Git mutations and network operations.
- `fs_read` and `fs_write` for filesystem work; prefer `fs_write update` with an `fs_read` hash for
  whole-file edits and `patch` for concise diffs.
- `system_info` for host-only information.
- `jobs` for durable development servers and other long-running commands; `status`, `logs`, and
  `cancel` use the returned `jobId`.
- `terminal` only when no semantic operation accurately represents the task.

This split is intentional. Arbitrary terminal execution remains truthfully annotated as potentially
destructive and open-world. A harmless-looking shell string is not reclassified as safe merely to
make a model or host UI accept it.

For browser verification, `browser_read console` and `browser_read network` are direct convenience
views over bounded observations. `browser_act press` can target a semantic locator directly, which
avoids a separate focus/click call for keyboard-accessible controls. Tool descriptions include
canonical argument shapes so clients should not need trial calls to discover common schemas.

## Repository scripts are executable code

`project_scripts` returns exact validation plans and a `planSha256`. `project_check` requires that
hash and revalidates the manifest immediately before execution. On Windows, the selected script body
runs under `cmd /d`; on Unix-like systems it runs under Bash without profiles. ForgeBridge adds the
project's `node_modules/.bin` to `PATH` but does not invoke package-manager lifecycle wrappers, add
runner-specific flags, or silently run `pre*`/`post*` scripts.

A script named `test` is still arbitrary repository code. It can write files, start processes, or
access the network, so `project_check` remains non-read-only and destructive/open-world in MCP
metadata. Standard projects require a fresh exact ForgeBridge approval. If the local user explicitly
marks the canonical project `trusted-local`, a reviewed hash-bound `project_check` may run without a
fresh approval; the resolved command and active permission policy stay visible in project discovery.
Destructive command classifications, push, elevation, persistence, secrets, consequential submits,
and out-of-scope access are not relaxed by `trusted-local`. Non-Node ecosystems are currently
inspected semantically, but `project_check` execution is limited to `package.json` scripts; use
reviewed terminal/jobs when another ecosystem needs execution.

## Windows shell contract

`system_info` and `project_inspect` report the actual host shell contract. On Windows the default
ForgeBridge shell is Windows PowerShell without user profiles. Windows PowerShell 5.1 does not
support `&&`; prefer semantic tools, separate calls, `;` for unconditional sequencing, or an
explicitly selected compatible shell. Terminal and job calls use the canonical `workingDirectory`
parameter. `cwd` is intentionally not an alias because accepting two names for the same
security-sensitive directory makes schemas harder to reason about.

If incompatible PowerShell syntax is received, ForgeBridge reports a structured
`unsupported_shell_syntax` error instead of leaving the model to diagnose a generic parser failure.

## Permission and approval layering

MCP annotations are behavioral hints, not authorization. ForgeBridge applies its own deny-first
permission engine after a tool call reaches the local agent. The client or OpenAI host may
separately refuse a call before ForgeBridge receives it; in that case there is no ForgeBridge audit
event for the attempted operation.

For ForgeBridge denials and approvals, structured errors include the stable error code and, where
applicable, fields such as `blocked_by`, `capability`, `operation`, `scope`, `approval_id`,
`approval_ids`, `risk_reason`, `allowed_responses`, `expires_at`, `retryable`, and `next_action`.

When `approval_required` is returned, approve or deny it through the authenticated local control
plane. After approval, retry the same call with the returned `approvalIds`. Do not use terminal,
Git, browser, or another tool to bypass a denied filesystem action. In particular, filesystem
deletion remains an exact-path approval and direct deletion commands through terminal are rejected.

`permissions_status({})` is the normal permission query. Its optional `maxItems` bounds grant and
approval arrays only. `approvalIds` are authorization tokens for an exact retry, not a status-query
filter.

## Long-running work

Use `jobs` for development servers, watchers, and other processes that should remain addressable
after one MCP request completes. Job logs are bounded and offset-based, and ForgeBridge owns
process-tree cancellation. Interactive terminal sessions are intended for genuinely interactive
work, not as a default substitute for semantic developer operations.

## Known limits

Project inspection is deliberately bounded and evidence-based rather than a full build-system
interpreter. Nested monorepo topology, generated build logic, custom task runners, and dynamically
computed manifests may require targeted follow-up reads. Runtime probes use the trusted host
environment rather than repository-local shims, so a project-specific toolchain manager can differ
from the reported installed host runtime. Semantic validation execution currently supports Node
package scripts only. These limits are preferable to executing untrusted repository configuration
during discovery.

# ForgeBridge threat model

## Scope and assets

Protected assets include source code, documents, credentials, browser sessions, Git history, build
artifacts, local services, the user's OS account, device identity, permission policy, approval
decisions, and audit evidence.

Adversaries considered:

- a malicious webpage or downloaded file;
- a malicious repository contributor or poisoned instruction file;
- a compromised or manipulated model/client session;
- a network attacker between components;
- another local unprivileged process;
- a dependency or update supply-chain compromise;
- an accidental destructive model action;
- a user who grants overly broad authority by mistake.

An already-compromised OS administrator is outside the containment claim, but tamper evidence and
least-privilege operation remain useful.

## Threats, controls, and residual risk

| Threat                                | Primary controls                                                                                                                                | Residual risk                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Prompt injection from web/repo output | provenance labels; local policy; disabled Git hooks/filters/textconv; no content-driven approval; consequential confirmation                    | an authorized client can still choose a harmful allowed action                            |
| Path traversal                        | canonical roots; realpath of existing ancestor; reject device paths/ADS; mutation recheck                                                       | filesystem races require platform-specific handles for strongest guarantees               |
| Symlink/junction escape               | link-aware resolution and final-component rules; tests on Windows junctions and POSIX symlinks                                                  | privileged concurrent relinking may win a narrow TOCTOU race                              |
| Command injection                     | structured argv for internal commands; shell calls classified as arbitrary execution; no string interpolation in Git/search                     | an allowed arbitrary shell intentionally has broad power                                  |
| Destructive command                   | ASK/BALANCED/FULL policy; hard denies; fresh approvals; process ownership                                                                       | user-approved destructive work remains destructive                                        |
| Over-broad trusted project            | local-only `trusted-local` opt-in; canonical root; reviewed plan hash; destructive and consequential gates remain                               | trusted repository code can still exercise the granted OS-account authority               |
| Credential exposure                   | secret path deny; filtered environment; redaction; isolated browser contexts; no clipboard by default                                           | unknown secret formats can evade pattern scanners                                         |
| Malicious browser redirect            | per-request origin checks including redirects; private-network policy; isolated context                                                         | allowed sites can serve changing hostile content                                          |
| Browser cookie theft                  | non-persistent isolated contexts; no raw cookie tool                                                                                            | a page in the same permitted context can abuse its own session                            |
| Desktop UI confusion/injection        | opt-in semantic tree; exact element locators; bounded output; separate act/submit permissions; no coordinate/script surface                     | app-provided accessible names can still mislead a client                                  |
| Foreground or game interruption       | background default; headless browser; hidden workers; focus action queue; no global input APIs                                                  | a target app may surface itself in response to a semantic UIA operation                   |
| CSRF/DNS rebinding on local HTTP      | loopback bind; bearer token; strict Origin allowlist; Host validation                                                                           | compromised same-user local process can often access user resources anyway                |
| Remote endpoint takeover              | official outbound tunnel; OAuth/tunnel roles; TLS; optional mTLS; revocation                                                                    | MCP data traverses the selected provider by design                                        |
| OAuth mix-up/token confusion          | upstream OpenAI tunnel and product authorization; ForgeBridge does not implement a public OAuth resource server                                 | provider, workspace-policy, or client implementation defects remain                       |
| Approval replay/confusion             | random ID; exact canonical digest; caller binding; TTL; single-use consumption                                                                  | misleading but accurately displayed user-approved actions                                 |
| PID reuse/wrong process kill          | opaque handle; live child-process registry; no arbitrary-PID API                                                                                | a narrow exit-event/PID-reuse race remains platform-dependent                             |
| Output memory exhaustion              | byte/line ring buffers; disk log quotas; backpressure; pagination                                                                               | disk can fill if machine quotas are disabled/misconfigured                                |
| Stuck process/request                 | deadlines; cancellation; separate jobs; tree-aware termination                                                                                  | processes can enter uninterruptible kernel states                                         |
| Job state loss                        | atomic metadata; append-only logs; transition recovery                                                                                          | interactive stdio cannot be reattached after agent crash in v0.1                          |
| Audit tampering                       | append-only file; hash chain verified on startup and read; restrictive state-directory ACL                                                      | tail truncation or deletion is undetectable without an external signed checkpoint         |
| Malicious package/update              | lockfile; provenance checks; SBOM/release hashes; no silent update                                                                              | ecosystem compromise before detection                                                     |
| Privilege escalation                  | never auto-elevate; hard-deny admin operations; run as standard user                                                                            | existing local privilege-escalation vulnerabilities are out of scope                      |
| Hidden persistence                    | default install has no startup; model policy APIs hard-deny persistence; optional user-installed logon task is explicit, visible, and removable | an authorized shell or same-user malware can still create persistence outside ForgeBridge |
| Cross-client confusion                | client/session/subject binding on handles; per-client grants; authorization on retrieval                                                        | shared stdio launcher identity may be coarse                                              |
| Malformed/oversized MCP input         | schema validation; body/depth/string limits; timeouts; safe errors                                                                              | parser/library vulnerabilities                                                            |

## Abuse cases

### Poisoned README asks to upload secrets

The file is returned as `untrusted_repository_content`. It cannot grant `secrets.read` or
`browser.upload`. Reading known secret paths is hard-denied; upload is separately permissioned and
the approval preview lists exact files and destination origin.

### Webpage tells the model to approve a purchase

Page text is untrusted. `browser.submit` for a purchase-class action always requires a fresh user
decision. The local UI shows origin, visible control, form destination, and redacted field names.
The page cannot call the approval API.

### Allowed project contains a junction to the user profile

The path resolver canonicalizes the nearest existing ancestor and final target. The resulting path
is outside the project root and is denied. Mutations recheck before opening or renaming.

### Model encodes a forbidden command

Textual command blocklists are not treated as containment. In ASK/BALANCED the shell action is shown
for approval; in FULL it is limited only by OS isolation and hard-denied agent APIs. Users needing
containment run ForgeBridge under a dedicated low-privilege account, Windows Sandbox/VM, or
container appropriate to the workload.

### Trusted project turns malicious after opt-in

`trusted-local` is a user trust decision, not a sandbox. ForgeBridge still revalidates the manifest
hash immediately before `project_check`, keeps the canonical project scope, and continues to gate
destructive classifications and consequential capabilities. If repository code itself is malicious
within the already granted local authority, containment requires a VM, sandbox, or dedicated
low-privilege account; remove the project profile to return to standard approvals.

### Stolen tunnel runtime key

The key has only tunnel Read + Use and is not an MCP authorization token. Interactive runs keep it
in the process environment; optional Windows autostart stores only current-user DPAPI ciphertext in
the protected state directory and reconstructs plaintext inside the supervisor process. The operator
revokes/rotates it in the Platform organization, replaces the autostart credential, revokes local
sessions, and reviews the audit chain. Same-user compromise remains able to use the user's
authority. Optional mTLS reduces usefulness of a copied key where supported.

### Malicious desktop text asks for broader access

Accessible names and values are returned as `untrusted_desktop_content`. They cannot change policy
or satisfy an approval. Actions use an independently supplied semantic locator, and consequential
purposes require a fresh local approval even in FULL mode.

## Security test requirements

Release tests must cover path traversal, symlink/junction escape, ADS/device paths, permission
precedence, approval replay and expiry, command timeout, huge output eviction, cancellation races,
PID reuse checks, malformed MCP requests, Origin rejection, lost connections, log redaction,
secret/path scans, browser redirect policy, download confinement, and cleanup of owned processes and
browser contexts. Opt-in Windows runs additionally exercise semantic Notepad and Calculator actions
without coordinates, verify foreground stability during background-safe work, and verify that
focus-requiring work is deferred until local approval and NORMAL mode.

Native Windows validation is required; passing only mocked or POSIX CI is not a release gate.

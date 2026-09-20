# ForgeBridge research notes

Research snapshot: 2026-09-14. Fast-moving claims below are linked to primary sources and should be
rechecked before a release.

## Executive findings

- ForgeBridge pins `@modelcontextprotocol/sdk` 1.30.0 and uses its stateful Streamable HTTP
  transport with explicit session IDs. Domain objects such as jobs, terminals, and browser pages
  still use ForgeBridge-owned authorization-bound handles rather than treating a transport session
  as durable application state.
- MCP progress and cancellation are useful while a request is connected, but they do not replace
  durable jobs. The Tasks feature is now an extension and requires explicit support from both client
  and server. ForgeBridge therefore exposes its own durable job handles and can add the Tasks
  extension without changing the local execution model.
- OpenAI's current documentation has moved the former Apps SDK material under **Plugins**. Plugins
  use MCP tools and optional MCP Apps UI resources. The older `apps-sdk` URLs currently redirect to
  `/plugins`.
- ChatGPT cannot call a user's loopback server directly. The best supported path for a private
  machine is OpenAI Secure MCP Tunnel: the customer-run client long-polls over outbound HTTPS and
  forwards requests to a local stdio or HTTP MCP server. No inbound firewall rule is needed.
- A public MCP endpoint remains valid, but it must implement OAuth 2.1 resource server behavior,
  protected-resource metadata, PKCE-compatible authorization, audience-restricted tokens, and normal
  Internet service hardening. ForgeBridge v0.1 does not ship an unauthenticated public listener.
- Tool annotations help a host choose confirmation behavior, but they are untrusted metadata, not an
  authorization boundary. ForgeBridge must enforce every decision locally.
- File and command allowlists are not enough once arbitrary shell execution is granted. OS isolation
  is the only strong containment boundary. The permission engine reduces authority and accidents; it
  does not claim to sandbox a fully authorized shell.

## Specifications and SDKs

### Model Context Protocol

Primary sources:

- [MCP specification repository](https://github.com/modelcontextprotocol/modelcontextprotocol)
- [2026-07-28 release](https://github.com/modelcontextprotocol/modelcontextprotocol/releases/tag/2026-07-28)
- [Streamable HTTP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx)
- [Authorization](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx)
- [Authorization security considerations](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/security-considerations.mdx)
- [Tools](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx)
- [Pagination](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/utilities/pagination.mdx)
- [Progress](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/patterns/progress.mdx)
- [Cancellation](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/patterns/cancellation.mdx)
- [Tasks extension](https://github.com/modelcontextprotocol/ext-tasks)

What it does well: MCP gives clients a typed discovery and invocation contract for tools, resources,
progress, cancellation, and structured results. The authorization profile reuses OAuth standards
rather than inventing bearer-token semantics. Streamable HTTP requires Origin validation and
authentication and recommends loopback-only binding for local servers.

Constraints: MCP is not a sandbox, permission engine, process supervisor, or durable queue. SDK
transport sessions do not replace durable domain state. Tasks are an extension, so broad client
support cannot be assumed. Tools may be filtered by authorization but still need server-side
validation.

ForgeBridge use: strict schemas; bounded structured outputs; opaque cursors; explicit process,
browser, approval, and job handles; progress where supported; cooperative cancellation; local
authorization on every call; versioned transport adapters.

### Official TypeScript SDK

Primary sources:

- [TypeScript SDK source](https://github.com/modelcontextprotocol/typescript-sdk)
- [SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/index.md)
- [v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)

At the research snapshot, npm `@modelcontextprotocol/sdk` is `1.30.0`; the repository also contains
the modular v2 line. OpenAI's plugin examples still show the stable `@modelcontextprotocol/sdk` API.
ForgeBridge pins the stable major and keeps registration/transport code in one package so the v2
migration is localized.

What it does well: Zod-backed input validation, standard tool/resource registration, stdio and
Streamable HTTP transports, and protocol-level notifications. Constraint: SDK primitives do not
provide ForgeBridge's durable jobs, policy storage, audit trail, or OS security boundary.

## OpenAI / ChatGPT integration

Primary sources:

- [Plugins overview](https://developers.openai.com/plugins)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Connect and test in ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Authentication](https://developers.openai.com/plugins/build/auth)
- [Plugin security and privacy](https://developers.openai.com/plugins/guides/security-privacy)
- [Add UI to an MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Plugin UI reference](https://developers.openai.com/plugins/reference)
- [MCP and connectors in the API](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Open-source tunnel client](https://github.com/openai/tunnel-client)

What it does well:

- Developer mode supports complete MCP tool discovery, including read and write tools.
- The host understands `readOnlyHint`, `destructiveHint`, and `openWorldHint`, can render
  confirmation UI, and can render optional MCP Apps components in a sandboxed iframe.
- UI resources use the MCP Apps bridge (`window.openai`) while structured tool results remain usable
  by clients with no UI support.
- OAuth guidance follows OAuth 2.1, protected-resource metadata, authorization server discovery,
  PKCE, issuer validation, and per-call scope enforcement.
- Secure MCP Tunnel is outbound-only and supports stdio or HTTP backends, bounded
  queueing/backpressure, streaming events, restricted tunnel roles, and optional control-plane and
  MCP-side mTLS.

Important limits and trust facts:

- A tunnel keeps the listener private, but MCP arguments, results, applicable bearer tokens, and
  stream events still traverse the OpenAI product and tunnel service. Static backend headers and an
  MCP-side private mTLS key can remain on the local hop. Strict local-only auth requires a direct
  local MCP client, not the tunnel.
- Published plugins require a stable public HTTPS endpoint; the tunnel is for supported
  private/developer-mode connections, not a substitute for public review and hosting.
- Developer mode availability depends on account and workspace policy. The current official ChatGPT
  developer page explicitly confirms full MCP support for Plus and Pro. Current tunnel documentation
  explicitly describes separate administrator enablement for Enterprise and Edu. The official pages
  reviewed here do not make an equally explicit promise for Free or Business, so ForgeBridge does
  not claim those tiers are guaranteed; deployment docs must be checked against the target account
  at install time.
- UI code is presentation, not policy. Approval-gated arguments may not be available to a widget
  until approval, and all authorization must remain on the server.

ForgeBridge use: default to Secure MCP Tunnel for ChatGPT web, direct stdio for local clients, keep
the MCP server on loopback, expose a compact status/approval component, and never depend on host
annotations as the only safety check.

## Comparable implementations

### Microsoft Playwright and Playwright MCP

Primary sources:

- [Playwright](https://github.com/microsoft/playwright)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Browser contexts](https://playwright.dev/docs/browser-contexts)
- [Locators](https://playwright.dev/docs/locators)

Strengths: reliable browser lifecycle, isolated contexts, role/name locators,
downloads/uploads/dialogs, multiple pages, screenshots, and an accessibility- oriented snapshot in
Playwright MCP. Its README explicitly recommends snapshots over screenshot-coordinate automation and
separates isolated from persistent profiles.

Constraints: Playwright MCP explicitly says it is not a security boundary. Origin allow/block
options are guardrails and do not cover redirects. A persistent browser profile contains high-value
cookies and can only be used by one process. Its general `run-code` tool is RCE-equivalent.

Authentication/local access: normally stdio or loopback HTTP; browser state is local. Terminal and
durable job management are out of scope. Secrets replacement is described as convenience, not
security.

ForgeBridge use: Playwright library behind the same local permission engine; isolated contexts by
default; role/name/test-id locators; external navigation, uploads, downloads, submissions, and
evaluation separately classified; arbitrary browser-side or server-side code evaluation hard-denied
by default.

### Desktop Commander (local)

Primary sources:

- [DesktopCommanderMCP](https://github.com/wonderwhy-er/DesktopCommanderMCP)
- [Security model](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/SECURITY.md)
- [Terminal manager](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/src/terminal-manager.ts)

Strengths: practical filesystem/search/diff APIs and a persistent terminal session model with
process IDs, input, polling, timeouts, completed-session caching, and bounded output.

Constraints: its own security document correctly states that allowed directories and command
blocklists are guardrails, not a sandbox. It trusts the connected AI and does not attempt to
distinguish user instructions from prompt injection. Long-lived session state is mostly
process-local.

ForgeBridge use: process handles, cursor-based output reads, explicit timeouts, and buffer eviction.
Difference: every operation goes through a deny-first policy engine, approvals are payload-bound,
filesystem paths are canonicalized, and untrusted-content provenance is carried into the audit
record.

### Remote Desktop Commander

Primary sources:

- [Remote Desktop Commander](https://github.com/desktop-commander/remote-desktop-commander)
- [Setup](https://github.com/desktop-commander/remote-desktop-commander/blob/main/docs/SETUP.md)
- [Security model](https://github.com/desktop-commander/remote-desktop-commander/blob/main/SECURITY.md)

Strengths: a hosted Streamable HTTP MCP endpoint, OAuth 2.0 with PKCE for the AI client, OAuth
device authorization for pairing, an outbound device agent, online/offline status, and dashboard
revocation.

Constraints: the hosted relay implementation is not open source. Tools execute with the logged-in OS
user's authority; its restrictions are explicitly guardrails rather than containment. The connected
AI account is trusted.

ForgeBridge use: pairing-code UX, background-by-default agent, clear online state, and immediate
revocation are good patterns. ForgeBridge avoids copying a closed relay and uses the officially
supported OpenAI tunnel for ChatGPT v0.1.

### OpenHands

Primary sources:

- [OpenHands](https://github.com/OpenHands/OpenHands)
- [Agent Canvas architecture](https://github.com/OpenHands/OpenHands/blob/main/docs/architecture.md)
- [Software Agent SDK](https://github.com/OpenHands/software-agent-sdk)

Strengths: separation of UI/control plane, agent server, runtime backend, workspace,
conversation/event state, and automation scheduling. It can run locally, in Docker, on VMs, or in
cloud backends.

Constraints: direct host mode gives the agent host filesystem access; its docs recommend Docker
isolation for stronger laptop security. It is a much larger agent orchestration product, not a
minimal MCP-to-device bridge.

ForgeBridge use: separate durable execution state from the MCP request and keep the runtime
replaceable. Do not import the full multi-agent/cloud platform into v0.1.

### OpenAI Codex

Primary sources:

- [Codex source](https://github.com/openai/codex)
- [Agent approvals and security](https://developers.openai.com/codex/agent-approvals-security)
- [App server protocol](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol)

Strengths: separates OS-enforced sandbox policy from approval policy, limits writes to workspace
roots, defaults network off, models process output and exit notifications explicitly, supports
managed configuration and permission profiles, and treats web/repository content as untrusted.

Constraints: its sandbox is platform-specific and its agent loop is coupled to the Codex product.
Some configurations deliberately allow full host access.

ForgeBridge use: independent hard enforcement plus approval UX; workspace write boundaries; network
as a separate capability; explicit process events; policy profiles. v0.1 does not claim an OS
sandbox where it only has policy checks.

### Claude Code

Primary sources:

- [Claude Code repository](https://github.com/anthropics/claude-code)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Security](https://code.claude.com/docs/en/security)

Strengths: deny/ask/allow precedence, per-tool and per-command rules, session and repository scopes,
explicit permission modes, hooks, and a distinction between permission prompts and shell sandboxing.

Constraints: most implementation is distributed rather than developed in the public repository.
Command-string rules can be subtle and shell interpreters make textual blocklists bypassable.

ForgeBridge use: deny-first precedence, session grants, project profiles, and user-visible reasons.
ForgeBridge binds one-time approvals to canonical action digests instead of accepting a general
"approved" flag.

### VS Code Remote

Primary sources:

- [VS Code source](https://github.com/microsoft/vscode)
- [Remote SSH documentation](https://code.visualstudio.com/docs/remote/ssh)
- [Remote Development tracker](https://github.com/microsoft/vscode-remote-release)

Strengths: a thin local UI connects over an authenticated SSH tunnel to a remote server that
performs filesystem, terminal, extension, and Git work near the data. Extension hosts are placed on
the UI or workspace side intentionally.

Constraints: SSH grants a broad OS account capability and is not an AI-specific permission or audit
model. Port forwarding can expand network reach.

ForgeBridge use: keep execution close to the workspace, use an authenticated outbound/secure
channel, and separate presentation from the privileged agent.

### Windows semantic automation

Primary sources:

- [Microsoft UI Automation overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview)
- [WinAppDriver](https://github.com/microsoft/WinAppDriver)
- [pywinauto](https://github.com/pywinauto/pywinauto)

UI Automation exposes an element tree, properties, events, and control patterns across supported
Windows UI frameworks. WinAppDriver provides a WebDriver-style surface; pywinauto offers Python
wrappers over Win32 and UIA.

Constraints: elevated and cross-user processes are intentionally restricted; provider quality
varies; custom-rendered controls may lack useful semantics; desktop-session and lock-screen state
matter. Coordinate/image automation is a fallback, not a dependable primary interface.

ForgeBridge use: Windows UIA is the Phase 9 semantic backend, isolated in an optional helper process
with its own permissions. It is not part of the v0.1 trusted computing base until filesystem,
terminal, jobs, Git, browser, and transport hardening pass their gates.

## Technology decision

ForgeBridge v0.1 uses TypeScript on Node.js 22 or newer:

- it matches the stable MCP SDK and Playwright ecosystems;
- Windows ConPTY is available through `node-pty`;
- a single runtime keeps packaging and failure handling understandable;
- the privileged core is small and dependency-light.

Rust remains a later hardening option for an OS sandbox, Windows service host, and credential store.
Splitting languages now would not create a security boundary by itself and would slow validation.
The architecture keeps execution ports narrow so those components can be replaced later.

## Ideas deliberately not copied

- No unauthenticated public HTTP server or router-exposed home port.
- No claim that path allowlists contain an arbitrary authorized shell.
- No browser `evaluate` or arbitrary Playwright-code tool enabled by default.
- No persistent use of a user's everyday browser profile by default.
- No single blocking MCP call for builds or dev servers.
- No hidden auto-start, stealth process, credential collection, or remote administration outside
  explicitly registered devices and scopes.

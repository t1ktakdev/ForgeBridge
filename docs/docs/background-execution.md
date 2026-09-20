# Background execution and focus protection

ForgeBridge treats the interactive desktop as user-owned. The default `BACKGROUND` profile keeps
filesystem, Git, terminal, durable-job, MCP, audit, and headless browser work off the foreground
desktop. ForgeBridge does not expose coordinate clicking, global keyboard/mouse injection, clipboard
automation, window movement, or virtual-desktop switching.

## Profiles

The `execution` section is persisted in `config.json`:

```json
{
  "execution": {
    "backgroundMode": true,
    "profile": "background",
    "maxParallelJobs": 4,
    "maxCpuConcurrency": 4,
    "maxBrowserInstances": 2,
    "processPriority": "normal",
    "gaming": {
      "maxParallelJobs": 1,
      "maxCpuConcurrency": 2,
      "maxBrowserInstances": 1,
      "processPriority": "below_normal"
    }
  }
}
```

- `NORMAL` sets `backgroundMode` to `false`. It permits a foreground-required action only after the
  normal capability approval has succeeded and the local user has explicitly selected this profile.
- `BACKGROUND` is the default. Browsers are forced headless and foreground-required UIA actions are
  queued.
- `GAMING` also forces headless browsing, queues foreground work, reduces configurable process and
  browser concurrency, suppresses ForgeBridge-originated notifications, and requests below-normal
  worker priority where the OS account permits it.

Change profiles through the authenticated local control page or CLI:

```powershell
forgebridge execution gaming
forgebridge foreground list
forgebridge foreground approve ACTION_ID
forgebridge execution normal
```

`forgebridge background on|off` is an explicit boolean control for integrations that do not use
profile names. Switching it off selects `NORMAL`; switching it on selects `BACKGROUND` when needed.

## Foreground queue

An operation classified as foreground-required returns `foreground_required` with an action ID,
application, reason, estimated interruption, and required local permission. Its durable record is
stored under the ForgeBridge state directory. The AI-facing MCP tool can inspect the queue, but only
the authenticated loopback control plane can approve, defer, or cancel an item.

Approval alone does not override `BACKGROUND` or `GAMING`. Approved items remain queued until the
local user selects `NORMAL`; then ForgeBridge attempts them and records completion or failure.
Revoking ForgeBridge cancels every pending foreground item.

## Windows behavior and limits

Terminal and job processes use hidden/no-window creation. ForgeBridge never calls
`SetForegroundWindow` for background work. Windows UI Automation uses semantic patterns such as
Invoke, Value, Selection, Toggle, and ExpandCollapse. `SetFocus` is classified as foreground work,
and the native helper reports the foreground window before and after every UIA action so focus
changes are observable.

Windows can still let a target application surface its own window in response to a semantic
operation. ForgeBridge cannot guarantee that an arbitrary third-party application will never do
that; use `GAMING`, keep UI Automation disabled, or defer the action when interruption is
unacceptable. Fullscreen detection is intentionally not implemented in v0.1 because it would be
advisory and must not inspect, inject into, suspend, reprioritize, or otherwise interact with game
processes.

Playwright sessions use isolated, non-persistent contexts. `BACKGROUND` and `GAMING` force Chromium
headless even if `browser.headless` is false. Downloads remain inside configured ForgeBridge roots.

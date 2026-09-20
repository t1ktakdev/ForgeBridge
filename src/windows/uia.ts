import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fileConstants } from 'node:fs';
import { copyFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ForgeBridgeError, errorMessage } from '../core/errors.js';
import type { PathGuard } from '../filesystem/path-guard.js';
import type { ExecutionPolicy } from '../execution/policy.js';
import type { ForegroundActionQueue } from '../execution/foreground-queue.js';
import { filteredEnvironment } from '../terminal/environment.js';

const execFileAsync = promisify(execFile);

export type WindowsTarget =
  { windowHandle: number } | { processId: number } | { windowTitle: string };

export type WindowsLocator =
  | { by: 'automationId'; value: string; index?: number }
  | { by: 'name'; value: string; index?: number }
  | { by: 'controlType'; value: string; index?: number };

type HelperRequest =
  | { operation: 'status' }
  | { operation: 'windows'; limit: number }
  | {
      operation: 'snapshot';
      target: WindowsTarget;
      depth: number;
      maxElements: number;
    }
  | { operation: 'screenshot'; target: WindowsTarget; path: string }
  | {
      operation: 'act';
      action: 'invoke' | 'set_value' | 'toggle' | 'select' | 'expand' | 'collapse' | 'focus';
      target: WindowsTarget;
      locator: WindowsLocator;
      value?: string;
      maxElements: number;
    };

const HelperResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);

const QueuedWindowsActionSchema = z.object({
  target: z.union([
    z.object({ windowHandle: z.number().int().positive() }).strict(),
    z.object({ processId: z.number().int().positive() }).strict(),
    z.object({ windowTitle: z.string().min(1).max(1024) }).strict(),
  ]),
  locator: z.union([
    z
      .object({
        by: z.literal('automationId'),
        value: z.string().min(1),
        index: z.number().int().nonnegative().optional(),
      })
      .strict(),
    z
      .object({
        by: z.literal('name'),
        value: z.string().min(1),
        index: z.number().int().nonnegative().optional(),
      })
      .strict(),
    z
      .object({
        by: z.literal('controlType'),
        value: z.string().min(1),
        index: z.number().int().nonnegative().optional(),
      })
      .strict(),
  ]),
  action: z.literal('focus'),
});

// Input is supplied as base64-encoded JSON in an environment variable. The command itself is
// constant and PowerShell never evaluates request content as source code.
const UIA_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Fail([string]$Code, [string]$Message) {
  throw [System.InvalidOperationException]::new($Code + '::' + $Message)
}

function DesktopStatus {
  $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  $locked = @(Get-Process -Name LogonUI -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $sessionId }).Count -gt 0
  return @{
    supported = $true
    enabled = $true
    userInteractive = [Environment]::UserInteractive
    desktopAvailable = [Environment]::UserInteractive -and -not $locked
    sessionId = $sessionId
    limitation = 'UI Automation cannot bypass a locked desktop, another user session, or a higher-integrity process.'
  }
}

function AssertDesktop {
  $status = DesktopStatus
  if (-not $status.desktopAvailable) {
    Fail 'desktop_unavailable' 'The interactive Windows desktop is locked or unavailable'
  }
}

function ControlTypeName($Element) {
  $name = $Element.Current.ControlType.ProgrammaticName
  if ($name.StartsWith('ControlType.')) { return $name.Substring(12) }
  return $name
}

function SafeText($Value, [int]$Limit = 16384) {
  $text = [string]$Value
  if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit) }
  return $text
}

function ElementObject($Element, [int]$Depth) {
  $patterns = @($Element.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName.Replace('PatternIdentifiers.Pattern', '').Replace('Pattern', '') })
  $result = @{
    depth = $Depth
    name = (SafeText $Element.Current.Name)
    automationId = (SafeText $Element.Current.AutomationId 1024)
    controlType = ControlTypeName $Element
    className = (SafeText $Element.Current.ClassName 1024)
    enabled = $Element.Current.IsEnabled
    offscreen = $Element.Current.IsOffscreen
    'password' = $Element.Current.IsPassword
    patterns = $patterns
  }
  if (-not $Element.Current.IsPassword) {
    $valuePattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
      $value = ([System.Windows.Automation.ValuePattern]$valuePattern).Current.Value
      $result.value = (SafeText $value)
      $result.valueTruncated = $value.Length -gt 16384
    }
  }
  return $result
}

function TopLevelWindows([int]$Limit) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $item = $walker.GetFirstChild([System.Windows.Automation.AutomationElement]::RootElement)
  $items = [System.Collections.Generic.List[object]]::new()
  while ($null -ne $item -and $items.Count -lt $Limit) {
    try {
      if ((ControlTypeName $item) -eq 'Window') {
        $items.Add(@{
          name = (SafeText $item.Current.Name)
          automationId = (SafeText $item.Current.AutomationId 1024)
          className = (SafeText $item.Current.ClassName 1024)
          processId = $item.Current.ProcessId
          windowHandle = $item.Current.NativeWindowHandle
          enabled = $item.Current.IsEnabled
          offscreen = $item.Current.IsOffscreen
        })
      }
    } catch {}
    $item = $walker.GetNextSibling($item)
  }
  return $items
}

function FindWindow($Target) {
  $windows = TopLevelWindows 500
  foreach ($summary in $windows) {
    $matches =
      (($null -ne $Target.windowHandle) -and $summary.windowHandle -eq [int]$Target.windowHandle) -or
      (($null -ne $Target.processId) -and $summary.processId -eq [int]$Target.processId) -or
      (($null -ne $Target.windowTitle) -and $summary.name -eq [string]$Target.windowTitle)
    if ($matches) {
      $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty,
        [int]$summary.windowHandle
      )
      return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Children,
        $condition
      )
    }
  }
  Fail 'unknown_window' 'No matching top-level window is available in this desktop session'
}

function LocatorMatches($Element, $Locator) {
  if ($Locator.by -eq 'automationId') { return $Element.Current.AutomationId -eq [string]$Locator.value }
  if ($Locator.by -eq 'name') { return $Element.Current.Name -eq [string]$Locator.value }
  if ($Locator.by -eq 'controlType') { return (ControlTypeName $Element) -eq [string]$Locator.value }
  return $false
}

function FindElement($Root, $Locator, [int]$MaxElements) {
  $wanted = if ($null -eq $Locator.index) { 0 } else { [int]$Locator.index }
  $found = 0
  $visited = 0
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = [System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]]::new()
  $queue.Enqueue($Root)
  while ($queue.Count -gt 0) {
    if ($visited -ge $MaxElements) { Fail 'element_search_limit' 'Element search exceeded its configured limit' }
    $current = $queue.Dequeue()
    $visited += 1
    try {
      if ((LocatorMatches $current $Locator) -and $found -eq $wanted) { return $current }
      if (LocatorMatches $current $Locator) { $found += 1 }
      $child = $walker.GetFirstChild($current)
      while ($null -ne $child) {
        $queue.Enqueue($child)
        $child = $walker.GetNextSibling($child)
      }
    } catch {}
  }
  Fail 'unknown_element' 'No element matched the semantic locator'
}

function Snapshot($Root, [int]$MaxDepth, [int]$MaxElements) {
  $script:snapshotItems = [System.Collections.Generic.List[object]]::new()
  $script:snapshotTruncated = $false
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  function Visit($Element, [int]$Depth) {
    if ($script:snapshotItems.Count -ge $MaxElements) {
      $script:snapshotTruncated = $true
      return
    }
    try { $script:snapshotItems.Add((ElementObject $Element $Depth)) } catch { return }
    if ($Depth -ge $MaxDepth) { return }
    $child = $walker.GetFirstChild($Element)
    while ($null -ne $child) {
      Visit $child ($Depth + 1)
      if ($script:snapshotTruncated) { return }
      $child = $walker.GetNextSibling($child)
    }
  }
  Visit $Root 0
  return @{ elements = $script:snapshotItems; truncated = $script:snapshotTruncated; provenance = 'untrusted_desktop_content' }
}

function Pattern($Element, $PatternId, [string]$Name) {
  $value = $null
  if (-not $Element.TryGetCurrentPattern($PatternId, [ref]$value)) {
    Fail 'unsupported_pattern' ('Element does not support the ' + $Name + ' pattern')
  }
  return $value
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ForgeBridgeForegroundGuard {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
'@
  $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FORGEBRIDGE_UIA_REQUEST))
  $request = $json | ConvertFrom-Json
  if ($request.operation -eq 'status') {
    $data = DesktopStatus
  } elseif ($request.operation -eq 'windows') {
    AssertDesktop
    $data = @{ windows = @(TopLevelWindows ([int]$request.limit)); provenance = 'untrusted_desktop_content' }
  } elseif ($request.operation -eq 'snapshot') {
    AssertDesktop
    $root = FindWindow $request.target
    $data = Snapshot $root ([int]$request.depth) ([int]$request.maxElements)
  } elseif ($request.operation -eq 'screenshot') {
    AssertDesktop
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ForgeBridgeWindowCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr window, out RECT rectangle);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr window, IntPtr target, uint flags);
}
'@
    $root = FindWindow $request.target
    $handle = [IntPtr]([long]$root.Current.NativeWindowHandle)
    $rectangle = [ForgeBridgeWindowCapture+RECT]::new()
    if (-not [ForgeBridgeWindowCapture]::GetWindowRect($handle, [ref]$rectangle)) {
      Fail 'screenshot_failed' 'Could not read the target window bounds'
    }
    $width = $rectangle.Right - $rectangle.Left
    $height = $rectangle.Bottom - $rectangle.Top
    if ($width -le 0 -or $height -le 0 -or $width -gt 16384 -or $height -gt 16384 -or ([long]$width * $height) -gt 100000000) {
      Fail 'invalid_window_bounds' 'Window bounds are empty or exceed the screenshot limit'
    }
    $bitmap = [System.Drawing.Bitmap]::new($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $deviceContext = $graphics.GetHdc()
      try {
        if (-not [ForgeBridgeWindowCapture]::PrintWindow($handle, $deviceContext, 2)) {
          Fail 'screenshot_failed' 'The target window did not provide a visual fallback image'
        }
      } finally {
        $graphics.ReleaseHdc($deviceContext)
      }
      $bitmap.Save([string]$request.path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    $data = @{ path = [string]$request.path; width = $width; height = $height }
  } elseif ($request.operation -eq 'act') {
    AssertDesktop
    $foregroundBefore = [long][ForgeBridgeForegroundGuard]::GetForegroundWindow()
    $root = FindWindow $request.target
    $element = FindElement $root $request.locator ([int]$request.maxElements)
    if ($request.action -eq 'invoke') {
      $pattern = Pattern $element ([System.Windows.Automation.InvokePattern]::Pattern) 'Invoke'
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    } elseif ($request.action -eq 'set_value') {
      $pattern = Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern) 'Value'
      ([System.Windows.Automation.ValuePattern]$pattern).SetValue([string]$request.value)
    } elseif ($request.action -eq 'toggle') {
      $pattern = Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern) 'Toggle'
      ([System.Windows.Automation.TogglePattern]$pattern).Toggle()
    } elseif ($request.action -eq 'select') {
      $pattern = Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern) 'SelectionItem'
      ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
    } elseif ($request.action -eq 'expand' -or $request.action -eq 'collapse') {
      $pattern = Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern) 'ExpandCollapse'
      if ($request.action -eq 'expand') {
        ([System.Windows.Automation.ExpandCollapsePattern]$pattern).Expand()
      } else {
        ([System.Windows.Automation.ExpandCollapsePattern]$pattern).Collapse()
      }
    } elseif ($request.action -eq 'focus') {
      $element.SetFocus()
    } else {
      Fail 'unsupported_action' 'Unsupported UI Automation action'
    }
    $foregroundAfter = [long][ForgeBridgeForegroundGuard]::GetForegroundWindow()
    $data = @{
      completed = $true
      element = ElementObject $element 0
      foregroundBefore = $foregroundBefore
      foregroundAfter = $foregroundAfter
      foregroundChanged = $foregroundBefore -ne $foregroundAfter
      provenance = 'untrusted_desktop_content'
    }
  } else {
    Fail 'unsupported_operation' 'Unsupported UI Automation operation'
  }
  [Console]::Out.WriteLine((@{ ok = $true; data = $data } | ConvertTo-Json -Compress -Depth 12))
} catch {
  $message = $_.Exception.Message
  $code = 'uia_failed'
  if ($message -match '^([a-z_]+)::(.*)$') {
    $code = $Matches[1]
    $message = $Matches[2]
  }
  [Console]::Out.WriteLine((@{ ok = $false; code = $code; message = $message } | ConvertTo-Json -Compress -Depth 4))
  exit 1
}
`;

export class WindowsUiAutomation {
  readonly #enabled: boolean;
  readonly #executable: string;
  readonly #timeoutMs: number;
  readonly #maxElements: number;
  readonly #maxArtifactBytes: number;
  readonly #pathGuard?: PathGuard;
  readonly #artifactDirectory?: string;
  readonly #executionPolicy?: ExecutionPolicy;
  readonly #foregroundQueue?: ForegroundActionQueue;

  constructor(options: {
    enabled: boolean;
    powershellPath?: string;
    timeoutMs?: number;
    maxElements?: number;
    maxArtifactBytes?: number;
    pathGuard?: PathGuard;
    artifactDirectory?: string;
    executionPolicy?: ExecutionPolicy;
    foregroundQueue?: ForegroundActionQueue;
  }) {
    this.#enabled = options.enabled;
    if (options.powershellPath && !path.isAbsolute(options.powershellPath)) {
      throw new ForgeBridgeError(
        'invalid_config',
        'windowsUiAutomation.powershellPath must be an absolute path',
      );
    }
    this.#executable =
      options.powershellPath ??
      path.join(
        process.env['SystemRoot'] ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxElements = options.maxElements ?? 500;
    this.#maxArtifactBytes = Math.max(1, options.maxArtifactBytes ?? 100 * 1024 * 1024);
    this.#pathGuard = options.pathGuard;
    this.#artifactDirectory = options.artifactDirectory;
    this.#executionPolicy = options.executionPolicy;
    this.#foregroundQueue = options.foregroundQueue;
  }

  async status(): Promise<Record<string, unknown>> {
    if (!this.#enabled || process.platform !== 'win32') {
      return {
        enabled: this.#enabled,
        supported: process.platform === 'win32',
        desktopAvailable: false,
        platform: process.platform,
      };
    }
    return this.execute({ operation: 'status' });
  }

  async windows(limit = 100): Promise<Record<string, unknown>> {
    return this.execute({ operation: 'windows', limit: Math.max(1, Math.min(limit, 500)) });
  }

  async snapshot(
    target: WindowsTarget,
    options: { depth?: number; maxElements?: number } = {},
  ): Promise<Record<string, unknown>> {
    return this.execute({
      operation: 'snapshot',
      target,
      depth: Math.max(0, Math.min(options.depth ?? 8, 32)),
      maxElements: Math.max(1, Math.min(options.maxElements ?? this.#maxElements, 2000)),
    });
  }

  async screenshot(
    target: WindowsTarget,
    requestedPath?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.#pathGuard || !this.#artifactDirectory) {
      throw new ForgeBridgeError(
        'uia_unavailable',
        'UI Automation screenshot storage is unavailable',
      );
    }
    const destination = await this.#pathGuard.resolve(
      requestedPath ?? path.join(this.#artifactDirectory, `uia-screenshot-${randomUUID()}.png`),
    );
    if (this.#pathGuard.isSensitive(destination)) {
      throw new ForgeBridgeError('sensitive_path', 'Screenshots cannot replace sensitive files');
    }
    const temporary = requestedPath
      ? await this.#pathGuard.resolve(
          path.join(this.#artifactDirectory, `uia-screenshot-${randomUUID()}.png`),
        )
      : destination;
    let keepDefaultArtifact = false;
    try {
      const result = await this.execute({
        operation: 'screenshot',
        target,
        path: temporary.canonical,
      });
      const bytes = (await stat(temporary.canonical)).size;
      if (bytes > this.#maxArtifactBytes) {
        throw new ForgeBridgeError(
          'transfer_too_large',
          'UI Automation screenshot exceeds the configured limit',
          { limit: this.#maxArtifactBytes },
        );
      }
      if (!requestedPath) {
        keepDefaultArtifact = true;
        return { ...result, bytes };
      }
      try {
        await copyFile(temporary.canonical, destination.canonical, fileConstants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ForgeBridgeError('already_exists', 'Screenshot destination already exists', {
            path: destination.canonical,
          });
        }
        throw error;
      }
      return { ...result, path: destination.canonical, bytes };
    } finally {
      if (requestedPath || !keepDefaultArtifact) {
        await rm(temporary.canonical, { force: true });
      }
    }
  }

  async act(
    target: WindowsTarget,
    locator: WindowsLocator,
    action: 'invoke' | 'set_value' | 'toggle' | 'select' | 'expand' | 'collapse' | 'focus',
    value?: string,
  ): Promise<Record<string, unknown>> {
    if (
      action === 'focus' &&
      this.#executionPolicy &&
      !this.#executionPolicy.current().foregroundAllowed
    ) {
      if (!this.#foregroundQueue) {
        throw new ForgeBridgeError(
          'foreground_required',
          'This action requires foreground access, which the execution profile forbids',
        );
      }
      const queued = await this.#foregroundQueue.enqueue({
        kind: 'windows_uia',
        application:
          'windowTitle' in target
            ? target.windowTitle
            : 'processId' in target
              ? `process ${target.processId}`
              : `window ${target.windowHandle}`,
        requestedAction: action,
        reason: 'SetFocus can change the active foreground application',
        estimatedInterruption: 'Usually less than 5 seconds',
        payload: { target, locator, action },
      });
      throw new ForgeBridgeError(
        'foreground_required',
        'The action was deferred because foreground access is disabled',
        {
          foregroundActionId: queued.id,
          application: queued.application,
          requestedAction: queued.requestedAction,
          reason: queued.reason,
          estimatedInterruption: queued.estimatedInterruption,
          requiredPermission: queued.requiredPermission,
        },
        true,
      );
    }
    return this.execute({
      operation: 'act',
      target,
      locator,
      action,
      maxElements: this.#maxElements,
      ...(value === undefined ? {} : { value }),
    });
  }

  async resumeApproved(): Promise<{ completed: string[]; failed: string[] }> {
    const completed: string[] = [];
    const failed: string[] = [];
    if (!this.#foregroundQueue || !this.#executionPolicy?.current().foregroundAllowed) {
      return { completed, failed };
    }
    for (const record of this.#foregroundQueue.list(['approved'])) {
      try {
        const action = QueuedWindowsActionSchema.parse(record.payload);
        await this.execute({
          operation: 'act',
          target: action.target,
          locator: action.locator,
          action: action.action,
          maxElements: this.#maxElements,
        });
        await this.#foregroundQueue.complete(record.id);
        completed.push(record.id);
      } catch (error) {
        await this.#foregroundQueue.fail(record.id, errorMessage(error));
        failed.push(record.id);
      }
    }
    return { completed, failed };
  }

  private async execute(request: HelperRequest): Promise<Record<string, unknown>> {
    if (!this.#enabled) {
      throw new ForgeBridgeError(
        'feature_disabled',
        'Windows UI Automation is disabled; enable windowsUiAutomation in local configuration',
      );
    }
    if (process.platform !== 'win32') {
      throw new ForgeBridgeError(
        'platform_unsupported',
        'Windows UI Automation is available only on Windows',
      );
    }
    const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
    let stdout: string;
    try {
      const result = await execFileAsync(
        this.#executable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', this.encodedHelper()],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: this.#timeoutMs,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...filteredEnvironment(), FORGEBRIDGE_UIA_REQUEST: encoded },
        },
      );
      stdout = result.stdout;
    } catch (error) {
      const candidate = error as Error & {
        code?: string;
        killed?: boolean;
        stdout?: string;
      };
      if (candidate.killed) {
        throw new ForgeBridgeError('uia_timeout', 'Windows UI Automation helper timed out');
      }
      const parsed = this.parseResponse(candidate.stdout);
      if (parsed && !parsed.ok) {
        throw new ForgeBridgeError(parsed.code, parsed.message);
      }
      throw new ForgeBridgeError(
        candidate.code === 'ENOENT' ? 'uia_unavailable' : 'uia_failed',
        candidate.code === 'ENOENT'
          ? `Could not find Windows PowerShell at ${this.#executable}`
          : errorMessage(error),
      );
    }
    const parsed = this.parseResponse(stdout);
    if (!parsed) {
      throw new ForgeBridgeError(
        'uia_invalid_response',
        'UI Automation helper returned invalid JSON',
      );
    }
    if (!parsed.ok) throw new ForgeBridgeError(parsed.code, parsed.message);
    if (!parsed.data || typeof parsed.data !== 'object') return { value: parsed.data };
    return parsed.data as Record<string, unknown>;
  }

  private parseResponse(
    value: string | undefined,
  ): z.infer<typeof HelperResponseSchema> | undefined {
    const line = value
      ?.split(/\r?\n/u)
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1);
    if (!line) return undefined;
    try {
      return HelperResponseSchema.parse(JSON.parse(line));
    } catch {
      return undefined;
    }
  }

  private encodedHelper(): string {
    return Buffer.from(UIA_HELPER, 'utf16le').toString('base64');
  }
}

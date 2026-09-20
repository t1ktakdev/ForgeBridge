import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuditLedger } from './core/audit.js';
import type { ExecutionProfile, ForgeBridgeConfig, ProjectAutonomy } from './core/config.js';
import { AuthorizedDispatcher } from './core/dispatcher.js';
import { ForgeBridgeError } from './core/errors.js';
import { DeviceIdentityStore, type DeviceIdentity } from './core/identity.js';
import { Redactor } from './core/redactor.js';
import { BrowserManager } from './browser/manager.js';
import { FileService } from './filesystem/service.js';
import { PathGuard } from './filesystem/path-guard.js';
import { GitService } from './git/service.js';
import { JobManager } from './jobs/manager.js';
import { ApprovalStore } from './policy/approvals.js';
import { PermissionEngine } from './policy/engine.js';
import type { PermissionMode } from './policy/types.js';
import { shellContract } from './terminal/host.js';
import { TerminalManager } from './terminal/manager.js';
import { WindowsUiAutomation } from './windows/uia.js';
import { ExecutionPolicy, ResourceGovernor } from './execution/policy.js';
import { ForegroundActionQueue } from './execution/foreground-queue.js';
import { ensurePrivateDirectory } from './core/file-permissions.js';

export class ForgeBridgeAgent {
  readonly config: ForgeBridgeConfig;
  readonly stateDirectory: string;
  readonly identity: DeviceIdentity;
  readonly redactor: Redactor;
  readonly audit: AuditLedger;
  readonly approvals: ApprovalStore;
  readonly permissions: PermissionEngine;
  readonly files: FileService;
  readonly terminal: TerminalManager;
  readonly jobs: JobManager;
  readonly git: GitService;
  readonly browser: BrowserManager;
  readonly windowsUiAutomation: WindowsUiAutomation;
  readonly executionPolicy: ExecutionPolicy;
  readonly resources: ResourceGovernor;
  readonly foregroundActions: ForegroundActionQueue;
  readonly dispatcher: AuthorizedDispatcher;
  #paused = false;

  private constructor(options: {
    config: ForgeBridgeConfig;
    stateDirectory: string;
    identity: DeviceIdentity;
    redactor: Redactor;
    audit: AuditLedger;
    approvals: ApprovalStore;
    permissions: PermissionEngine;
    files: FileService;
    terminal: TerminalManager;
    jobs: JobManager;
    git: GitService;
    browser: BrowserManager;
    windowsUiAutomation: WindowsUiAutomation;
    executionPolicy: ExecutionPolicy;
    resources: ResourceGovernor;
    foregroundActions: ForegroundActionQueue;
  }) {
    Object.assign(this, options);
    this.config = options.config;
    this.stateDirectory = options.stateDirectory;
    this.identity = options.identity;
    this.redactor = options.redactor;
    this.audit = options.audit;
    this.approvals = options.approvals;
    this.permissions = options.permissions;
    this.files = options.files;
    this.terminal = options.terminal;
    this.jobs = options.jobs;
    this.git = options.git;
    this.browser = options.browser;
    this.windowsUiAutomation = options.windowsUiAutomation;
    this.executionPolicy = options.executionPolicy;
    this.resources = options.resources;
    this.foregroundActions = options.foregroundActions;
    this.dispatcher = new AuthorizedDispatcher({
      permissions: this.permissions,
      audit: this.audit,
      redactor: this.redactor,
      isPaused: () => this.#paused,
    });
  }

  static async create(
    config: ForgeBridgeConfig,
    stateDirectory: string,
    protectedPaths: readonly string[] = [],
  ): Promise<ForgeBridgeAgent> {
    await ensurePrivateDirectory(stateDirectory);
    const redactor = new Redactor();
    const identity = await new DeviceIdentityStore(stateDirectory).loadOrCreate();
    const audit = new AuditLedger(stateDirectory, redactor);
    await audit.initialize();
    const approvals = new ApprovalStore(stateDirectory, config.limits.approvalTtlMs);
    await approvals.initialize();
    const permissions = new PermissionEngine(config, approvals, redactor);
    const executionPolicy = new ExecutionPolicy(config.execution);
    const resources = new ResourceGovernor(executionPolicy);
    const foregroundActions = new ForegroundActionQueue(stateDirectory);
    await foregroundActions.initialize();
    const guard = await PathGuard.create(
      config.roots.map((root) => root.path),
      [stateDirectory, ...protectedPaths],
    );
    const files = new FileService(guard, config.limits);
    const terminal = new TerminalManager(
      config.limits.maxOutputBytes,
      config.limits.commandTimeoutMs,
      executionPolicy,
      resources,
    );
    const jobs = new JobManager(
      stateDirectory,
      config.limits.maxOutputBytes,
      redactor,
      executionPolicy,
      resources,
    );
    await jobs.initialize();
    const git = new GitService(guard, config.limits.maxOutputBytes, config.limits.commandTimeoutMs);
    const firstRoot = guard.roots[0];
    if (!firstRoot) throw new Error('At least one allowed root is required');
    const artifactDirectory = path.join(firstRoot, '.forgebridge', 'artifacts');
    await mkdir(artifactDirectory, { recursive: true });
    const browser = new BrowserManager({
      headless: () => executionPolicy.browserHeadless(config.browser.headless),
      maxInstances: () => executionPolicy.current().maxBrowserInstances,
      allowedOrigins: config.browser.allowedOrigins,
      pathGuard: guard,
      artifactDirectory,
      maxTransferBytes: config.browser.maxTransferBytes,
      maxObservationEntries: config.browser.maxObservationEntries,
      ...(config.browser.executablePath ? { executablePath: config.browser.executablePath } : {}),
    });
    const windowsUiAutomation = new WindowsUiAutomation({
      enabled: config.windowsUiAutomation.enabled,
      timeoutMs: config.windowsUiAutomation.timeoutMs,
      maxElements: config.windowsUiAutomation.maxElements,
      maxArtifactBytes: config.browser.maxTransferBytes,
      pathGuard: guard,
      artifactDirectory,
      executionPolicy,
      foregroundQueue: foregroundActions,
      ...(config.windowsUiAutomation.powershellPath
        ? { powershellPath: config.windowsUiAutomation.powershellPath }
        : {}),
    });
    return new ForgeBridgeAgent({
      config,
      stateDirectory,
      identity,
      redactor,
      audit,
      approvals,
      permissions,
      files,
      terminal,
      jobs,
      git,
      browser,
      windowsUiAutomation,
      executionPolicy,
      resources,
      foregroundActions,
    });
  }

  get paused(): boolean {
    return this.#paused;
  }

  pause(): void {
    this.#paused = true;
    this.permissions.clearSessionGrants();
  }

  resume(): void {
    this.#paused = false;
  }

  setMode(mode: PermissionMode): void {
    this.config.mode = mode;
  }

  async setExecutionProfile(profile: ExecutionProfile): Promise<Record<string, unknown>> {
    this.executionPolicy.setProfile(profile);
    await this.browser.closeAll();
    return this.windowsUiAutomation.resumeApproved();
  }

  async setBackgroundMode(enabled: boolean): Promise<Record<string, unknown>> {
    this.executionPolicy.setBackgroundMode(enabled);
    await this.browser.closeAll();
    return this.windowsUiAutomation.resumeApproved();
  }

  async respondForegroundAction(
    id: string,
    response: 'approve' | 'defer' | 'cancel',
  ): Promise<Record<string, unknown>> {
    const action = await this.foregroundActions.respond(id, response);
    const resumed =
      response === 'approve' ? await this.windowsUiAutomation.resumeApproved() : undefined;
    return { action, ...(resumed ? { resumed } : {}) };
  }

  async setProjectPolicy(
    root: string,
    mode: PermissionMode,
    autonomy: ProjectAutonomy = 'standard',
  ): Promise<void> {
    const resolved = await this.files.guard.resolve(root);
    const information = await this.files.stat(resolved.canonical);
    if (information['type'] !== 'directory') {
      throw new ForgeBridgeError('invalid_project_root', 'Project root must be a directory');
    }
    const comparable = (value: string): string =>
      process.platform === 'win32'
        ? path.resolve(value).toLocaleLowerCase('en-US')
        : path.resolve(value);
    const existing = this.config.projectProfiles.find(
      (profile) => comparable(profile.root) === comparable(resolved.canonical),
    );
    if (existing) {
      existing.mode = mode;
      existing.autonomy = autonomy;
    } else {
      this.config.projectProfiles.push({ root: resolved.canonical, mode, autonomy, rules: [] });
    }
  }

  async setProjectMode(root: string, mode: PermissionMode): Promise<void> {
    const current = this.config.projectProfiles.find((profile) => {
      const left =
        process.platform === 'win32'
          ? path.resolve(profile.root).toLocaleLowerCase('en-US')
          : path.resolve(profile.root);
      const right =
        process.platform === 'win32'
          ? path.resolve(root).toLocaleLowerCase('en-US')
          : path.resolve(root);
      return left === right;
    });
    await this.setProjectPolicy(root, mode, current?.autonomy ?? 'standard');
  }

  async setProjectAutonomy(root: string, autonomy: ProjectAutonomy): Promise<void> {
    const current = this.config.projectProfiles.find((profile) => {
      const left =
        process.platform === 'win32'
          ? path.resolve(profile.root).toLocaleLowerCase('en-US')
          : path.resolve(profile.root);
      const right =
        process.platform === 'win32'
          ? path.resolve(root).toLocaleLowerCase('en-US')
          : path.resolve(root);
      return left === right;
    });
    await this.setProjectPolicy(root, current?.mode ?? this.config.mode, autonomy);
  }

  async removeProjectProfile(root: string): Promise<boolean> {
    const resolved = await this.files.guard.resolve(root);
    const target =
      process.platform === 'win32'
        ? path.resolve(resolved.canonical).toLocaleLowerCase('en-US')
        : path.resolve(resolved.canonical);
    const before = this.config.projectProfiles.length;
    this.config.projectProfiles = this.config.projectProfiles.filter((profile) => {
      const candidate =
        process.platform === 'win32'
          ? path.resolve(profile.root).toLocaleLowerCase('en-US')
          : path.resolve(profile.root);
      return candidate !== target;
    });
    return this.config.projectProfiles.length !== before;
  }

  async revoke(): Promise<void> {
    this.#paused = true;
    this.permissions.clearAllGrants();
    await this.approvals.revokeAll();
    await this.foregroundActions.cancelAll();
    await this.browser.closeAll();
  }

  status(): Record<string, unknown> {
    return {
      version: 1,
      device: {
        id: this.identity.deviceId,
        name: this.identity.deviceName,
        fingerprint: this.identity.fingerprint,
      },
      platform: {
        os: process.platform,
        release: os.release(),
        architecture: process.arch,
        node: process.version,
        shell: shellContract(),
      },
      mode: this.permissions.mode,
      paused: this.#paused,
      execution: {
        ...this.executionPolicy.current(),
        resources: this.resources.status(),
        foregroundActions: this.foregroundActions.list(['pending', 'approved', 'deferred']),
      },
      roots: this.config.roots.map((root) => ({
        path: root.path,
        capabilities: root.capabilities,
      })),
      projectProfiles: this.config.projectProfiles.map((profile) => ({
        root: profile.root,
        mode: profile.mode,
        autonomy: profile.autonomy ?? 'standard',
        rules: profile.rules,
      })),
      activeGrants: this.permissions.listGrants(),
      pendingApprovals: this.approvals.listPending(),
      jobs: this.jobs.list({ limit: 25 }),
      terminalSessions: this.terminal.list(),
      windowsUiAutomation: {
        enabled: this.config.windowsUiAutomation.enabled,
        supported: process.platform === 'win32',
      },
    };
  }

  async close(options: { cancelJobs?: boolean } = {}): Promise<void> {
    this.permissions.clearSessionGrants();
    await this.browser.closeAll();
    await this.terminal.close();
    await this.jobs.close(options.cancelJobs ?? false);
  }
}

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
import { canonicalPath, PathGuard } from './filesystem/path-guard.js';
import { GitService } from './git/service.js';
import { JobManager } from './jobs/manager.js';
import { ApprovalStore } from './policy/approvals.js';
import { PermissionEngine } from './policy/engine.js';
import type { PermissionMode, PolicyRule } from './policy/types.js';
import { shellContract } from './terminal/host.js';
import { TerminalManager } from './terminal/manager.js';
import { WindowsUiAutomation } from './windows/uia.js';
import { ExecutionPolicy, ResourceGovernor } from './execution/policy.js';
import { ForegroundActionQueue } from './execution/foreground-queue.js';
import { ensurePrivateDirectory } from './core/file-permissions.js';
import { FORGEBRIDGE_VERSION } from './version.js';

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
  #transport: 'stdio' | 'http' | 'unknown' = 'unknown';

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
    const guard = await PathGuard.create(
      config.roots.map((root) => root.path),
      [stateDirectory, ...protectedPaths],
    );
    // Pin policy scopes to the same physical paths used by filesystem authorization.
    const normalizeRule = async (rule: PolicyRule): Promise<PolicyRule> => {
      const scope = rule.scope;
      if (!scope || (scope.kind !== 'path' && scope.kind !== 'repository')) return rule;
      return { ...rule, scope: { ...scope, value: await canonicalPath(scope.value) } };
    };
    config.roots = await Promise.all(
      config.roots.map(async (root) => ({
        ...root,
        path: (await guard.resolve(root.path)).canonical,
      })),
    );
    config.rules = await Promise.all(config.rules.map(normalizeRule));
    config.projectProfiles = await Promise.all(
      config.projectProfiles.map(async (profile) => ({
        ...profile,
        root: await canonicalPath(profile.root),
        rules: await Promise.all(profile.rules.map(normalizeRule)),
      })),
    );
    const permissions = new PermissionEngine(config, approvals, redactor);
    const executionPolicy = new ExecutionPolicy(config.execution);
    const resources = new ResourceGovernor(executionPolicy);
    const foregroundActions = new ForegroundActionQueue(stateDirectory);
    await foregroundActions.initialize();
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

  setTransport(transport: 'stdio' | 'http' | 'unknown'): void {
    this.#transport = transport;
  }

  async renameDevice(deviceName: string): Promise<void> {
    const updated = await new DeviceIdentityStore(this.stateDirectory).rename(deviceName);
    Object.assign(this.identity, updated);
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
    const resolvedRoot = (await this.files.guard.resolve(root)).canonical;
    const current = this.config.projectProfiles.find((profile) => {
      const left =
        process.platform === 'win32'
          ? path.resolve(profile.root).toLocaleLowerCase('en-US')
          : path.resolve(profile.root);
      const right =
        process.platform === 'win32'
          ? path.resolve(resolvedRoot).toLocaleLowerCase('en-US')
          : path.resolve(resolvedRoot);
      return left === right;
    });
    await this.setProjectPolicy(resolvedRoot, mode, current?.autonomy ?? 'standard');
  }

  async setProjectAutonomy(root: string, autonomy: ProjectAutonomy): Promise<void> {
    const resolvedRoot = (await this.files.guard.resolve(root)).canonical;
    const current = this.config.projectProfiles.find((profile) => {
      const left =
        process.platform === 'win32'
          ? path.resolve(profile.root).toLocaleLowerCase('en-US')
          : path.resolve(profile.root);
      const right =
        process.platform === 'win32'
          ? path.resolve(resolvedRoot).toLocaleLowerCase('en-US')
          : path.resolve(resolvedRoot);
      return left === right;
    });
    await this.setProjectPolicy(resolvedRoot, current?.mode ?? this.config.mode, autonomy);
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
    const capabilities = [
      ...new Set(this.config.roots.flatMap((root) => root.capabilities)),
    ].sort();
    const activeProject =
      this.config.projectProfiles[0]?.root ?? this.config.roots[0]?.path ?? null;
    const lastSeen = new Date().toISOString();
    const health = this.#paused ? 'paused' : 'ready';
    return {
      version: 1,
      device: {
        id: this.identity.deviceId,
        name: this.identity.deviceName,
        hostname: os.hostname(),
        fingerprint: this.identity.fingerprint,
        createdAt: this.identity.createdAt,
        forgeBridgeVersion: FORGEBRIDGE_VERSION,
        capabilities,
        health,
        lastSeen,
        transport: this.#transport,
        activeProject,
        executionProfile: this.executionPolicy.current().profile,
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
      browserSessions: this.browser.list(),
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

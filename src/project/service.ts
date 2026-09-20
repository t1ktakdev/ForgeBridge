import path from 'node:path';
import { z } from 'zod';
import type { ForgeBridgeAgent } from '../agent.js';
import type { DispatchRequest } from '../core/dispatcher.js';
import { ForgeBridgeError, asForgeBridgeError } from '../core/errors.js';
import { sha256, stableStringify } from '../core/json.js';
import type { FileEntry } from '../filesystem/service.js';
import { environmentInfo, packageManagerInfo, runtimeInfo } from '../terminal/host.js';
import { classifyCommand } from '../terminal/process-utils.js';
import { detectEcosystems } from './detectors.js';

const MANIFEST_BYTES = 128 * 1024;
const SCRIPT_LIMIT = 80;
const GENERATED = new Set([
  'node_modules',
  '.git',
  '.forgebridge',
  'dist',
  'build',
  'coverage',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  'bin',
  'obj',
]);
const MANIFESTS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'global.json',
];
const PackageSchema = z.object({
  name: z.string().max(256).optional(),
  version: z.string().max(128).optional(),
  engines: z.record(z.string(), z.string()).optional(),
  packageManager: z.string().max(256).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z
    .union([z.array(z.string()), z.object({ packages: z.array(z.string()) })])
    .optional(),
  main: z.string().optional(),
  module: z.string().optional(),
  types: z.string().optional(),
});
type PackageManifest = z.infer<typeof PackageSchema>;
export const CHECK_KINDS = ['test', 'lint', 'typecheck', 'build', 'check'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
type Manifest = { path: string; sha256: string; content: string };
const TOOLS: Record<string, string> = {
  typescript: 'typechecker',
  vitest: 'test runner',
  jest: 'test runner',
  mocha: 'test runner',
  playwright: 'browser automation',
  '@playwright/test': 'test runner',
  eslint: 'lint',
  prettier: 'formatter',
  vite: 'build',
  webpack: 'build',
  rollup: 'build',
  esbuild: 'build',
  next: 'framework',
  react: 'framework',
  vue: 'framework',
  svelte: 'framework',
  express: 'framework',
  fastify: 'framework',
  '@nestjs/core': 'framework',
  '@modelcontextprotocol/sdk': 'MCP SDK',
};

/** Bounded manifest inspection. Every content read has its own canonical path permission check. */
export class ProjectService {
  constructor(
    private readonly agent: ForgeBridgeAgent,
    private readonly request: DispatchRequest,
  ) {}

  private async read(requested: string): Promise<Manifest> {
    const resolved = await this.agent.files.guard.resolve(requested);
    const result = await this.agent.dispatcher.run(
      { ...this.request, operation: 'manifest_read', arguments: { path: resolved.canonical } },
      [{ capability: 'filesystem.read', scope: { kind: 'path', value: resolved.canonical } }],
      () =>
        this.agent.files.read(resolved.canonical, {
          length: MANIFEST_BYTES,
          maximumFileBytes: MANIFEST_BYTES,
        }),
    );
    if (
      result['binary'] ||
      !result['eof'] ||
      typeof result['content'] !== 'string' ||
      typeof result['sha256'] !== 'string'
    ) {
      throw new ForgeBridgeError('invalid_manifest', 'Manifest must be a bounded UTF-8 text file', {
        path: resolved.canonical,
      });
    }
    return { path: resolved.canonical, content: result['content'], sha256: result['sha256'] };
  }

  private async list(requested: string) {
    const resolved = await this.agent.files.guard.resolve(requested);
    return this.agent.dispatcher.run(
      { ...this.request, operation: 'directory_list', arguments: { path: resolved.canonical } },
      [{ capability: 'filesystem.read', scope: { kind: 'path', value: resolved.canonical } }],
      () => this.agent.files.list(resolved.canonical, { limit: 256 }),
    );
  }

  async locate(workingDirectory: string) {
    const requested = await this.agent.files.guard.resolve(workingDirectory);
    let root = requested.canonical;
    for (let depth = 0; depth < 8; depth++) {
      const listing = await this.list(root);
      if (
        listing.entries.some(
          (e) => MANIFESTS.includes(e.name) || /\.(?:csproj|fsproj|sln)$/iu.test(e.name),
        )
      ) {
        return { root, permittedRoot: requested.root, listing, detected: true };
      }
      if (root === requested.root || listing.entries.some((e) => e.name === '.git')) break;
      const parent = path.dirname(root);
      if (parent === root) break;
      root = parent;
    }
    return {
      root: requested.canonical,
      permittedRoot: requested.root,
      listing: await this.list(requested.canonical),
      detected: false,
    };
  }

  private async nodeManifest(root: string) {
    const manifest = await this.read(path.join(root, 'package.json'));
    let parsed: PackageManifest;
    try {
      parsed = PackageSchema.parse(JSON.parse(manifest.content));
    } catch {
      throw new ForgeBridgeError(
        'invalid_manifest',
        'package.json does not contain a valid bounded package manifest',
        { path: manifest.path },
      );
    }
    const scripts = Object.entries(parsed.scripts ?? {}).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return { manifest, parsed, scripts };
  }

  async scripts(workingDirectory: string) {
    const located = await this.locate(workingDirectory);
    const node = await this.nodeManifest(located.root);
    const permissionPolicy = this.agent.permissions.effectivePolicy({
      kind: 'path',
      value: located.root,
    });
    return {
      workingDirectory: located.root,
      manifest: node.manifest.path,
      manifestSha256: node.manifest.sha256,
      packageManager: node.parsed.packageManager ?? null,
      checks: node.scripts.slice(0, SCRIPT_LIMIT).flatMap(([name]) => {
        const kind = CHECK_KINDS.find((kind) => name === kind || name.startsWith(kind + ':'));
        if (!kind) return [];
        try {
          return [this.checkPlan(located.root, node, kind, name)];
        } catch {
          return [];
        }
      }),
      scripts: node.scripts.slice(0, SCRIPT_LIMIT).map(([name, command]) => ({
        name,
        command: command.slice(0, 8192),
        truncated: command.length > 8192,
        kind: CHECK_KINDS.find((kind) => name === kind || name.startsWith(kind + ':')) ?? null,
      })),
      truncated: node.scripts.length > SCRIPT_LIMIT,
      total: node.scripts.length,
      executionContract:
        permissionPolicy.autonomy === 'trusted-local'
          ? 'project_check runs only the selected script body; no implicit pre/post hooks, package-manager bootstrap, or extra flags. cmd /d on Windows; Bash without profiles elsewhere. This project is explicitly trusted for local repository-code execution; destructive commands, push, elevation, persistence, secrets, and out-of-scope access remain gated or denied.'
          : 'project_check runs only the selected script body; no implicit pre/post hooks, package-manager bootstrap, or extra flags. cmd /d on Windows; Bash without profiles elsewhere. Repository code needs exact approval unless the local user marks this project trusted-local.',
      permissionPolicy,
      provenance: 'untrusted_repository_content',
    };
  }

  async resolveCheck(workingDirectory: string, kind: CheckKind, script?: string) {
    const located = await this.locate(workingDirectory);
    const node = await this.nodeManifest(located.root);
    return this.checkPlan(located.root, node, kind, script);
  }

  private checkPlan(
    root: string,
    node: Awaited<ReturnType<ProjectService['nodeManifest']>>,
    kind: CheckKind,
    script?: string,
  ) {
    const name = script ?? kind;
    if (!(name === kind || name.startsWith(kind + ':'))) {
      throw new ForgeBridgeError(
        'invalid_project_script',
        'Choose a script matching the validation kind, such as test or test:unit',
        { kind, script: name },
      );
    }
    const command = node.parsed.scripts?.[name];
    if (
      !command ||
      command.length > 8192 ||
      command.includes('[REDACTED]') ||
      command.includes('\0')
    ) {
      throw new ForgeBridgeError(
        'project_script_unavailable',
        'Selected script is missing, oversized, or contains redacted data; inspect project_scripts',
        { script: name, next_action: 'inspect_project_scripts' },
      );
    }
    const shell = process.platform === 'win32' ? ('cmd' as const) : ('bash' as const);
    const plan = {
      workingDirectory: root,
      manifest: node.manifest.path,
      manifestSha256: node.manifest.sha256,
      kind,
      script: name,
      command,
      shell,
      implicitLifecycleHooks: false,
      extraArguments: [] as string[],
      pathPrefix: [path.join(root, 'node_modules', '.bin'), path.dirname(process.execPath)],
      risk: 'Repository-defined code can modify files, start processes, and access the network. A test script name does not make it read-only.',
    };
    return { ...plan, planSha256: sha256(stableStringify(plan)) };
  }

  async check(
    input: {
      workingDirectory: string;
      kind: CheckKind;
      script?: string;
      planSha256: string;
      timeoutMs?: number;
    },
    signal?: AbortSignal,
  ) {
    const plan = await this.resolveCheck(input.workingDirectory, input.kind, input.script);
    if (plan.planSha256 !== input.planSha256) {
      throw new ForgeBridgeError(
        'project_plan_changed',
        'Validation plan changed; inspect project_inspect or project_scripts before requesting approval',
        { plan, next_action: 'review_updated_plan' },
        true,
      );
    }
    const scope = { kind: 'path' as const, value: plan.workingDirectory };
    const risk = classifyCommand(plan.command);
    // Repository code requires fresh approval unless this exact project is explicitly trusted-local.
    return this.agent.dispatcher.run(
      {
        ...this.request,
        arguments: { ...(this.request.arguments as Record<string, unknown>), plan },
        operation: input.kind,
      },
      [
        { capability: 'process.start', scope },
        ...(risk.flags.includes('package-install')
          ? [{ capability: 'packages.install' as const, scope }]
          : []),
        ...(risk.flags.includes('git-push') ? [{ capability: 'git.push' as const, scope }] : []),
        ...(risk.flags.includes('git-force-push')
          ? [{ capability: 'git.force_push' as const, scope }]
          : []),
        ...(risk.flags.includes('git-destructive')
          ? [{ capability: 'git.reset' as const, scope }]
          : []),
        {
          capability: 'terminal.execute',
          scope,
          flags: [...risk.flags, 'repository-code'],
          risk: plan.risk,
        },
      ],
      async () => {
        // Revalidate after the approval checks. This binds the manifest, not every mutable dependency.
        const current = await this.resolveCheck(input.workingDirectory, input.kind, input.script);
        if (current.planSha256 !== plan.planSha256)
          throw new ForgeBridgeError(
            'project_plan_changed',
            'Manifest changed before execution',
            { next_action: 'inspect_project_scripts' },
            true,
          );
        const result = await this.agent.terminal.run({
          command: plan.command,
          workingDirectory: plan.workingDirectory,
          shell: plan.shell,
          timeoutMs: input.timeoutMs,
          signal,
          environment: {
            PATH: [...plan.pathPrefix, process.env['PATH'] ?? ''].join(path.delimiter),
            npm_lifecycle_event: plan.script,
            npm_lifecycle_script: plan.command,
            npm_package_json: plan.manifest,
            INIT_CWD: plan.workingDirectory,
          },
        });
        if (result.timedOut || result.exitCode !== 0) {
          throw new ForgeBridgeError(
            result.timedOut ? 'process_timeout' : 'process_failed',
            result.timedOut ? 'Project validation timed out' : 'Project validation failed',
            {
              plan,
              result,
              next_action: result.timedOut
                ? 'review_timeout_or_use_jobs'
                : 'inspect_failure_output',
            },
          );
        }
        return { plan, result };
      },
    );
  }

  async inspect(workingDirectory: string) {
    const started = performance.now();
    const located = await this.locate(workingDirectory);
    const permissionPolicy = this.agent.permissions.effectivePolicy({
      kind: 'path',
      value: located.root,
    });
    const entries = located.listing.entries;
    const warnings: { source: string; code: string }[] = [];
    const manifests: { path: string; sha256?: string; ecosystem: string; confidence: string }[] =
      [];
    const manifestEvidence = new Map<string, string>();
    const languages = new Map<string, { source: string; confidence: string }>();
    const nodeEntry = entries.find((e) => e.name === 'package.json');
    let node: Awaited<ReturnType<ProjectService['nodeManifest']>> | undefined;
    if (nodeEntry) {
      try {
        node = await this.nodeManifest(located.root);
        manifests.push({
          path: node.manifest.path,
          sha256: node.manifest.sha256,
          ecosystem: 'Node.js',
          confidence: 'high',
        });
      } catch (error) {
        warnings.push({ source: 'package.json', code: asForgeBridgeError(error).code });
      }
    }
    const ecosystemRules = [
      ['pyproject.toml', 'Python', 'Python'],
      ['requirements.txt', 'Python', 'Python'],
      ['Cargo.toml', 'Rust', 'Rust'],
      ['go.mod', 'Go', 'Go'],
      ['pom.xml', 'Java', 'Java'],
      ['build.gradle', 'JVM', 'Java/Kotlin'],
      ['build.gradle.kts', 'JVM', 'Kotlin'],
      ['global.json', '.NET', ''],
    ];
    for (const [name, ecosystem, language] of ecosystemRules) {
      if (!name || !ecosystem || !entries.some((e) => e.name === name)) continue;
      try {
        const manifest = await this.read(path.join(located.root, name));
        manifestEvidence.set(name, manifest.content);
        manifests.push({
          path: manifest.path,
          sha256: manifest.sha256,
          ecosystem,
          confidence: 'medium',
        });
        if (language) languages.set(language, { source: name, confidence: 'medium' });
      } catch (error) {
        warnings.push({ source: name, code: asForgeBridgeError(error).code });
      }
    }
    for (const e of entries.filter((e) => /\.(?:csproj|fsproj)$/iu.test(e.name)).slice(0, 8)) {
      manifests.push({ path: e.path, ecosystem: '.NET', confidence: 'medium' });
      try {
        const manifest = await this.read(e.path);
        manifestEvidence.set(e.name, manifest.content);
      } catch (error) {
        warnings.push({ source: e.name, code: asForgeBridgeError(error).code });
      }
      languages.set(e.name.endsWith('.fsproj') ? 'F#' : 'C#', {
        source: e.name,
        confidence: 'medium',
      });
    }
    for (const name of ['uv.lock', 'poetry.lock'])
      if (entries.some((entry) => entry.name === name)) manifestEvidence.set(name, '');

    const sourceDirectories = entries.filter(
      (e) =>
        e.type === 'directory' &&
        ['src', 'app', 'apps', 'lib', 'packages', 'server', 'client'].includes(e.name),
    );
    const testDirectories = entries.filter(
      (e) => e.type === 'directory' && ['test', 'tests', '__tests__', 'spec'].includes(e.name),
    );
    const samples: FileEntry[] = [...entries];
    for (const directory of [...sourceDirectories, ...testDirectories].slice(0, 6)) {
      try {
        samples.push(...(await this.list(directory.path)).entries);
      } catch (error) {
        warnings.push({ source: directory.name, code: asForgeBridgeError(error).code });
      }
    }
    const extensionLanguages: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.mjs': 'JavaScript',
      '.py': 'Python',
      '.rs': 'Rust',
      '.go': 'Go',
      '.cs': 'C#',
      '.java': 'Java',
      '.kt': 'Kotlin',
    };
    const counts = new Map<string, number>();
    for (const e of samples) {
      const language = e.type === 'file' ? extensionLanguages[path.extname(e.name)] : undefined;
      if (language) {
        counts.set(language, (counts.get(language) ?? 0) + 1);
        languages.set(language, { source: 'bounded filename sample', confidence: 'high' });
      }
    }
    if (entries.some((e) => e.name === 'tsconfig.json'))
      languages.set('TypeScript', { source: 'tsconfig.json', confidence: 'high' });
    const dependencies = { ...node?.parsed.dependencies, ...node?.parsed.devDependencies };
    const detectedTools = [];
    for (const [name, role] of Object.entries(TOOLS)) {
      if (!dependencies[name]) continue;
      let installedVersion: string | null = null;
      try {
        const installed = JSON.parse(
          (
            await this.read(
              path.join(located.root, 'node_modules', ...name.split('/'), 'package.json'),
            )
          ).content,
        ) as unknown;
        const version = z.object({ version: z.string().max(128) }).parse(installed).version;
        installedVersion = version;
      } catch {
        /* Missing/denied installed metadata is unknown, never executed for discovery. */
      }
      detectedTools.push({
        name,
        role,
        declared: dependencies[name],
        installedVersion,
        source: 'package.json',
      });
    }
    const ecosystem = detectEcosystems(manifestEvidence);
    for (const tool of ecosystem.tools) {
      detectedTools.push({
        ...tool,
        declared: null,
        installedVersion: null,
      });
    }
    const runtimeProbes = await runtimeInfo();
    const runtimeRequirements: Record<string, string> = {
      ...(node?.parsed.engines ?? {}),
    };
    for (const runtime of ecosystem.runtimes)
      if (runtime.declaredRequirement)
        runtimeRequirements[runtime.name] = runtime.declaredRequirement;
    const runtimes = [
      ...(node
        ? [
            {
              name: 'node' as const,
              declaredRequirement: node.parsed.engines?.['node'] ?? null,
              source: 'package.json',
              confidence: 'high' as const,
            },
          ]
        : []),
      ...ecosystem.runtimes,
    ].map((runtime) => ({
      ...runtime,
      installedVersion:
        runtimeProbes.find((probe) => probe.name === runtime.name)?.installedVersion ?? null,
      versionSource:
        runtimeProbes.find((probe) => probe.name === runtime.name)?.source ?? 'not probed',
    }));
    let git: Record<string, unknown>;
    try {
      const repository = await this.agent.dispatcher.run(
        this.request,
        [{ capability: 'git.read', scope: { kind: 'repository', value: located.root } }],
        () => this.agent.git.repositoryRoot(located.root),
      );
      const status = await this.agent.dispatcher.run(
        this.request,
        [{ capability: 'git.read', scope: { kind: 'repository', value: repository } }],
        () => this.agent.git.status(repository),
      );
      const lines = status.stdout.split(/\r?\n/u).filter(Boolean);
      git = {
        root: repository,
        branch: lines[0]?.replace(/^## /u, '') ?? null,
        dirty: status.truncated ? null : lines.length > 1,
        status: lines.slice(1, 41),
        truncated: status.truncated || lines.length > 41,
      };
    } catch (error) {
      git = { available: false, code: asForgeBridgeError(error).code };
    }
    const checks = [];
    if (node)
      for (const kind of CHECK_KINDS) {
        if (node.parsed.scripts?.[kind]) {
          try {
            checks.push(this.checkPlan(located.root, node, kind));
          } catch (error) {
            warnings.push({ source: kind, code: asForgeBridgeError(error).code });
          }
        }
      }
    const packageManagers = await packageManagerInfo();
    const managerName =
      node?.parsed.packageManager?.split('@')[0] ??
      (entries.some((e) => e.name === 'pnpm-lock.yaml')
        ? 'pnpm'
        : entries.some((e) => e.name === 'yarn.lock')
          ? 'yarn'
          : node
            ? 'npm'
            : undefined);
    const manager = packageManagers.find((item) => item.name === managerName);
    const projectPackageManagers = [];
    if (managerName)
      projectPackageManagers.push({
        name: managerName,
        ecosystem: 'Node.js',
        declared: node?.parsed.packageManager ?? null,
        installedVersion: manager?.version ?? null,
        source: manager?.source ?? 'manifest/lockfile evidence only',
      });
    for (const tool of ecosystem.tools.filter((item) => item.role === 'package manager'))
      projectPackageManagers.push({
        name: tool.name,
        ecosystem: tool.source,
        declared: null,
        installedVersion: null,
        source: `${tool.source}; installation not executed for discovery`,
      });
    return {
      projectRoot: located.root,
      rootDetected: located.detected,
      permittedRoot: located.permittedRoot,
      name: node?.parsed.name ?? path.basename(located.root),
      version: node?.parsed.version ?? null,
      host: await environmentInfo(),
      executionProfile: this.agent.executionPolicy.current().profile,
      permissionPolicy,
      languages: [...languages]
        .sort(([a], [b]) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
        .map(([name, evidence]) => ({ name, ...evidence, sampledFiles: counts.get(name) ?? 0 })),
      runtimeRequirements: Object.keys(runtimeRequirements).length > 0 ? runtimeRequirements : null,
      runtimes,
      packageManager: {
        declared: node?.parsed.packageManager ?? null,
        detected: managerName ?? null,
        installedVersion: manager?.version ?? null,
        versionSource:
          manager?.source ??
          'No version metadata found in standard global installation prefixes; no shim executed',
      },
      packageManagers: projectPackageManagers,
      lockfiles: entries
        .filter((e) =>
          [
            'pnpm-lock.yaml',
            'package-lock.json',
            'yarn.lock',
            'bun.lock',
            'uv.lock',
            'poetry.lock',
            'Cargo.lock',
            'go.sum',
            'packages.lock.json',
          ].includes(e.name),
        )
        .map((e) => e.name),
      workspaces: node?.parsed.workspaces ?? null,
      workspaceManifest: entries.some((e) => e.name === 'pnpm-workspace.yaml')
        ? 'pnpm-workspace.yaml'
        : null,
      manifests,
      tools: detectedTools,
      majorDependencies: Object.entries(dependencies)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 25)
        .map(([name, declared]) => ({ name, declared })),
      dependenciesAppearInstalled: entries.some(
        (e) => e.name === 'node_modules' && e.type === 'directory',
      ),
      sourceDirectories: sourceDirectories.map((e) => e.name),
      testDirectories: testDirectories.map((e) => e.name),
      entrypoints: [node?.parsed.main, node?.parsed.module, node?.parsed.types].filter(Boolean),
      generatedDirectories: entries
        .filter((e) => e.type === 'directory' && GENERATED.has(e.name))
        .map((e) => e.name),
      git,
      checks,
      scripts:
        node?.scripts
          .slice(0, SCRIPT_LIMIT)
          .map(([name, command]) => ({ name, command: command.slice(0, 8192) })) ?? [],
      warnings,
      truncated: Boolean(located.listing.nextCursor) || (node?.scripts.length ?? 0) > SCRIPT_LIMIT,
      metrics: { durationMs: Math.round(performance.now() - started), cache: 'none' },
      provenance: 'untrusted_repository_content',
    };
  }
}

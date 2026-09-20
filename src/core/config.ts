import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ForgeBridgeError } from './errors.js';
import { writeFileAtomic } from './atomic.js';
import { restrictPrivateFile } from './file-permissions.js';
import { CAPABILITIES, ModeSchema, PolicyRuleSchema } from '../policy/types.js';

const RootPolicySchema = z.object({
  path: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)).min(1),
});

export const ExecutionProfileSchema = z.enum(['normal', 'background', 'gaming']);
export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;

export const ProjectAutonomySchema = z.enum(['standard', 'trusted-local']);
export type ProjectAutonomy = z.infer<typeof ProjectAutonomySchema>;

export const ProjectProfileSchema = z.object({
  root: z.string().min(1),
  mode: ModeSchema,
  autonomy: ProjectAutonomySchema.optional(),
  rules: z.array(PolicyRuleSchema).default([]),
});

export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

export const ForgeBridgeConfigSchema = z.object({
  version: z.literal(1),
  mode: ModeSchema.default('balanced'),
  roots: z.array(RootPolicySchema).min(1),
  rules: z.array(PolicyRuleSchema).default([]),
  projectProfiles: z.array(ProjectProfileSchema).default([]),
  localHttp: z
    .object({
      host: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
      port: z.number().int().min(1024).max(65535).default(7337),
      allowedOrigins: z.array(z.string()).default([]),
    })
    .default({ host: '127.0.0.1', port: 7337, allowedOrigins: [] }),
  execution: z
    .object({
      backgroundMode: z.boolean().default(true),
      profile: ExecutionProfileSchema.default('background'),
      maxParallelJobs: z.number().int().min(1).max(64).default(4),
      maxCpuConcurrency: z.number().int().min(1).max(64).default(4),
      maxBrowserInstances: z.number().int().min(1).max(16).default(2),
      processPriority: z.enum(['normal', 'below_normal']).default('normal'),
      gaming: z
        .object({
          maxParallelJobs: z.number().int().min(1).max(64).default(1),
          maxCpuConcurrency: z.number().int().min(1).max(64).default(2),
          maxBrowserInstances: z.number().int().min(1).max(16).default(1),
          processPriority: z.enum(['normal', 'below_normal']).default('below_normal'),
        })
        .default({
          maxParallelJobs: 1,
          maxCpuConcurrency: 2,
          maxBrowserInstances: 1,
          processPriority: 'below_normal',
        }),
    })
    .default({
      backgroundMode: true,
      profile: 'background',
      maxParallelJobs: 4,
      maxCpuConcurrency: 4,
      maxBrowserInstances: 2,
      processPriority: 'normal',
      gaming: {
        maxParallelJobs: 1,
        maxCpuConcurrency: 2,
        maxBrowserInstances: 1,
        processPriority: 'below_normal',
      },
    }),
  limits: z
    .object({
      maxReadBytes: z
        .number()
        .int()
        .min(1024)
        .max(16 * 1024 * 1024)
        .default(1024 * 1024),
      maxOutputBytes: z
        .number()
        .int()
        .min(4096)
        .max(64 * 1024 * 1024)
        .default(2 * 1024 * 1024),
      maxFileEntries: z.number().int().min(1).max(100_000).default(10_000),
      maxTreeDepth: z.number().int().min(1).max(64).default(12),
      commandTimeoutMs: z
        .number()
        .int()
        .min(100)
        .max(60 * 60 * 1000)
        .default(120_000),
      approvalTtlMs: z
        .number()
        .int()
        .min(10_000)
        .max(60 * 60 * 1000)
        .default(5 * 60 * 1000),
      maxRequestBytes: z
        .number()
        .int()
        .min(16 * 1024)
        .max(16 * 1024 * 1024)
        .default(2 * 1024 * 1024),
      maxConcurrentRequests: z.number().int().min(1).max(128).default(16),
    })
    .default({
      maxReadBytes: 1024 * 1024,
      maxOutputBytes: 2 * 1024 * 1024,
      maxFileEntries: 10_000,
      maxTreeDepth: 12,
      commandTimeoutMs: 120_000,
      approvalTtlMs: 5 * 60 * 1000,
      maxRequestBytes: 2 * 1024 * 1024,
      maxConcurrentRequests: 16,
    }),
  browser: z
    .object({
      headless: z.boolean().default(true),
      executablePath: z.string().min(1).optional(),
      allowedOrigins: z
        .array(z.string())
        .default(['http://localhost:*', 'http://127.0.0.1:*', 'https://localhost:*']),
      maxTransferBytes: z
        .number()
        .int()
        .min(1024)
        .max(2 * 1024 * 1024 * 1024)
        .default(100 * 1024 * 1024),
      maxObservationEntries: z.number().int().min(10).max(10_000).default(500),
    })
    .default({
      headless: true,
      allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*', 'https://localhost:*'],
      maxTransferBytes: 100 * 1024 * 1024,
      maxObservationEntries: 500,
    }),
  windowsUiAutomation: z
    .object({
      enabled: z.boolean().default(false),
      powershellPath: z.string().min(1).optional(),
      timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
      maxElements: z.number().int().min(1).max(2000).default(500),
    })
    .default({ enabled: false, timeoutMs: 15_000, maxElements: 500 }),
});

export type ForgeBridgeConfig = z.infer<typeof ForgeBridgeConfigSchema>;

export function defaultStateDirectory(): string {
  const base = process.platform === 'win32' ? process.env['LOCALAPPDATA'] : undefined;
  return path.join(
    base ?? os.homedir(),
    process.platform === 'win32' ? 'ForgeBridge' : '.forgebridge',
  );
}

export function defaultConfig(root: string): ForgeBridgeConfig {
  return ForgeBridgeConfigSchema.parse({
    version: 1,
    mode: 'balanced',
    roots: [
      {
        path: path.resolve(root),
        capabilities: [
          'filesystem.read',
          'filesystem.write',
          'filesystem.delete',
          'terminal.readonly',
          'terminal.execute',
          'process.inspect',
          'process.start',
          'process.kill',
          'git.read',
          'git.commit',
          'browser.read',
          'browser.navigate',
          'browser.type',
          'browser.submit',
          'browser.download',
          'browser.upload',
          'windows.read',
          'windows.interact',
          'windows.submit',
          'system.inspect',
          'audit.read',
        ],
      },
    ],
    rules: [],
    projectProfiles: [],
    execution: {
      backgroundMode: true,
      profile: 'background',
      maxParallelJobs: 4,
      maxCpuConcurrency: 4,
      maxBrowserInstances: 2,
      processPriority: 'normal',
      gaming: {
        maxParallelJobs: 1,
        maxCpuConcurrency: 2,
        maxBrowserInstances: 1,
        processPriority: 'below_normal',
      },
    },
  });
}

export async function saveConfig(file: string, config: ForgeBridgeConfig): Promise<void> {
  const validated = ForgeBridgeConfigSchema.parse(config);
  await writeFileAtomic(file, `${JSON.stringify(validated, null, 2)}\n`, 0o600);
  await restrictPrivateFile(file);
}

export async function loadConfig(file: string): Promise<ForgeBridgeConfig> {
  try {
    return ForgeBridgeConfigSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ForgeBridgeError('invalid_config', `Could not load ForgeBridge config: ${message}`, {
      file,
    });
  }
}

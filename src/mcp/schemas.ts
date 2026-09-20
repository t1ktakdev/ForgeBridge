import { z } from 'zod';
import { SHELL_KINDS } from '../terminal/manager.js';

const pathValue = z
  .string()
  .min(1)
  .max(32_767)
  .describe('Path inside configured ForgeBridge roots. Prefer an absolute host-native path.');
const workingDirectoryValue = pathValue.describe(
  'Project/command directory. Canonical argument is workingDirectory, not cwd.',
);
const approvalFields = {
  approvalIds: z.array(z.uuid()).max(8).optional(),
};
const pageFields = { pageId: z.uuid().optional() };

export const FsReadInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('stat'), path: pathValue, ...approvalFields }).strict(),
  z
    .object({
      operation: z.literal('list'),
      path: pathValue,
      cursor: z.string().max(4096).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('tree'),
      path: pathValue,
      depth: z.number().int().min(0).max(64).optional(),
      maxEntries: z.number().int().min(1).max(100_000).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('read'),
      path: pathValue,
      offset: z.number().int().nonnegative().optional(),
      length: z
        .number()
        .int()
        .positive()
        .max(16 * 1024 * 1024)
        .optional(),
      encoding: z.enum(['utf8', 'base64']).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('search'),
      path: pathValue,
      query: z.string().min(1).max(1024),
      maxResults: z.number().int().min(1).max(2000).optional(),
      depth: z.number().int().min(0).max(64).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('search_content'),
      path: pathValue,
      query: z.string().min(1).max(4096),
      glob: z.string().max(1024).optional(),
      maxResults: z.number().int().min(1).max(2000).optional(),
      timeoutMs: z.number().int().min(100).max(60_000).optional(),
      ...approvalFields,
    })
    .strict(),
]);

export const FsWriteInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      path: pathValue,
      content: z.string().max(16 * 1024 * 1024),
      overwrite: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('update'),
      path: pathValue,
      content: z.string().max(16 * 1024 * 1024),
      expectedSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .describe('Copy sha256 from fs_read(read) before replacing the file contents.'),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('patch'),
      path: pathValue,
      unifiedDiff: z
        .string()
        .min(1)
        .max(16 * 1024 * 1024),
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('mkdir'),
      path: pathValue,
      recursive: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('move'),
      source: pathValue,
      destination: pathValue,
      overwrite: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('copy'),
      source: pathValue,
      destination: pathValue,
      overwrite: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('delete'),
      path: pathValue,
      recursive: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
]);

const environment = z.record(z.string().min(1).max(256), z.string().max(16_384)).optional();

export const TerminalInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('run'),
      command: z.string().min(1).max(262_144),
      workingDirectory: workingDirectoryValue,
      shell: z.enum(SHELL_KINDS).optional(),
      timeoutMs: z
        .number()
        .int()
        .min(100)
        .max(60 * 60_000)
        .optional(),
      environment,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('start'),
      command: z.string().min(1).max(262_144),
      workingDirectory: workingDirectoryValue,
      shell: z.enum(SHELL_KINDS).optional(),
      columns: z.number().int().min(20).max(500).optional(),
      rows: z.number().int().min(5).max(300).optional(),
      environment,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('input'),
      processId: z.uuid(),
      data: z.string().max(1024 * 1024),
      appendNewline: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('read'),
      processId: z.uuid(),
      offset: z.number().int().nonnegative().optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1024 * 1024)
        .optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('resize'),
      processId: z.uuid(),
      columns: z.number().int().min(20).max(500),
      rows: z.number().int().min(5).max(300),
      ...approvalFields,
    })
    .strict(),
  z.object({ operation: z.literal('interrupt'), processId: z.uuid(), ...approvalFields }).strict(),
]);

export const ProcessInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), ...approvalFields }).strict(),
  z
    .object({
      operation: z.literal('kill'),
      processId: z.uuid(),
      force: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
]);

export const JobsInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      type: z.string().min(1).max(64).optional(),
      command: z.string().min(1).max(262_144),
      workingDirectory: workingDirectoryValue,
      shell: z.enum(SHELL_KINDS).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      environment,
      ...approvalFields,
    })
    .strict(),
  z.object({ operation: z.literal('status'), jobId: z.uuid(), ...approvalFields }).strict(),
  z
    .object({
      operation: z.literal('list'),
      status: z
        .enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'])
        .optional(),
      limit: z.number().int().min(1).max(500).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('logs'),
      jobId: z.uuid(),
      offset: z.number().int().nonnegative().optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1024 * 1024)
        .optional(),
      ...approvalFields,
    })
    .strict(),
  z.object({ operation: z.literal('cancel'), jobId: z.uuid(), ...approvalFields }).strict(),
]);

export const GitReadInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('status'), repository: pathValue, ...approvalFields }).strict(),
  z
    .object({
      operation: z.literal('diff'),
      repository: pathValue,
      staged: z.boolean().optional(),
      path: pathValue.optional(),
      context: z.number().int().min(0).max(100).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('log'),
      repository: pathValue,
      limit: z.number().int().min(1).max(200).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('show'),
      repository: pathValue,
      revision: z.string().min(1).max(256),
      ...approvalFields,
    })
    .strict(),
  z.object({ operation: z.literal('branches'), repository: pathValue, ...approvalFields }).strict(),
  z
    .object({ operation: z.literal('preflight'), repository: pathValue, ...approvalFields })
    .strict(),
]);

export const GitWriteInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('add'),
      repository: pathValue,
      paths: z.array(pathValue).min(1).max(1000),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('create_branch'),
      repository: pathValue,
      name: z.string().min(1).max(256),
      startPoint: z.string().min(1).max(256).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('checkout'),
      repository: pathValue,
      name: z.string().min(1).max(256),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('fetch'),
      repository: pathValue,
      remote: z.string().min(1).max(256).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('pull'),
      repository: pathValue,
      remote: z.string().min(1).max(256).optional(),
      branch: z.string().min(1).max(256).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('commit'),
      repository: pathValue,
      message: z.string().min(1).max(16_384),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('push'),
      repository: pathValue,
      remote: z.string().min(1).max(256).optional(),
      branch: z.string().min(1).max(256).optional(),
      ...approvalFields,
    })
    .strict(),
]);

export const LocatorSchema = z.discriminatedUnion('by', [
  z
    .object({
      by: z.literal('role'),
      role: z.string().min(1).max(64),
      name: z.string().max(1024).optional(),
      exact: z.boolean().optional(),
    })
    .strict()
    .describe('Role locator example: {by:"role", role:"button", name:"Save", exact:true}.'),
  z
    .object({
      by: z.literal('label'),
      value: z.string().min(1).max(1024),
      exact: z.boolean().optional(),
    })
    .strict()
    .describe('Label locator example: {by:"label", value:"Temperature", exact:true}.'),
  z
    .object({
      by: z.literal('text'),
      value: z.string().min(1).max(1024),
      exact: z.boolean().optional(),
    })
    .strict(),
  z.object({ by: z.literal('testId'), value: z.string().min(1).max(1024) }).strict(),
  z.object({ by: z.literal('css'), value: z.string().min(1).max(4096) }).strict(),
]);

export const BrowserReadInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('launch'), ...approvalFields }).strict(),
  z
    .object({
      operation: z.literal('observations'),
      sessionId: z.uuid(),
      pageId: z.uuid().optional(),
      afterSequence: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      types: z
        .array(z.enum(['console', 'request', 'response', 'request_failed']))
        .min(1)
        .max(4)
        .optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('console'),
      sessionId: z.uuid(),
      pageId: z.uuid().optional(),
      afterSequence: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('network'),
      sessionId: z.uuid(),
      pageId: z.uuid().optional(),
      afterSequence: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('snapshot'),
      sessionId: z.uuid(),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z.object({ operation: z.literal('tabs'), sessionId: z.uuid(), ...approvalFields }).strict(),
  z
    .object({
      operation: z.literal('screenshot'),
      sessionId: z.uuid(),
      ...pageFields,
      path: pathValue.optional(),
      fullPage: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('dialog_status'),
      sessionId: z.uuid(),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
]);

export const BrowserActInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('open'),
      sessionId: z.uuid(),
      url: z.url(),
      newTab: z.boolean().optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('click'),
      sessionId: z.uuid(),
      locator: LocatorSchema,
      purpose: z.enum(['interact', 'submit', 'purchase', 'account_delete', 'permission_change']),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('type'),
      sessionId: z.uuid(),
      locator: LocatorSchema,
      text: z.string().max(1024 * 1024),
      clear: z.boolean().optional(),
      delayMs: z.number().int().min(0).max(1000).optional(),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('press'),
      sessionId: z.uuid(),
      key: z.string().min(1).max(128),
      locator: LocatorSchema.optional().describe(
        'Optional semantic target. If omitted, the key is sent to the page keyboard/focused element.',
      ),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('select'),
      sessionId: z.uuid(),
      locator: LocatorSchema,
      values: z.array(z.string().max(4096)).min(1).max(100),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('hover'),
      sessionId: z.uuid(),
      locator: LocatorSchema,
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('wait'),
      sessionId: z.uuid(),
      text: z.string().max(4096).optional(),
      url: z.string().max(8192).optional(),
      timeoutMs: z.number().int().min(0).max(60_000).optional(),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('upload'),
      sessionId: z.uuid(),
      locator: LocatorSchema,
      files: z.array(pathValue).min(1).max(100),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('download'),
      sessionId: z.uuid(),
      locator: LocatorSchema,
      destinationDirectory: pathValue,
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('dialog'),
      sessionId: z.uuid(),
      action: z.enum(['accept', 'dismiss']),
      promptText: z.string().max(16_384).optional(),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('close'),
      sessionId: z.uuid(),
      ...pageFields,
      ...approvalFields,
    })
    .strict(),
]);

export const WindowsTargetSchema = z.union([
  z.object({ windowHandle: z.number().int().positive() }).strict(),
  z.object({ processId: z.number().int().positive() }).strict(),
  z.object({ windowTitle: z.string().min(1).max(1024) }).strict(),
]);

export const WindowsLocatorSchema = z.discriminatedUnion('by', [
  z
    .object({
      by: z.literal('automationId'),
      value: z.string().min(1).max(1024),
      index: z.number().int().nonnegative().max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      by: z.literal('name'),
      value: z.string().min(1).max(1024),
      index: z.number().int().nonnegative().max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      by: z.literal('controlType'),
      value: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/u),
      index: z.number().int().nonnegative().max(10_000).optional(),
    })
    .strict(),
]);

export const WindowsReadInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('status'), ...approvalFields }).strict(),
  z
    .object({
      operation: z.literal('windows'),
      limit: z.number().int().min(1).max(500).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('snapshot'),
      target: WindowsTargetSchema,
      depth: z.number().int().min(0).max(32).optional(),
      maxElements: z.number().int().min(1).max(2000).optional(),
      ...approvalFields,
    })
    .strict(),
  z
    .object({
      operation: z.literal('screenshot'),
      target: WindowsTargetSchema,
      path: pathValue.optional(),
      ...approvalFields,
    })
    .strict(),
]);

const windowsActionFields = {
  target: WindowsTargetSchema,
  locator: WindowsLocatorSchema,
  purpose: z.enum(['interact', 'submit', 'purchase', 'account_delete', 'permission_change']),
  ...approvalFields,
};

export const WindowsActInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('invoke'), ...windowsActionFields }).strict(),
  z
    .object({
      operation: z.literal('set_value'),
      value: z.string().max(4096),
      ...windowsActionFields,
    })
    .strict(),
  z.object({ operation: z.literal('toggle'), ...windowsActionFields }).strict(),
  z.object({ operation: z.literal('select'), ...windowsActionFields }).strict(),
  z.object({ operation: z.literal('expand'), ...windowsActionFields }).strict(),
  z.object({ operation: z.literal('collapse'), ...windowsActionFields }).strict(),
  z.object({ operation: z.literal('focus'), ...windowsActionFields }).strict(),
]);

export const ForegroundInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('status'), ...approvalFields }).strict(),
  z.object({ operation: z.literal('pending'), ...approvalFields }).strict(),
]);

export const SystemInfoInputSchema = z.object({ ...approvalFields }).strict();
export const PermissionsStatusInputSchema = z
  .object({
    maxItems: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('Maximum grants and approvals per array; roots and rules are never truncated.'),
    ...approvalFields,
  })
  .strict();
export const ProjectInspectInputSchema = z
  .object({ workingDirectory: workingDirectoryValue, ...approvalFields })
  .strict();
export const ProjectCheckInputSchema = z
  .object({
    workingDirectory: workingDirectoryValue,
    kind: z.enum(['test', 'lint', 'typecheck', 'build', 'check']),
    script: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe('Exact manifest script name, defaults to kind; e.g. test:unit.'),
    planSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .describe(
        'Copy from project_inspect.checks or project_scripts.checks; protects against a changed command.',
      ),
    timeoutMs: z.number().int().min(100).max(600_000).optional(),
    ...approvalFields,
  })
  .strict();
export const RenderStatusInputSchema = z.object({ ...approvalFields }).strict();
export const AuditReadInputSchema = z
  .object({
    afterSequence: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    ...approvalFields,
  })
  .strict();

export type FsReadInput = z.infer<typeof FsReadInputSchema>;
export type FsWriteInput = z.infer<typeof FsWriteInputSchema>;
export type TerminalInput = z.infer<typeof TerminalInputSchema>;
export type ProcessInput = z.infer<typeof ProcessInputSchema>;
export type JobsInput = z.infer<typeof JobsInputSchema>;
export type GitReadInput = z.infer<typeof GitReadInputSchema>;
export type GitWriteInput = z.infer<typeof GitWriteInputSchema>;
export type BrowserReadInput = z.infer<typeof BrowserReadInputSchema>;
export type BrowserActInput = z.infer<typeof BrowserActInputSchema>;
export type WindowsReadInput = z.infer<typeof WindowsReadInputSchema>;
export type WindowsActInput = z.infer<typeof WindowsActInputSchema>;
export type ForegroundInput = z.infer<typeof ForegroundInputSchema>;

import { z } from 'zod';

export const CAPABILITIES = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.delete',
  'terminal.readonly',
  'terminal.execute',
  'terminal.admin',
  'process.inspect',
  'process.start',
  'process.kill',
  'git.read',
  'git.commit',
  'git.push',
  'git.reset',
  'git.clean',
  'git.force_push',
  'browser.read',
  'browser.navigate',
  'browser.type',
  'browser.submit',
  'browser.download',
  'browser.upload',
  'browser.evaluate',
  'windows.read',
  'windows.interact',
  'windows.submit',
  'system.inspect',
  'system.modify',
  'network.inspect',
  'network.modify',
  'packages.install',
  'secrets.read',
  'agent.configure',
  'agent.revoke',
  'audit.read',
  'approvals.respond',
] as const;

export const CapabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof CapabilitySchema>;

export const EffectSchema = z.enum(['allow', 'ask', 'deny']);
export type Effect = z.infer<typeof EffectSchema>;

export const ModeSchema = z.enum(['ask', 'balanced', 'full']);
export type PermissionMode = z.infer<typeof ModeSchema>;

export const ScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), value: z.string().min(1) }),
  z.object({ kind: z.literal('origin'), value: z.string().min(1) }),
  z.object({ kind: z.literal('repository'), value: z.string().min(1) }),
  z.object({ kind: z.literal('process'), value: z.string().min(1) }),
  z.object({ kind: z.literal('device'), value: z.string().min(1) }),
  z.object({ kind: z.literal('global'), value: z.literal('*') }),
]);
export type PermissionScope = z.infer<typeof ScopeSchema>;

export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  capability: z.union([CapabilitySchema, z.literal('*')]),
  effect: EffectSchema,
  scope: ScopeSchema.optional(),
  description: z.string().max(500).optional(),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export type AuthorizationRequest = {
  actorId: string;
  sessionId: string;
  capability: Capability;
  operation: string;
  scope: PermissionScope;
  arguments: unknown;
  risk?: string;
  flags?: string[];
};

export type PolicyDecision = {
  effect: Effect;
  ruleId: string;
  reason: string;
  actionDigest: string;
};

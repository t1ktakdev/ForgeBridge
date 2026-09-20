import path from 'node:path';
import { sha256, stableStringify } from '../core/json.js';
import type { Redactor } from '../core/redactor.js';
import type { ForgeBridgeConfig, ProjectProfile } from '../core/config.js';
import type { ApprovalRecord, ApprovalStore } from './approvals.js';
import type {
  AuthorizationRequest,
  Capability,
  Effect,
  PermissionMode,
  PermissionScope,
  PolicyDecision,
  PolicyRule,
} from './types.js';
import { CAPABILITIES } from './types.js';

export type PermissionGrant = {
  id: string;
  kind: 'session' | 'temporary';
  actorId: string;
  sessionId?: string;
  capability: Capability;
  scope: PermissionScope;
  issuer: string;
  createdAt: string;
  expiresAt?: string;
  reason: string;
  maxUses: number;
  uses: number;
};

type RuntimeGrant = PermissionGrant & {
  expiresAtMonotonic?: number;
};

export type AuthorizationResult =
  | { outcome: 'allow'; decision: PolicyDecision }
  | { outcome: 'deny'; decision: PolicyDecision }
  | { outcome: 'approval_required'; decision: PolicyDecision; approval: ApprovalRecord };

const ALWAYS_READ: ReadonlySet<Capability> = new Set([
  'filesystem.read',
  'terminal.readonly',
  'process.inspect',
  'git.read',
  'browser.read',
  'windows.read',
  'system.inspect',
  'audit.read',
]);

const HARD_DENIED: ReadonlySet<Capability> = new Set([
  'terminal.admin',
  'git.reset',
  'git.clean',
  'git.force_push',
  'browser.evaluate',
  'system.modify',
  'network.modify',
  'secrets.read',
  'agent.configure',
  'agent.revoke',
  'approvals.respond',
]);

const ALWAYS_FRESH_APPROVAL: ReadonlySet<Capability> = new Set([
  'browser.submit',
  'windows.submit',
]);
const EXPLICIT_ALLOW_CANNOT_BYPASS: ReadonlySet<Capability> = new Set([
  'browser.submit',
  'git.push',
  'windows.submit',
]);
const NON_BYPASSABLE_ASK_FLAGS = new Set(['destructive', 'repository-code']);
const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITIES);

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function pathContains(root: string, candidate: string): boolean {
  const relative = path.relative(comparablePath(root), comparablePath(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function originMatches(pattern: string, value: string): boolean {
  try {
    const actual = new URL(value);
    const wildcardPort = pattern.endsWith(':*');
    const normalizedPattern = wildcardPort ? pattern.slice(0, -2) : pattern;
    const expected = new URL(normalizedPattern);
    return (
      actual.protocol === expected.protocol &&
      actual.hostname.toLocaleLowerCase('en-US') === expected.hostname.toLocaleLowerCase('en-US') &&
      (wildcardPort || actual.port === expected.port)
    );
  } catch {
    return false;
  }
}

function scopeMatches(
  ruleScope: PermissionScope | undefined,
  requestScope: PermissionScope,
): boolean {
  if (!ruleScope || ruleScope.kind === 'global') return true;
  if (ruleScope.kind !== requestScope.kind) return false;
  if (ruleScope.kind === 'path' && requestScope.kind === 'path') {
    return pathContains(ruleScope.value, requestScope.value);
  }
  if (ruleScope.kind === 'origin' && requestScope.kind === 'origin') {
    return originMatches(ruleScope.value, requestScope.value);
  }
  return ruleScope.value === requestScope.value;
}

function ruleMatches(rule: PolicyRule, request: AuthorizationRequest): boolean {
  return (
    (rule.capability === '*' || rule.capability === request.capability) &&
    scopeMatches(rule.scope, request.scope)
  );
}

function modeDefault(mode: PermissionMode, capability: Capability): Effect {
  if (ALWAYS_READ.has(capability)) return 'allow';

  if (mode === 'ask') return HARD_DENIED.has(capability) ? 'deny' : 'ask';
  if (mode === 'balanced') {
    if (
      capability === 'filesystem.write' ||
      capability === 'terminal.execute' ||
      capability === 'process.start' ||
      capability === 'process.kill' ||
      capability === 'browser.navigate' ||
      capability === 'browser.type'
    ) {
      return 'allow';
    }
    return HARD_DENIED.has(capability) ? 'deny' : 'ask';
  }

  if (HARD_DENIED.has(capability)) return 'deny';
  if (EXPLICIT_ALLOW_CANNOT_BYPASS.has(capability)) return 'ask';
  return 'allow';
}

export function actionDigest(request: AuthorizationRequest): string {
  return sha256(
    stableStringify({
      actorId: request.actorId,
      sessionId: request.sessionId,
      capability: request.capability,
      operation: request.operation,
      scope: request.scope,
      arguments: request.arguments,
      flags: [...(request.flags ?? [])].sort(),
    }),
  );
}

export class PermissionEngine {
  readonly #config: ForgeBridgeConfig;
  readonly #approvals: ApprovalStore;
  readonly #redactor: Redactor;
  #grants: RuntimeGrant[] = [];

  constructor(config: ForgeBridgeConfig, approvals: ApprovalStore, redactor: Redactor) {
    this.#config = config;
    this.#approvals = approvals;
    this.#redactor = redactor;
    this.#grants = approvals.listRestorableTemporaryGrants().flatMap((grant) => {
      const capability = grant.capability;
      if (!CAPABILITY_SET.has(capability)) return [];
      return [
        {
          id: grant.id,
          kind: 'temporary' as const,
          actorId: grant.actorId,
          capability,
          scope: grant.scope,
          issuer: 'local-control-user',
          createdAt: grant.createdAt,
          expiresAt: grant.expiresAt,
          reason: grant.reason,
          maxUses: grant.maxUses,
          uses: grant.uses,
        },
      ];
    });
  }

  get mode(): PermissionMode {
    return this.#config.mode;
  }

  effectiveMode(scope: PermissionScope): PermissionMode {
    return this.findProjectProfile(scope)?.mode ?? this.#config.mode;
  }

  effectivePolicy(scope: PermissionScope) {
    const profile = this.findProjectProfile(scope);
    return {
      globalMode: this.#config.mode,
      effectiveMode: profile?.mode ?? this.#config.mode,
      autonomy: profile?.autonomy ?? 'standard',
      profileRoot: profile?.root ?? null,
    };
  }

  async authorize(
    request: AuthorizationRequest,
    approvalIds?: string | readonly string[],
    consume = true,
  ): Promise<AuthorizationResult> {
    const digest = actionDigest(request);
    const hardDenyReason = this.hardDenyReason(request);
    if (hardDenyReason) return this.result('deny', 'hard-deny', hardDenyReason, digest);

    if (!this.scopeAllows(request)) {
      return this.result(
        'deny',
        'scope-deny',
        `Capability ${request.capability} is outside its configured scope`,
        digest,
      );
    }

    const rules = this.rulesFor(request);
    const explicitDeny = rules.find((rule) => rule.effect === 'deny' && ruleMatches(rule, request));
    if (explicitDeny) {
      return this.result(
        'deny',
        explicitDeny.id,
        explicitDeny.description ?? 'Explicit deny rule',
        digest,
      );
    }

    const candidateApprovalIds = approvalIds
      ? typeof approvalIds === 'string'
        ? [approvalIds]
        : approvalIds
      : [];
    for (const approvalId of candidateApprovalIds) {
      if (
        this.#approvals.statusFor(approvalId, digest, request.actorId, request.sessionId) ===
        'denied'
      ) {
        return this.result(
          'deny',
          'approval:user-denied',
          'The local user denied this exact action',
          digest,
        );
      }
      const consumed = await this.#approvals.consume(
        approvalId,
        digest,
        request.actorId,
        request.sessionId,
        consume,
      );
      if (consumed) {
        if (!consume)
          return this.result('allow', `approval:${approvalId}`, 'Exact approved action', digest);
        if (
          (consumed.kind === 'session' || consumed.kind === 'temporary') &&
          !ALWAYS_FRESH_APPROVAL.has(request.capability) &&
          !(request.capability === 'git.push' && consumed.kind !== 'temporary') &&
          !(request.flags ?? []).some((flag) => NON_BYPASSABLE_ASK_FLAGS.has(flag))
        ) {
          const now = Date.now();
          const expiresAt = consumed.grantExpiresAt;
          this.#grants.push({
            id: consumed.record.id,
            kind: consumed.kind,
            actorId: request.actorId,
            ...(consumed.kind === 'session' ? { sessionId: request.sessionId } : {}),
            capability: request.capability,
            scope: request.scope,
            issuer: 'local-control-user',
            createdAt: consumed.record.grantIssuedAt ?? new Date(now).toISOString(),
            ...(expiresAt
              ? {
                  expiresAt,
                  expiresAtMonotonic:
                    performance.now() + Math.max(0, new Date(expiresAt).getTime() - now),
                }
              : {}),
            reason: consumed.record.risk,
            maxUses: consumed.grantMaxUses ?? 1000,
            uses: consumed.grantUses,
          });
        }
        return this.result('allow', `approval:${approvalId}`, 'Exact approved action', digest);
      }
    }

    const grant = this.findGrant(request);
    const requestFlags = new Set(request.flags ?? []);
    const trustedRepositoryCode =
      requestFlags.has('repository-code') &&
      this.findProjectProfile(request.scope)?.autonomy === 'trusted-local';
    const hasNonBypassableFlag =
      requestFlags.has('destructive') ||
      (requestFlags.has('repository-code') && !trustedRepositoryCode) ||
      [...requestFlags].some(
        (flag) =>
          NON_BYPASSABLE_ASK_FLAGS.has(flag) &&
          flag !== 'repository-code' &&
          flag !== 'destructive',
      );
    if (hasNonBypassableFlag) {
      return this.requireApproval(
        request,
        digest,
        'risk:destructive',
        request.risk ?? 'Potentially destructive execution requires exact approval',
      );
    }

    const grantCanBypass =
      grant &&
      !ALWAYS_FRESH_APPROVAL.has(request.capability) &&
      (request.capability !== 'git.push' || grant.kind === 'temporary');
    if (grantCanBypass) {
      if (!consume) return this.result('allow', `grant:${grant.id}`, 'Active scoped grant', digest);
      if (await this.#approvals.useGrant(grant.id)) {
        grant.uses += 1;
        if (grant.uses >= grant.maxUses) {
          this.#grants = this.#grants.filter((item) => item !== grant);
        }
        return this.result('allow', `grant:${grant.id}`, 'Active scoped grant', digest);
      }
      this.#grants = this.#grants.filter((item) => item !== grant);
    }

    const explicitAsk = rules.find((rule) => rule.effect === 'ask' && ruleMatches(rule, request));
    if (explicitAsk) {
      return this.requireApproval(request, digest, explicitAsk.id, explicitAsk.description);
    }

    const explicitAllow = rules.find(
      (rule) => rule.effect === 'allow' && ruleMatches(rule, request),
    );
    if (explicitAllow && !EXPLICIT_ALLOW_CANNOT_BYPASS.has(request.capability)) {
      return this.result(
        'allow',
        explicitAllow.id,
        explicitAllow.description ?? 'Explicit allow rule',
        digest,
      );
    }

    const mode = this.effectiveMode(request.scope);
    const profile = this.findProjectProfile(request.scope);
    const modeRuleId = profile ? `project:${profile.root}:mode:${mode}` : `mode:${mode}`;
    const effect = modeDefault(mode, request.capability);
    if (effect === 'ask') return this.requireApproval(request, digest, modeRuleId);
    return this.result(effect, modeRuleId, `Default for ${mode} mode`, digest);
  }

  clearSession(sessionId: string): void {
    this.#grants = this.#grants.filter((grant) => grant.sessionId !== sessionId);
  }

  clearAllGrants(): void {
    this.#grants = [];
  }

  clearSessionGrants(): void {
    this.#grants = this.#grants.filter((grant) => grant.kind !== 'session');
  }

  async revokeGrant(id: string): Promise<boolean> {
    const before = this.#grants.length;
    this.#grants = this.#grants.filter((grant) => grant.id !== id);
    const removedPersisted = await this.#approvals.revokeGrant(id);
    return this.#grants.length !== before || removedPersisted;
  }

  listGrants(): readonly PermissionGrant[] {
    this.pruneGrants();
    return this.#grants.map((grant) => ({
      id: grant.id,
      kind: grant.kind,
      actorId: grant.actorId,
      ...(grant.sessionId ? { sessionId: grant.sessionId } : {}),
      capability: grant.capability,
      scope: grant.scope,
      issuer: grant.issuer,
      createdAt: grant.createdAt,
      ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
      reason: grant.reason,
      maxUses: grant.maxUses,
      uses: grant.uses,
    }));
  }

  private result(
    effect: 'allow' | 'deny',
    ruleId: string,
    reason: string,
    digest: string,
  ): AuthorizationResult {
    return {
      outcome: effect,
      decision: { effect, ruleId, reason, actionDigest: digest },
    };
  }

  private async requireApproval(
    request: AuthorizationRequest,
    digest: string,
    ruleId: string,
    reason?: string,
  ): Promise<AuthorizationResult> {
    const redacted = this.#redactor.redact(request.arguments);
    const approval = await this.#approvals.create(
      request,
      digest,
      redacted.value,
      request.risk ?? reason ?? `Approval required for ${request.capability}`,
    );
    return {
      outcome: 'approval_required',
      decision: {
        effect: 'ask',
        ruleId,
        reason: reason ?? 'User approval is required',
        actionDigest: digest,
      },
      approval,
    };
  }

  private hardDenyReason(request: AuthorizationRequest): string | undefined {
    if (HARD_DENIED.has(request.capability)) return `${request.capability} is hard-denied in v0.1`;
    const flags = new Set(request.flags ?? []);
    if (flags.has('filesystem-delete'))
      return 'Use fs_write delete with an exact path; terminal cannot substitute for filesystem deletion approval';
    if (flags.has('credential-dump')) return 'Credential dumping is prohibited';
    if (flags.has('persistence')) return 'Hidden persistence is prohibited';
    if (flags.has('elevation')) return 'Privilege elevation is prohibited';
    return undefined;
  }

  private scopeAllows(request: AuthorizationRequest): boolean {
    if (request.scope.kind !== 'path' && request.scope.kind !== 'repository') return true;
    return this.#config.roots.some(
      (root) =>
        pathContains(root.path, request.scope.value) &&
        root.capabilities.includes(request.capability),
    );
  }

  private findProjectProfile(scope: PermissionScope): ProjectProfile | undefined {
    if (scope.kind !== 'path' && scope.kind !== 'repository') return undefined;
    return this.#config.projectProfiles
      .filter((profile) => pathContains(profile.root, scope.value))
      .sort(
        (left, right) => comparablePath(right.root).length - comparablePath(left.root).length,
      )[0];
  }

  private rulesFor(request: AuthorizationRequest): readonly PolicyRule[] {
    const project = this.findProjectProfile(request.scope);
    return project ? [...this.#config.rules, ...project.rules] : this.#config.rules;
  }

  private findGrant(request: AuthorizationRequest): RuntimeGrant | undefined {
    this.pruneGrants();
    return this.#grants.find(
      (grant) =>
        grant.actorId === request.actorId &&
        (!grant.sessionId || grant.sessionId === request.sessionId) &&
        grant.capability === request.capability &&
        grant.uses < grant.maxUses &&
        scopeMatches(grant.scope, request.scope),
    );
  }

  private pruneGrants(): void {
    const now = Date.now();
    const monotonicNow = performance.now();
    this.#grants = this.#grants.filter(
      (grant) =>
        (!grant.expiresAt || new Date(grant.expiresAt).getTime() > now) &&
        (!grant.expiresAtMonotonic || grant.expiresAtMonotonic > monotonicNow),
    );
  }
}

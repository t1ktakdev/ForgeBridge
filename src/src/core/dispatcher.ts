import { randomUUID } from 'node:crypto';
import type { AuditLedger } from './audit.js';
import { asForgeBridgeError, ForgeBridgeError } from './errors.js';
import type { Redactor } from './redactor.js';
import type { PermissionEngine } from '../policy/engine.js';
import type { AuthorizationRequest, Capability, PermissionScope } from '../policy/types.js';

export type AuthorizationRequirement = {
  capability: Capability;
  scope: PermissionScope;
  risk?: string;
  flags?: string[];
};

export type DispatchRequest = {
  actorId: string;
  sessionId: string;
  tool: string;
  operation: string;
  arguments: unknown;
  approvalIds?: readonly string[];
  allowWhilePaused?: boolean;
};

export class AuthorizedDispatcher {
  readonly #permissions: PermissionEngine;
  readonly #audit: AuditLedger;
  readonly #redactor: Redactor;
  readonly #isPaused: () => boolean;

  constructor(options: {
    permissions: PermissionEngine;
    audit: AuditLedger;
    redactor: Redactor;
    isPaused: () => boolean;
  }) {
    this.#permissions = options.permissions;
    this.#audit = options.audit;
    this.#redactor = options.redactor;
    this.#isPaused = options.isPaused;
  }

  async run<T>(
    request: DispatchRequest,
    requirements: readonly AuthorizationRequirement[],
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const correlationId = randomUUID();
    const started = Date.now();
    const first = requirements[0];
    if (!first)
      throw new ForgeBridgeError('internal_error', 'Action has no permission requirement');

    if (this.#isPaused() && !request.allowWhilePaused) {
      await this.#audit.append({
        correlationId,
        actorId: request.actorId,
        sessionId: request.sessionId,
        tool: request.tool,
        operation: request.operation,
        capability: first.capability,
        scope: first.scope,
        arguments: request.arguments,
        decision: 'deny',
        ruleId: 'agent:paused',
        result: 'denied',
      });
      throw new ForgeBridgeError('agent_paused', 'ForgeBridge is paused by the local user');
    }

    // Check all requirements before consuming any one-shot approval. ASK-mode operations
    // can require several approvals; consuming the first while awaiting the second caused loops.
    if (requirements.length > 1) {
      const pending = [];
      for (const requirement of requirements) {
        const authorization: AuthorizationRequest = { ...request, ...requirement };
        const result = await this.#permissions.authorize(authorization, request.approvalIds, false);
        if (result.outcome === 'allow') continue;
        await this.#audit.append({
          correlationId,
          actorId: request.actorId,
          sessionId: request.sessionId,
          tool: request.tool,
          operation: request.operation,
          capability: requirement.capability,
          scope: requirement.scope,
          arguments: request.arguments,
          decision: result.decision.effect,
          ruleId: result.decision.ruleId,
          result: result.outcome === 'deny' ? 'denied' : 'approval_required',
          durationMs: Date.now() - started,
        });
        if (result.outcome === 'deny') {
          throw new ForgeBridgeError(
            result.decision.ruleId === 'approval:user-denied' ? 'user_denied' : 'permission_denied',
            result.decision.reason,
            {
              blocked_by: 'forgebridge',
              capability: requirement.capability,
              operation: request.operation,
              scope: requirement.scope,
              ruleId: result.decision.ruleId,
              risk_reason: result.decision.reason,
              allowed_responses: [],
              next_action: 'report_denial_do_not_bypass',
            },
          );
        }
        pending.push(result.approval);
      }
      const approval = pending[0];
      if (approval)
        throw new ForgeBridgeError(
          'approval_required',
          'Local approval is required',
          {
            blocked_by: 'forgebridge',
            capability: approval.capability,
            operation: request.operation,
            scope: approval.scope,
            approval_id: approval.id,
            approval_ids: pending.map((item) => item.id),
            risk_reason: approval.risk,
            allowed_responses: approval.allowedResponses,
            expires_at: approval.expiresAt,
            next_action: 'await_local_approval_then_retry_identical_call',
            approval,
            approvals: pending,
          },
          true,
        );
    }
    const allowed: { authorization: AuthorizationRequest; ruleId: string }[] = [];
    for (const requirement of requirements) {
      const authorization: AuthorizationRequest = {
        actorId: request.actorId,
        sessionId: request.sessionId,
        capability: requirement.capability,
        operation: request.operation,
        scope: requirement.scope,
        arguments: request.arguments,
        ...(requirement.risk ? { risk: requirement.risk } : {}),
        ...(requirement.flags ? { flags: requirement.flags } : {}),
      };
      const result = await this.#permissions.authorize(authorization, request.approvalIds);
      if (result.outcome !== 'allow') {
        await this.#audit.append({
          correlationId,
          actorId: request.actorId,
          sessionId: request.sessionId,
          tool: request.tool,
          operation: request.operation,
          capability: requirement.capability,
          scope: requirement.scope,
          arguments: request.arguments,
          decision: result.decision.effect,
          ruleId: result.decision.ruleId,
          result: result.outcome === 'deny' ? 'denied' : 'approval_required',
          durationMs: Date.now() - started,
        });
        if (result.outcome === 'approval_required') {
          throw new ForgeBridgeError(
            'approval_required',
            result.decision.reason,
            {
              approval: result.approval,
              actionDigest: result.decision.actionDigest,
              blocked_by: 'forgebridge',
              capability: requirement.capability,
              operation: request.operation,
              scope: requirement.scope,
              approval_id: result.approval.id,
              approval_ids: [result.approval.id],
              risk_reason: result.approval.risk,
              allowed_responses: result.approval.allowedResponses,
              expires_at: result.approval.expiresAt,
              next_action: 'await_local_approval_then_retry_identical_call',
            },
            true,
          );
        }
        throw new ForgeBridgeError(
          result.decision.ruleId === 'approval:user-denied' ? 'user_denied' : 'permission_denied',
          result.decision.reason,
          {
            ruleId: result.decision.ruleId,
            actionDigest: result.decision.actionDigest,
            blocked_by: 'forgebridge',
            capability: requirement.capability,
            operation: request.operation,
            scope: requirement.scope,
            risk_reason: result.decision.reason,
            allowed_responses: [],
            next_action: 'report_denial_do_not_bypass',
          },
        );
      }
      allowed.push({ authorization, ruleId: result.decision.ruleId });
      await this.#audit.append({
        correlationId,
        actorId: request.actorId,
        sessionId: request.sessionId,
        tool: request.tool,
        operation: request.operation,
        capability: requirement.capability,
        scope: requirement.scope,
        arguments: request.arguments,
        decision: 'allow',
        ruleId: result.decision.ruleId,
        result: 'allowed',
      });
    }

    try {
      const value = await operation();
      await this.#audit.append({
        correlationId,
        actorId: request.actorId,
        sessionId: request.sessionId,
        tool: request.tool,
        operation: request.operation,
        capability: first.capability,
        scope: first.scope,
        arguments: request.arguments,
        decision: 'allow',
        ruleId: allowed[0]?.ruleId ?? 'unknown',
        result: 'succeeded',
        durationMs: Date.now() - started,
      });
      return this.#redactor.redact(value).value;
    } catch (error) {
      const normalized = asForgeBridgeError(error);
      await this.#audit.append({
        correlationId,
        actorId: request.actorId,
        sessionId: request.sessionId,
        tool: request.tool,
        operation: request.operation,
        capability: first.capability,
        scope: first.scope,
        arguments: request.arguments,
        decision: 'allow',
        ruleId: allowed[0]?.ruleId ?? 'unknown',
        result: normalized.code === 'cancelled' ? 'cancelled' : 'failed',
        durationMs: Date.now() - started,
        errorCode: normalized.code,
      });
      throw normalized;
    }
  }
}

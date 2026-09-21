import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ForgeBridgeError } from '../core/errors.js';
import { z } from 'zod';
import { writeFileAtomic } from '../core/atomic.js';
import { CapabilitySchema, ScopeSchema, type AuthorizationRequest } from './types.js';

const ApprovalKindSchema = z.enum(['once', 'session', 'temporary']);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;
const ApprovalResponseSchema = z.enum(['deny', 'once', 'session', 'temporary']);
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;

const ApprovalRecordSchema = z.object({
  id: z.uuid(),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  actorId: z.string(),
  sessionId: z.string(),
  capability: CapabilitySchema,
  operation: z.string(),
  scope: ScopeSchema,
  redactedArguments: z.unknown(),
  risk: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: z.enum(['pending', 'approved', 'denied', 'consumed', 'revoked']),
  allowedResponses: z
    .array(ApprovalResponseSchema)
    .default(['deny', 'once', 'session', 'temporary']),
  approvalKind: ApprovalKindSchema.optional(),
  grantIssuedAt: z.iso.datetime().optional(),
  grantExpiresAt: z.iso.datetime().optional(),
  grantMaxUses: z.number().int().min(1).max(10_000).optional(),
  grantUses: z.number().int().nonnegative().default(0),
});

export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export type ConsumedApproval = {
  record: ApprovalRecord;
  kind: ApprovalKind;
  grantExpiresAt?: string;
  grantMaxUses?: number;
  grantUses: number;
};

export type RestorableTemporaryGrant = {
  id: string;
  actorId: string;
  capability: ApprovalRecord['capability'];
  scope: ApprovalRecord['scope'];
  createdAt: string;
  expiresAt: string;
  reason: string;
  maxUses: number;
  uses: number;
};

export class ApprovalStore {
  readonly file: string;
  readonly #ttlMs: number;
  #records = new Map<string, ApprovalRecord>();
  #persistQueue: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string, ttlMs: number) {
    this.file = path.join(stateDirectory, 'state', 'approvals.json');
    this.#ttlMs = ttlMs;
  }

  async initialize(): Promise<void> {
    try {
      const data = z
        .array(ApprovalRecordSchema)
        .parse(JSON.parse(await readFile(this.file, 'utf8')));
      this.#records = new Map(data.map((record) => [record.id, record]));
      await this.expire();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async create(
    request: AuthorizationRequest,
    actionDigest: string,
    redactedArguments: unknown,
    risk: string,
  ): Promise<ApprovalRecord> {
    const existing = [...this.#records.values()].find(
      (record) =>
        record.status === 'pending' &&
        record.actionDigest === actionDigest &&
        new Date(record.expiresAt).getTime() > Date.now(),
    );
    if (existing) return existing;

    const now = Date.now();
    const freshApprovalOnly =
      request.capability === 'browser.submit' ||
      request.capability === 'windows.submit' ||
      Boolean(request.flags?.some((flag) => flag === 'destructive' || flag === 'repository-code'));
    const allowedResponses: ApprovalResponse[] = freshApprovalOnly
      ? ['deny', 'once']
      : request.capability === 'git.push'
        ? ['deny', 'once', 'temporary']
        : ['deny', 'once', 'session', 'temporary'];
    const record: ApprovalRecord = {
      id: randomUUID(),
      actionDigest,
      actorId: request.actorId,
      sessionId: request.sessionId,
      capability: request.capability,
      operation: request.operation,
      scope: request.scope,
      redactedArguments,
      risk,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.#ttlMs).toISOString(),
      status: 'pending',
      allowedResponses,
      grantUses: 0,
    };
    this.#records.set(record.id, record);
    await this.persist();
    return record;
  }

  async respond(
    id: string,
    response: 'deny' | ApprovalKind,
    durationMs?: number,
    maxUses?: number,
  ): Promise<ApprovalRecord> {
    const record = this.#records.get(id);
    if (record?.status !== 'pending') throw new Error('Approval is not pending');
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      record.status = 'denied';
      await this.persist();
      throw new Error('Approval has expired');
    }

    if (!record.allowedResponses.includes(response)) {
      throw new Error(`Approval response ${response} is not allowed for this action`);
    }

    if (response === 'deny') {
      record.status = 'denied';
    } else {
      record.status = 'approved';
      record.approvalKind = response;
      if (response === 'session' || response === 'temporary') {
        record.grantIssuedAt = new Date().toISOString();
        record.grantMaxUses = Math.max(1, Math.min(maxUses ?? 1000, 10_000));
        record.grantUses = 0;
      }
      if (response === 'temporary') {
        const boundedDuration = Math.max(10_000, Math.min(durationMs ?? 15 * 60_000, 60 * 60_000));
        record.grantExpiresAt = new Date(Date.now() + boundedDuration).toISOString();
      }
    }
    await this.persist();
    return record;
  }

  async respondForSession(
    id: string,
    response: 'deny' | ApprovalKind,
    actorId: string,
    sessionId: string,
    durationMs?: number,
    maxUses?: number,
  ): Promise<ApprovalRecord> {
    const record = this.#records.get(id);
    if (record?.actorId !== actorId || record.sessionId !== sessionId) {
      throw new ForgeBridgeError(
        'approval_session_mismatch',
        'Approval does not belong to this MCP actor/session',
        { approvalId: id },
      );
    }
    return this.respond(id, response, durationMs, maxUses);
  }

  statusFor(
    id: string,
    digest: string,
    actorId: string,
    sessionId: string,
  ): ApprovalRecord['status'] | undefined {
    const record = this.#records.get(id);
    return record?.actionDigest === digest &&
      record.actorId === actorId &&
      record.sessionId === sessionId &&
      new Date(record.expiresAt).getTime() > Date.now()
      ? record.status
      : undefined;
  }

  async consume(
    id: string,
    actionDigest: string,
    actorId: string,
    sessionId: string,
    consume = true,
  ): Promise<ConsumedApproval | undefined> {
    const record = this.#records.get(id);
    if (
      record?.status !== 'approved' ||
      record.actionDigest !== actionDigest ||
      record.actorId !== actorId ||
      record.sessionId !== sessionId ||
      new Date(record.expiresAt).getTime() <= Date.now() ||
      !record.approvalKind
    ) {
      return undefined;
    }
    if (consume) {
      record.status = 'consumed';
      await this.persist();
    }
    return {
      record,
      kind: record.approvalKind,
      ...(record.grantExpiresAt ? { grantExpiresAt: record.grantExpiresAt } : {}),
      ...(record.grantMaxUses ? { grantMaxUses: record.grantMaxUses } : {}),
      grantUses: record.grantUses,
    };
  }

  listPending(): ApprovalRecord[] {
    const now = Date.now();
    return [...this.#records.values()].filter(
      (record) => record.status === 'pending' && new Date(record.expiresAt).getTime() > now,
    );
  }

  listRestorableTemporaryGrants(): RestorableTemporaryGrant[] {
    const now = Date.now();
    return [...this.#records.values()].flatMap((record) => {
      if (
        record.status !== 'consumed' ||
        record.approvalKind !== 'temporary' ||
        !record.grantExpiresAt ||
        new Date(record.grantExpiresAt).getTime() <= now ||
        !record.grantMaxUses ||
        record.grantUses >= record.grantMaxUses
      ) {
        return [];
      }
      return [
        {
          id: record.id,
          actorId: record.actorId,
          capability: record.capability,
          scope: record.scope,
          createdAt: record.grantIssuedAt ?? record.createdAt,
          expiresAt: record.grantExpiresAt,
          reason: record.risk,
          maxUses: record.grantMaxUses,
          uses: record.grantUses,
        },
      ];
    });
  }

  async revokeAll(): Promise<void> {
    for (const record of this.#records.values()) {
      if (record.status !== 'denied' && record.status !== 'revoked') record.status = 'revoked';
    }
    await this.persist();
  }

  async revokeGrant(id: string): Promise<boolean> {
    const record = this.#records.get(id);
    if (
      record?.status !== 'consumed' ||
      (record.approvalKind !== 'session' && record.approvalKind !== 'temporary')
    ) {
      return false;
    }
    record.status = 'revoked';
    await this.persist();
    return true;
  }

  async useGrant(id: string): Promise<boolean> {
    const record = this.#records.get(id);
    if (
      record?.status !== 'consumed' ||
      (record.approvalKind !== 'session' && record.approvalKind !== 'temporary') ||
      !record.grantMaxUses ||
      record.grantUses >= record.grantMaxUses ||
      (record.grantExpiresAt && new Date(record.grantExpiresAt).getTime() <= Date.now())
    ) {
      return false;
    }
    record.grantUses += 1;
    if (record.grantUses >= record.grantMaxUses) record.status = 'revoked';
    await this.persist();
    return true;
  }

  private async expire(): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const record of this.#records.values()) {
      if (
        (record.status === 'pending' || record.status === 'approved') &&
        new Date(record.expiresAt).getTime() <= now
      ) {
        record.status = 'denied';
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  private async persist(): Promise<void> {
    const contents = `${JSON.stringify([...this.#records.values()], null, 2)}\n`;
    const queued = this.#persistQueue.then(
      async () => writeFileAtomic(this.file, contents),
      async () => writeFileAtomic(this.file, contents),
    );
    this.#persistQueue = queued.catch(() => undefined);
    await queued;
  }
}

import { createReadStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { ForgeBridgeError } from './errors.js';
import { sha256, stableStringify } from './json.js';
import type { Redactor } from './redactor.js';
import {
  CapabilitySchema,
  EffectSchema,
  ScopeSchema,
  type Capability,
  type Effect,
  type PermissionScope,
} from '../policy/types.js';

export type AuditInput = {
  correlationId: string;
  actorId: string;
  sessionId: string;
  tool: string;
  operation: string;
  capability: Capability;
  scope: PermissionScope;
  arguments?: unknown;
  decision: Effect;
  ruleId: string;
  result: 'allowed' | 'denied' | 'approval_required' | 'succeeded' | 'failed' | 'cancelled';
  durationMs?: number;
  errorCode?: string;
};

export type AuditEntry = AuditInput & {
  version: 1;
  sequence: number;
  timestamp: string;
  previousHash: string;
  hash: string;
  redactionRules: string[];
  redactionCount: number;
};

type UnsignedAuditEntry = Omit<AuditEntry, 'hash'>;

const AuditEntrySchema = z
  .object({
    version: z.literal(1),
    sequence: z.number().int().positive(),
    timestamp: z.iso.datetime(),
    previousHash: z.string().regex(/^[a-f0-9]{64}$/u),
    hash: z.string().regex(/^[a-f0-9]{64}$/u),
    correlationId: z.string().min(1).max(256),
    actorId: z.string().min(1).max(256),
    sessionId: z.string().min(1).max(256),
    tool: z.string().min(1).max(256),
    operation: z.string().min(1).max(256),
    capability: CapabilitySchema,
    scope: ScopeSchema,
    arguments: z.unknown().optional(),
    decision: EffectSchema,
    ruleId: z.string().min(1).max(2048),
    result: z.enum(['allowed', 'denied', 'approval_required', 'succeeded', 'failed', 'cancelled']),
    durationMs: z.number().int().nonnegative().optional(),
    errorCode: z.string().min(1).max(256).optional(),
    redactionRules: z.array(z.string().min(1).max(256)).max(100),
    redactionCount: z.number().int().nonnegative(),
  })
  .strict();

export class AuditLedger {
  readonly file: string;
  readonly #redactor: Redactor;
  #head = '0'.repeat(64);
  #sequence = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string, redactor: Redactor) {
    this.file = path.join(stateDirectory, 'logs', 'audit.jsonl');
    this.#redactor = redactor;
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      const entries = await this.readAll();
      const last = entries.at(-1);
      this.#sequence = last?.sequence ?? 0;
      this.#head = last?.hash ?? '0'.repeat(64);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  append(input: AuditInput): Promise<AuditEntry> {
    return this.enqueue(async () => {
      const redacted = this.#redactor.redact(input.arguments);
      const unsigned: UnsignedAuditEntry = {
        ...input,
        arguments: redacted.value,
        version: 1,
        sequence: this.#sequence + 1,
        timestamp: new Date().toISOString(),
        previousHash: this.#head,
        redactionRules: redacted.rules,
        redactionCount: redacted.count,
      };
      const entry: AuditEntry = { ...unsigned, hash: sha256(stableStringify(unsigned)) };
      const handle = await open(this.file, 'a', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(entry)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.#head = entry.hash;
      this.#sequence = entry.sequence;
      return entry;
    });
  }

  async list(afterSequence = 0, limit = 100): Promise<{ entries: AuditEntry[]; next?: number }> {
    const pageLimit = Math.max(1, Math.min(limit, 500));
    return this.enqueue(async () => {
      const entries: AuditEntry[] = [];
      await this.scanVerified((entry) => {
        if (entry.sequence <= afterSequence) return;
        if (entries.length <= pageLimit) entries.push(entry);
      });
      const hasMore = entries.length > pageLimit;
      const page = entries.slice(0, pageLimit);
      const last = page.at(-1);
      return {
        entries: page,
        ...(hasMore && last ? { next: last.sequence } : {}),
      };
    });
  }

  async readAll(): Promise<AuditEntry[]> {
    return this.enqueue(async () => {
      const entries: AuditEntry[] = [];
      await this.scanVerified((entry) => entries.push(entry));
      return entries;
    });
  }

  verify(entries: AuditEntry[]): void {
    let previousHash = '0'.repeat(64);
    let sequence = 0;
    for (const entry of entries) {
      const parsed = AuditEntrySchema.safeParse(entry);
      if (!parsed.success) {
        throw new ForgeBridgeError('audit_integrity_error', 'Audit record is malformed', {
          sequence: entry.sequence,
        });
      }
      const { hash, ...unsigned } = parsed.data;
      const expected = sha256(stableStringify(unsigned));
      if (
        hash !== expected ||
        parsed.data.previousHash !== previousHash ||
        parsed.data.sequence !== sequence + 1
      ) {
        throw new ForgeBridgeError('audit_integrity_error', 'Audit chain verification failed', {
          sequence: parsed.data.sequence,
        });
      }
      sequence = parsed.data.sequence;
      previousHash = parsed.data.hash;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#queue.then(operation);
    this.#queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async scanVerified(onEntry: (entry: AuditEntry) => void): Promise<void> {
    let input: ReturnType<typeof createReadStream>;
    try {
      input = createReadStream(this.file, { encoding: 'utf8' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const lines = createInterface({ input, crlfDelay: Infinity });
    let previousHash = '0'.repeat(64);
    let sequence = 0;
    let lineNumber = 0;
    try {
      for await (const line of lines) {
        lineNumber += 1;
        if (!line) continue;
        let entry: AuditEntry;
        try {
          entry = AuditEntrySchema.parse(JSON.parse(line));
        } catch {
          throw new ForgeBridgeError('audit_integrity_error', 'Audit record is malformed', {
            line: lineNumber,
          });
        }
        const { hash, ...unsigned } = entry;
        const expected = sha256(stableStringify(unsigned));
        if (
          hash !== expected ||
          entry.previousHash !== previousHash ||
          entry.sequence !== sequence + 1
        ) {
          throw new ForgeBridgeError('audit_integrity_error', 'Audit chain verification failed', {
            sequence: entry.sequence,
          });
        }
        previousHash = entry.hash;
        sequence = entry.sequence;
        onEntry(entry);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    } finally {
      lines.close();
      input.destroy();
    }
  }
}

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { writeFileAtomic } from '../core/atomic.js';
import { ForgeBridgeError } from '../core/errors.js';

const ForegroundActionStatusSchema = z.enum([
  'pending',
  'approved',
  'deferred',
  'completed',
  'cancelled',
  'failed',
]);

const ForegroundActionSchema = z.object({
  id: z.uuid(),
  kind: z.literal('windows_uia'),
  application: z.string().min(1).max(1024),
  requestedAction: z.string().min(1).max(128),
  reason: z.string().min(1).max(2048),
  estimatedInterruption: z.string().min(1).max(256),
  requiredPermission: z.literal('local_foreground_approval'),
  status: ForegroundActionStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()),
  error: z.string().max(4096).optional(),
});

export type ForegroundAction = z.infer<typeof ForegroundActionSchema>;
export type ForegroundActionStatus = z.infer<typeof ForegroundActionStatusSchema>;

export class ForegroundActionQueue {
  readonly #file: string;
  #actions = new Map<string, ForegroundAction>();

  constructor(stateDirectory: string) {
    this.#file = path.join(stateDirectory, 'state', 'foreground-actions.json');
  }

  async initialize(): Promise<void> {
    try {
      const values = z
        .array(ForegroundActionSchema)
        .parse(JSON.parse(await readFile(this.#file, 'utf8')));
      this.#actions = new Map(values.map((action) => [action.id, action]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async enqueue(
    action: Omit<
      ForegroundAction,
      'id' | 'status' | 'createdAt' | 'updatedAt' | 'requiredPermission'
    >,
  ): Promise<ForegroundAction> {
    const now = new Date().toISOString();
    const record = ForegroundActionSchema.parse({
      ...action,
      id: randomUUID(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      requiredPermission: 'local_foreground_approval',
    });
    this.#actions.set(record.id, record);
    await this.persist();
    return structuredClone(record);
  }

  list(statuses?: readonly ForegroundActionStatus[]): ForegroundAction[] {
    const filter = statuses ? new Set(statuses) : undefined;
    return [...this.#actions.values()]
      .filter((action) => !filter || filter.has(action.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((action) => structuredClone(action));
  }

  get(id: string): ForegroundAction {
    return structuredClone(this.require(id));
  }

  async respond(id: string, response: 'approve' | 'defer' | 'cancel'): Promise<ForegroundAction> {
    const action = this.require(id);
    if (!['pending', 'approved', 'deferred'].includes(action.status)) {
      throw new ForgeBridgeError(
        'foreground_action_closed',
        `Foreground action is already ${action.status}`,
        { id, status: action.status },
      );
    }
    action.status =
      response === 'approve' ? 'approved' : response === 'defer' ? 'deferred' : 'cancelled';
    action.updatedAt = new Date().toISOString();
    delete action.error;
    await this.persist();
    return structuredClone(action);
  }

  async complete(id: string): Promise<void> {
    await this.finish(id, 'completed');
  }

  async fail(id: string, error: string): Promise<void> {
    await this.finish(id, 'failed', error.slice(0, 4096));
  }

  async cancelAll(): Promise<void> {
    let changed = false;
    for (const action of this.#actions.values()) {
      if (!['pending', 'approved', 'deferred'].includes(action.status)) continue;
      action.status = 'cancelled';
      action.updatedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) await this.persist();
  }

  private require(id: string): ForegroundAction {
    const action = this.#actions.get(id);
    if (!action)
      throw new ForgeBridgeError('unknown_foreground_action', 'Unknown foreground action', { id });
    return action;
  }

  private async finish(id: string, status: 'completed' | 'failed', error?: string): Promise<void> {
    const action = this.require(id);
    action.status = status;
    action.updatedAt = new Date().toISOString();
    if (error) action.error = error;
    else delete action.error;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(
      this.#file,
      `${JSON.stringify([...this.#actions.values()], null, 2)}\n`,
      0o600,
    );
  }
}

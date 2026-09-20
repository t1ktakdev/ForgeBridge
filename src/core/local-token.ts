import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from './atomic.js';
import { restrictPrivateFile } from './file-permissions.js';

const TokenRecordSchema = z.object({
  version: z.literal(1),
  ['token']: z.string().min(43),
  createdAt: z.iso.datetime(),
});

export type LocalTokenRecord = z.infer<typeof TokenRecordSchema>;

export class LocalTokenStore {
  readonly file: string;
  #record?: LocalTokenRecord;

  constructor(stateDirectory: string) {
    this.file = path.join(stateDirectory, 'local-token.json');
  }

  async loadOrCreate(): Promise<LocalTokenRecord> {
    if (this.#record) return this.#record;
    try {
      this.#record = TokenRecordSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
      await restrictPrivateFile(this.file);
      return this.#record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return this.rotate();
  }

  async rotate(): Promise<LocalTokenRecord> {
    const record: LocalTokenRecord = {
      version: 1,
      ['token']: randomBytes(32).toString('base64url'),
      createdAt: new Date().toISOString(),
    };
    await writeFileAtomic(this.file, `${JSON.stringify(record, null, 2)}\n`, 0o600);
    await restrictPrivateFile(this.file);
    this.#record = record;
    return record;
  }

  async verify(candidate: string): Promise<boolean> {
    const expected = (await this.loadOrCreate()).token;
    const left = Buffer.from(candidate);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}

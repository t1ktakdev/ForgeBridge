import { createHash } from 'node:crypto';

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const item = source[key];
    if (item !== undefined) result[key] = normalize(item);
  }
  return result;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function encodeCursor(value: unknown): string {
  return Buffer.from(stableStringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string): T {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
}

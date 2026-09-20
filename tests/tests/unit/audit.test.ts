import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuditLedger } from '../../src/core/audit.js';
import { Redactor } from '../../src/core/redactor.js';

describe('AuditLedger', () => {
  it('persists a redacted hash chain and verifies it on restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-audit-'));
    const ledger = new AuditLedger(directory, new Redactor(['actual-secret']));
    await ledger.initialize();
    await ledger.append({
      correlationId: 'correlation-1',
      actorId: 'actor',
      sessionId: 'session',
      tool: 'fs_read',
      operation: 'read',
      capability: 'filesystem.read',
      scope: { kind: 'path', value: directory },
      arguments: { ['token']: 'actual-secret' },
      decision: 'allow',
      ruleId: 'test',
      result: 'succeeded',
    });
    await ledger.append({
      correlationId: 'correlation-2',
      actorId: 'actor',
      sessionId: 'session',
      tool: 'git_read',
      operation: 'status',
      capability: 'git.read',
      scope: { kind: 'repository', value: directory },
      decision: 'allow',
      ruleId: 'test',
      result: 'succeeded',
    });

    const raw = await readFile(ledger.file, 'utf8');
    expect(raw).not.toContain('actual-secret');
    const reopened = new AuditLedger(directory, new Redactor());
    await expect(reopened.initialize()).resolves.toBeUndefined();
    expect((await reopened.list()).entries).toHaveLength(2);
  });

  it('detects modification of an existing event', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-audit-'));
    const ledger = new AuditLedger(directory, new Redactor());
    await ledger.initialize();
    await ledger.append({
      correlationId: 'correlation',
      actorId: 'actor',
      sessionId: 'session',
      tool: 'system_info',
      operation: 'info',
      capability: 'system.inspect',
      scope: { kind: 'global', value: '*' },
      decision: 'allow',
      ruleId: 'test',
      result: 'succeeded',
    });
    const raw = await readFile(ledger.file, 'utf8');
    await writeFile(ledger.file, raw.replace('system_info', 'system_edit'), 'utf8');

    const reopened = new AuditLedger(directory, new Redactor());
    await expect(reopened.initialize()).rejects.toMatchObject({ code: 'audit_integrity_error' });
  });

  it('detects modification that happens after initialization', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-audit-'));
    const ledger = new AuditLedger(directory, new Redactor());
    await ledger.initialize();
    await ledger.append({
      correlationId: 'correlation',
      actorId: 'actor',
      sessionId: 'session',
      tool: 'system_info',
      operation: 'info',
      capability: 'system.inspect',
      scope: { kind: 'global', value: '*' },
      decision: 'allow',
      ruleId: 'test',
      result: 'succeeded',
    });
    const raw = await readFile(ledger.file, 'utf8');
    await writeFile(ledger.file, raw.replace('system_info', 'system_edit'), 'utf8');

    await expect(ledger.list()).rejects.toMatchObject({ code: 'audit_integrity_error' });
  });

  it('rejects malformed records and treats a missing ledger as empty', async () => {
    const emptyDirectory = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-audit-'));
    const empty = new AuditLedger(emptyDirectory, new Redactor());
    await empty.initialize();
    await expect(empty.list()).resolves.toEqual({ entries: [] });

    const malformedDirectory = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-audit-'));
    const malformed = new AuditLedger(malformedDirectory, new Redactor());
    await import('node:fs/promises').then(async (fs) => {
      await fs.mkdir(path.dirname(malformed.file), { recursive: true });
      await fs.writeFile(malformed.file, '{"version":1,"sequence":"wrong"}\n');
    });
    await expect(malformed.initialize()).rejects.toMatchObject({ code: 'audit_integrity_error' });
  });

  it('streams bounded pages while still verifying the entire chain', async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-audit-'));
    const ledger = new AuditLedger(state, new Redactor());
    await ledger.initialize();
    for (let index = 0; index < 40; index += 1) {
      await ledger.append({
        correlationId: `correlation-${index}`,
        actorId: 'actor',
        sessionId: 'session',
        tool: 'test',
        operation: 'page',
        capability: 'audit.read',
        scope: { kind: 'device', value: 'device' },
        decision: 'allow',
        ruleId: 'test',
        result: 'succeeded',
      });
    }

    const first = await ledger.list(0, 7);
    expect(first.entries).toHaveLength(7);
    expect(first.next).toBe(7);
    const second = await ledger.list(first.next, 7);
    expect(second.entries.map((entry) => entry.sequence)).toEqual([8, 9, 10, 11, 12, 13, 14]);

    const lines = (await readFile(ledger.file, 'utf8')).trimEnd().split('\n');
    const tail = JSON.parse(lines.at(-1) ?? '{}') as { operation: string };
    tail.operation = 'tampered-after-page';
    lines[lines.length - 1] = JSON.stringify(tail);
    await writeFile(ledger.file, `${lines.join('\n')}\n`);
    await expect(ledger.list(0, 1)).rejects.toMatchObject({ code: 'audit_integrity_error' });
  });
});

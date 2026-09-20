import { describe, expect, it } from 'vitest';
import { OutputBuffer } from '../../src/terminal/output-buffer.js';

describe('OutputBuffer', () => {
  it('evicts old output and reports cursor expiry', () => {
    const output = new OutputBuffer(1024);
    output.append('a'.repeat(900));
    output.append('b'.repeat(900));
    const current = output.read(undefined, 2048);
    expect(current.data).toHaveLength(1024);
    expect(current.evictedBytes).toBe(776);
    expect(() => output.read(0)).toThrow(expect.objectContaining({ code: 'offset_expired' }));
  });

  it('supports incremental reads', () => {
    const output = new OutputBuffer(4096);
    output.append('first');
    const first = output.read(0, 3);
    expect(first.data).toBe('fir');
    output.append('second');
    const rest = output.read(first.nextOffset);
    expect(rest.data).toBe('stsecond');
  });

  it('bounds a single oversized chunk without retaining the discarded prefix', () => {
    const buffer = new OutputBuffer(1024);
    buffer.append(Buffer.alloc(8 * 1024 * 1024, 0x78));

    const result = buffer.read();
    expect(Buffer.byteLength(result.data)).toBe(1024);
    expect(result.totalBytes).toBe(8 * 1024 * 1024);
    expect(result.evictedBytes).toBe(8 * 1024 * 1024 - 1024);
  });
});

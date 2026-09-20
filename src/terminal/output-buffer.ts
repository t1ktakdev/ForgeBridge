import { ForgeBridgeError } from '../core/errors.js';

export type OutputSlice = {
  offset: number;
  nextOffset: number;
  oldestOffset: number;
  totalBytes: number;
  data: string;
  hasMore: boolean;
  evictedBytes: number;
};

export class OutputBuffer {
  readonly #maximumBytes: number;
  #buffer = Buffer.alloc(0);
  #baseOffset = 0;
  #totalBytes = 0;

  constructor(maximumBytes: number) {
    this.#maximumBytes = Math.max(1024, maximumBytes);
  }

  append(value: string | Uint8Array): void {
    const incoming = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    this.#totalBytes += incoming.length;
    if (incoming.length >= this.#maximumBytes) {
      this.#buffer = incoming.subarray(incoming.length - this.#maximumBytes);
      this.#baseOffset = this.#totalBytes - this.#maximumBytes;
      return;
    }
    const retainedBytes = Math.min(this.#buffer.length, this.#maximumBytes - incoming.length);
    const retained = this.#buffer.subarray(this.#buffer.length - retainedBytes);
    this.#buffer = Buffer.concat([retained, incoming], retainedBytes + incoming.length);
    this.#baseOffset = this.#totalBytes - this.#buffer.length;
  }

  read(offset = this.#baseOffset, limit = 64 * 1024): OutputSlice {
    if (offset < this.#baseOffset) {
      throw new ForgeBridgeError('offset_expired', 'Requested output has been evicted', {
        requestedOffset: offset,
        oldestOffset: this.#baseOffset,
      });
    }
    if (offset > this.#totalBytes) {
      throw new ForgeBridgeError('invalid_offset', 'Requested output offset is beyond the stream', {
        requestedOffset: offset,
        totalBytes: this.#totalBytes,
      });
    }
    const boundedLimit = Math.max(1, Math.min(limit, 1024 * 1024));
    const localOffset = offset - this.#baseOffset;
    const bytes = this.#buffer.subarray(localOffset, localOffset + boundedLimit);
    const nextOffset = offset + bytes.length;
    return {
      offset,
      nextOffset,
      oldestOffset: this.#baseOffset,
      totalBytes: this.#totalBytes,
      data: bytes.toString('utf8'),
      hasMore: nextOffset < this.#totalBytes,
      evictedBytes: this.#baseOffset,
    };
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }
}

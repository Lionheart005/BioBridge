import { describe, expect, it } from 'vitest';
import { hashJsonStable, sha256Hex } from '@/core/utils/hash';

describe('hash utilities', () => {
  it('computes standard SHA-256 hex digest for strings and Uint8Array', async () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256Hex('abc')).toBe(expected);

    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(expected);
    expect(await sha256Hex(bytes.buffer)).toBe(expected);
  });

  it('produces identical hashes for objects with differently ordered keys', async () => {
    const objA = {
      b: 2,
      a: {
        z: true,
        y: [1, { d: 4, c: 3 }],
      },
      ignored: undefined,
    };
    const objB = {
      a: {
        y: [1, { c: 3, d: 4 }],
        z: true,
      },
      b: 2,
    };

    const hashA = await hashJsonStable(objA);
    const hashB = await hashJsonStable(objB);
    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64);
  });

  it('distinguishes array element order', async () => {
    const hash1 = await hashJsonStable({ items: [1, 2] });
    const hash2 = await hashJsonStable({ items: [2, 1] });
    expect(hash1).not.toBe(hash2);
  });
});

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, timingSafeEqual } from '@/lib/crypto';

describe('crypto encrypt/decrypt', () => {
  it('roundtrips a nested object', () => {
    const data = { a: 1, b: 'hello', c: { d: true }, e: [1, 2, 3] };
    const token = encrypt(data);
    expect(typeof token).toBe('string');
    expect(decrypt(token)).toEqual(data);
  });

  it('produces different tokens for different inputs', () => {
    expect(encrypt({ x: 1 })).not.toBe(encrypt({ x: 2 }));
  });

  it('produces different tokens each time (random IV)', () => {
    const a = encrypt({ k: 'v' });
    const b = encrypt({ k: 'v' });
    expect(a).not.toBe(b);
  });
});

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths (no crash)', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('treats empty vs empty as equal', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

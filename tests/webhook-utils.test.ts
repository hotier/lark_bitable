import { describe, it, expect } from 'vitest';
import {
  flattenKeys,
  getNestedValue,
  safeStringify,
  sanitizeAgainstPrototypePollution,
} from '@/lib/webhook-utils';

describe('flattenKeys', () => {
  it('flattens nested objects with dot path', () => {
    expect(flattenKeys({ a: { b: 1 }, c: 2 })).toEqual(['a.b', 'c']);
  });

  it('keeps the key for array/primitive values (does not recurse into arrays)', () => {
    expect(flattenKeys({ a: [1, 2], b: 'x' })).toEqual(['a', 'b']);
  });

  it('returns empty for non-objects', () => {
    expect(flattenKeys(null)).toEqual([]);
    expect(flattenKeys(5)).toEqual([]);
  });
});

describe('getNestedValue', () => {
  const obj = { a: { b: { c: 42 } } };

  it('reads a nested value', () => {
    expect(getNestedValue(obj, 'a.b.c')).toBe(42);
  });

  it('returns undefined for a missing path', () => {
    expect(getNestedValue(obj, 'a.x.y')).toBeUndefined();
  });

  it('returns undefined when traversing into a non-object', () => {
    expect(getNestedValue(obj, 'a.b.c.d')).toBeUndefined();
  });
});

describe('safeStringify', () => {
  it('truncates over-long strings', () => {
    const out = safeStringify({ k: 'x'.repeat(200) }, 10);
    expect(out).toContain('…');
    expect(out).toContain('字节');
  });

  it('does not truncate short strings', () => {
    const out = safeStringify({ k: 'short' }, 100);
    expect(out).toBe('{"k":"short"}');
  });
});

describe('sanitizeAgainstPrototypePollution', () => {
  it('strips __proto__ key', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    const out = sanitizeAgainstPrototypePollution(input) as Record<string, unknown>;
    expect(out.ok).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
    // 原型未被污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('strips nested constructor / prototype keys', () => {
    const input = { a: { constructor: { x: 1 } }, b: { prototype: { y: 2 } } };
    const out = sanitizeAgainstPrototypePollution(input) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out.a as object, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out.b as object, 'prototype')).toBe(false);
  });

  it('returns primitives unchanged', () => {
    expect(sanitizeAgainstPrototypePollution(5)).toBe(5);
    expect(sanitizeAgainstPrototypePollution('s')).toBe('s');
  });
});

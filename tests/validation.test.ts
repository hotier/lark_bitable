import { describe, it, expect } from 'vitest';
import { parseSecretToken, parseWebhookBody, validateBitableBody } from '@/lib/validation';

describe('parseSecretToken', () => {
  it('trims whitespace from a valid token', () => {
    expect(parseSecretToken('  abc123  ')).toBe('abc123');
  });

  it('returns empty string for undefined', () => {
    expect(parseSecretToken(undefined)).toBe('');
  });

  it('returns empty string for a too-long token', () => {
    expect(parseSecretToken('x'.repeat(600))).toBe('');
  });

  it('returns empty string for a non-string', () => {
    expect(parseSecretToken(123)).toBe('');
  });
});

describe('parseWebhookBody', () => {
  it('returns {} for non-objects', () => {
    expect(parseWebhookBody(null)).toEqual({});
    expect(parseWebhookBody('str')).toEqual({});
    expect(parseWebhookBody([1, 2])).toEqual({});
  });

  it('returns the object for a valid object', () => {
    expect(parseWebhookBody({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
  });

  it('strips prototype-pollution keys', () => {
    const out = parseWebhookBody({
      __proto__: { polluted: true },
      ok: 1,
    }) as Record<string, unknown>;
    expect(out.ok).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
  });
});

describe('validateBitableBody', () => {
  it('returns an error when action is missing', () => {
    expect(validateBitableBody({})).toMatch(/action/);
  });

  it('returns an error for an unknown action', () => {
    expect(validateBitableBody({ action: 'hack' })).toMatch(/不支持的操作类型/);
  });

  it('passes for a no-payload action', () => {
    expect(validateBitableBody({ action: 'authStatus' })).toBeNull();
  });

  it('returns an error when a required string field is empty', () => {
    expect(validateBitableBody({ action: 'createApp', appName: '' })).toMatch(/缺少参数: appName/);
  });

  it('returns an error when a required field is missing', () => {
    expect(validateBitableBody({ action: 'read' })).toMatch(/缺少参数: appToken/);
  });

  it('passes when all required fields are present', () => {
    expect(
      validateBitableBody({
        action: 'create',
        appToken: 't',
        tableId: 'tbl',
        fields: { name: 'x' },
      }),
    ).toBeNull();
  });

  it('rejects missing fields on create', () => {
    expect(validateBitableBody({ action: 'create', appToken: 't' })).toMatch(/缺少参数/);
  });
});

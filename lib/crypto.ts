import crypto from 'crypto';
import { logger } from '@/lib/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * 从 APP_SECRET 派生 256-bit 加密密钥
 *
 * ⚠️ 生产环境必须配置 APP_SECRET，否则使用弱 fallback 密钥
 */
function getKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('生产环境必须配置 APP_SECRET 环境变量');
    }
    logger.warn('[crypto] APP_SECRET 未配置，使用开发环境 fallback 密钥');
  }
  return crypto.createHash('sha256').update(secret || 'fallback-dev-key-change-me').digest();
}

/**
 * 恒定时间字符串比较，防止时序攻击（token / 签名校验场景）。
 * 长度不同直接返回 false；长度相同用 crypto.timingSafeEqual 逐字节比较。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 将 JSON 对象加密为一个 URL 安全的短字符串
 */
export function encrypt(data: Record<string, unknown>): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // IV + AuthTag + Ciphertext → base64url
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url');
}

/**
 * 解密并返回原始 JSON 对象
 */
export function decrypt(token: string): Record<string, unknown> {
  const key = getKey();
  const buf = Buffer.from(token, 'base64url');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

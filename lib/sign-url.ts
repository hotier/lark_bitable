import { createHmac, createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'crypto';

const SECRET = process.env.APP_SECRET || '';
const DEFAULT_DURATION_SECONDS = 6 * 60 * 60; // 默认 6 小时

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐 12 字节 nonce

/** 从 APP_SECRET 派生 32 字节 AES-256 密钥 */
function getKey(): Buffer {
  return createHash('sha256').update(SECRET).digest();
}

/** AES-256-GCM 加密，返回 base64url */
function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // 格式: iv(12) + authTag(16) + ciphertext → base64url
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url');
}

/** AES-256-GCM 解密 base64url → 明文，失败返回 null */
function decrypt(token: string): string | null {
  try {
    const key = getKey();
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < IV_LENGTH + 16) return null;
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = buf.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ── 签名接口 ────────────────────────────────────────

interface SignParams {
  fileToken: string;
  tableId?: string;
  fieldId?: string;
  recordId?: string;
  fileName?: string;
  durationSeconds?: number;
}

interface SignedUrl {
  url: string;
  expiresAt: number; // Unix timestamp (秒)
}

/**
 * 生成加密的预览链接 token
 * token 内包含：ft、tid、fid、rid、n、exp（过期时间）、sig（HMAC 防篡改）
 */
export function signPreviewUrl(params: SignParams): SignedUrl {
  const { fileToken, tableId, fieldId, recordId, fileName, durationSeconds } = params;
  const expires = Math.floor(Date.now() / 1000) + (durationSeconds || DEFAULT_DURATION_SECONDS);

  // 明文 payload 用于 HMAC 签名
  const payload = [
    fileToken,
    tableId || '',
    fieldId || '',
    recordId || '',
    fileName || '',
    String(expires),
  ].join('|');
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex');

  // 将所有参数打包为 JSON 再 AES 加密
  const tokenData = JSON.stringify({
    ft: fileToken,
    tid: tableId || '',
    fid: fieldId || '',
    rid: recordId || '',
    n: fileName || '',
    exp: expires,
    sig,
  });

  const token = encrypt(tokenData);

  return {
    url: `/api/feishu/files/preview?t=${encodeURIComponent(token)}`,
    expiresAt: expires,
  };
}

// ── 验签接口 ────────────────────────────────────────

export interface DecryptedPreviewParams {
  fileToken: string;
  tableId?: string;
  fieldId?: string;
  recordId?: string;
  fileName: string;
  expires: string;
  sign: string;
}

interface VerifyResult {
  valid: boolean;
  reason?: string;
  params?: DecryptedPreviewParams;
}

/**
 * 解密 token → 校验 HMAC 签名 + 过期时间
 */
export function verifyPreviewUrl(token: string): VerifyResult {
  if (!token) {
    return { valid: false, reason: '缺少 token 参数' };
  }

  const plaintext = decrypt(token);
  if (!plaintext) {
    return { valid: false, reason: 'token 解密失败' };
  }

  let data: Record<string, string>;
  try {
    data = JSON.parse(plaintext);
  } catch {
    return { valid: false, reason: 'token 格式无效' };
  }

  const { ft, tid, fid, rid, n, exp, sig } = data;
  if (!ft || !exp || !sig) {
    return { valid: false, reason: 'token 缺少必要字段' };
  }

  // 校验过期时间
  const expiresNum = parseInt(exp, 10);
  if (isNaN(expiresNum)) {
    return { valid: false, reason: '有效期格式无效' };
  }
  if (Date.now() > expiresNum * 1000) {
    return { valid: false, reason: '链接已过期' };
  }

  // 校验 HMAC（防止通过某种方式注入篡改后的 token）
  const payload = [ft, tid || '', fid || '', rid || '', n || '', exp].join('|');
  const expectedSign = createHmac('sha256', SECRET).update(payload).digest('hex');
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSign))) {
    return { valid: false, reason: '签名校验失败' };
  }

  return {
    valid: true,
    params: {
      fileToken: ft,
      tableId: tid || undefined,
      fieldId: fid || undefined,
      recordId: rid || undefined,
      fileName: n || ft || 'file',
      expires: exp,
      sign: sig,
    },
  };
}

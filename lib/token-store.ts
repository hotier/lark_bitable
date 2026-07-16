/**
 * 服务端用户 Token 持久化存储（PostgreSQL + 内存缓存）
 *
 * 将飞书 OAuth 的 user_access_token 和 refresh_token 持久化到 Neon PostgreSQL，
 * 兼容 Vercel serverless 的 ephemeral filesystem。
 *
 * - 数据库持久化：`user_tokens` 表（单行，id='default'）
 * - 内存缓存层：零延迟读取，冷启动后首次访问从 DB 加载
 * - 并发保护：写操作通过锁（Promise 链）序列化
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { sql } from '@/lib/db';

export interface StoredToken {
  /** 飞书 user_access_token */
  accessToken: string;
  /** access_token 的过期时间戳（毫秒） */
  accessTokenExpireAt: number;
  /** 飞书 refresh_token（有效期约 30 天） */
  refreshToken: string;
  /** refresh_token 的过期时间戳（毫秒） */
  refreshTokenExpireAt: number;
  /** 最后更新时间 ISO */
  updatedAt: string;
}

// ── 本地文件兜底路径 ──
const TOKEN_FILE = resolve(process.cwd(), '.data', 'token.json');

function ensureDataDir(): void {
  const dir = resolve(process.cwd(), '.data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── 内存缓存层 ──
let _cached: StoredToken | null | undefined = undefined; // undefined = 未初始化

// ── 写锁（确保并发写入安全序列化） ──
let _writePromise: Promise<void> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _writePromise;
  let release: () => void;
  _writePromise = new Promise<void>((resolve) => { release = resolve; });
  return prev.then(fn).finally(() => release!());
}

// ── 辅助 ──

function isTokenValid(token: StoredToken): boolean {
  if (Date.now() >= token.accessTokenExpireAt) {
    // access_token 过期但 refresh_token 有效 → 仍返回，由调用方自行刷新
    return Date.now() < token.refreshTokenExpireAt;
  }
  return true;
}

/** 将 DB 行转为 StoredToken */
function rowToToken(r: Record<string, unknown>): StoredToken {
  return {
    accessToken: r.access_token as string,
    accessTokenExpireAt: Number(r.access_token_expire_at),
    refreshToken: r.refresh_token as string,
    refreshTokenExpireAt: Number(r.refresh_token_expire_at),
    updatedAt: r.updated_at as string,
  };
}

// ── 本地文件兜底 ──

function loadFromFile(): StoredToken | null {
  try {
    if (!existsSync(TOKEN_FILE)) return null;
    const raw = readFileSync(TOKEN_FILE, 'utf-8');
    const token = JSON.parse(raw) as StoredToken;
    return isTokenValid(token) ? token : null;
  } catch {
    return null;
  }
}

function saveToFile(token: StoredToken): void {
  try {
    ensureDataDir();
    writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[token-store] 写入本地文件失败:', err instanceof Error ? err.message : err);
  }
}

function deleteFile(): void {
  try { if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

// ── DB 操作 ──

async function loadFromDb(): Promise<StoredToken | null> {
  try {
    const rows = await sql()`
      SELECT access_token, access_token_expire_at, refresh_token,
             refresh_token_expire_at, updated_at
      FROM user_tokens
      WHERE id = 'default'
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const token = rowToToken(rows[0] as Record<string, unknown>);
    return isTokenValid(token) ? token : null;
  } catch (err) {
    console.error('[token-store] 从数据库加载 token 失败，尝试本地文件兜底:', err instanceof Error ? err.message : err);
    return loadFromFile();
  }
}

async function saveToDb(token: StoredToken): Promise<void> {
  // 先写本地文件（可靠兜底）
  saveToFile(token);

  await sql()`
    INSERT INTO user_tokens (id, access_token, access_token_expire_at,
      refresh_token, refresh_token_expire_at, updated_at)
    VALUES ('default', ${token.accessToken}, ${token.accessTokenExpireAt},
      ${token.refreshToken}, ${token.refreshTokenExpireAt}, ${token.updatedAt})
    ON CONFLICT (id) DO UPDATE SET
      access_token           = EXCLUDED.access_token,
      access_token_expire_at = EXCLUDED.access_token_expire_at,
      refresh_token          = EXCLUDED.refresh_token,
      refresh_token_expire_at = EXCLUDED.refresh_token_expire_at,
      updated_at             = EXCLUDED.updated_at
  `;
}

async function deleteFromDb(): Promise<void> {
  deleteFile();
  try {
    await sql()`DELETE FROM user_tokens WHERE id = 'default'`;
  } catch { /* DB 不可达时忽略 */ }
}

// ── 公开 API ──

/**
 * 同步从内存缓存获取 token（零 IO，不访问数据库）
 * 冷启动时返回 null，调用方应处理此情况（如 `ensureAuth` 会用异步版本兜底）
 */
export function loadTokenSync(): StoredToken | null {
  if (_cached !== undefined && _cached !== null && isTokenValid(_cached)) {
    return _cached;
  }
  return null;
}

/**
 * 异步加载 token：优先内存缓存，否则从数据库加载
 */
export async function loadToken(): Promise<StoredToken | null> {
  // 第一次调用时从 DB 加载
  if (_cached === undefined) {
    _cached = await loadFromDb();
  }
  if (_cached && !isTokenValid(_cached)) {
    _cached = null;
  }
  return _cached ?? null;
}

/**
 * 将 token 持久化到数据库（并发安全）
 * 同时更新内存缓存
 */
export async function saveToken(token: {
  accessToken: string;
  accessTokenExpireAt: number;
  refreshToken: string;
  refreshTokenExpireAt: number;
}): Promise<void> {
  const stored: StoredToken = {
    ...token,
    updatedAt: new Date().toISOString(),
  };

  // 立即更新内存缓存（零等待，即便 DB 写入失败本次会话仍可用）
  _cached = stored;

  // 通过写锁序列化数据库写入；DB 暂不可用时降级为「仅内存」，不阻断登录
  try {
    await withWriteLock(() => saveToDb(stored));
  } catch (err) {
    console.warn('[token-store] 持久化 token 到数据库失败，降级为内存存储（重启后失效）:', err instanceof Error ? err.message : err);
  }
}

/**
 * 删除持久化的 token（用户登出时调用）
 */
export async function deleteToken(): Promise<void> {
  _cached = null;
  try {
    await deleteFromDb();
  } catch (err) {
    console.error('[token-store] 删除 token 失败:', err);
  }
}

/**
 * 同步获取缓存的 token（零 IO，供非异步上下文快速读取）
 * 冷启动时返回 null
 */
export function getCachedToken(): StoredToken | null {
  if (_cached === undefined) return null;
  if (_cached && !isTokenValid(_cached)) return null;
  return _cached;
}

/**
 * 强制从数据库重新加载 token（用于冷启动后的兜底恢复）
 */
export async function reloadToken(): Promise<StoredToken | null> {
  _cached = await loadFromDb();
  if (_cached && !isTokenValid(_cached)) {
    _cached = null;
  }
  return _cached ?? null;
}

/**
 * 预览参数短 Token 存储（PostgreSQL + 内存缓存）
 *
 * 将文件预览参数映射为短 ID，避免长参数出现在 URL 中。
 * 兼容 Vercel serverless ephemeral filesystem。
 *
 * - 数据库持久化：`preview_tokens` 表
 * - 内存缓存层：零延迟读取，冷启动后首次访问从 DB 加载
 * - 去重加速：fileToken → id 的额外映射表 O(1) 查找
 * - 定期清理：取数据时自动清除过期条目
 *
 * TTL：30 分钟（与飞书临时下载链接保持一致）
 */

import crypto from 'crypto';
import { sql } from '@/lib/db';

const TTL_MS = 30 * 60 * 1000; // 30 分钟

export interface TokenEntry {
  fileToken: string;
  tableId?: string;
  fieldId?: string;
  recordId?: string;
  fileName: string;
  createdAt: number;
}

// ── 内存缓存层 ──
let store: Map<string, TokenEntry> | undefined;
let fileTokenIndex: Map<string, string> | undefined; // fileToken → id，加速去重

// ── 写锁 ──
let writePromise: Promise<void> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writePromise;
  let release: () => void;
  writePromise = new Promise<void>((r) => { release = r; });
  return prev.then(fn).finally(() => release!());
}

// ── DB 操作 ──

async function loadFromDb(): Promise<Map<string, TokenEntry>> {
  const result = new Map<string, TokenEntry>();
  try {
    const now = Date.now();
    const rows = await sql()`
      SELECT id, file_token, table_id, field_id, record_id, file_name, created_at
      FROM preview_tokens
      ORDER BY created_at ASC
    `;
    for (const r of rows) {
      const createdAt = Number(r.created_at);
      if (now - createdAt <= TTL_MS) {
        result.set(r.id as string, {
          fileToken: r.file_token as string,
          tableId: (r.table_id as string) || undefined,
          fieldId: (r.field_id as string) || undefined,
          recordId: (r.record_id as string) || undefined,
          fileName: r.file_name as string,
          createdAt,
        });
      }
    }
  } catch (err) {
    console.error('[preview-token-store] 从数据库加载失败:', err);
  }
  return result;
}

async function saveEntryToDb(id: string, entry: TokenEntry): Promise<void> {
  await sql()`
    INSERT INTO preview_tokens (id, file_token, table_id, field_id, record_id, file_name, created_at)
    VALUES (${id}, ${entry.fileToken}, ${entry.tableId ?? null},
      ${entry.fieldId ?? null}, ${entry.recordId ?? null},
      ${entry.fileName}, ${entry.createdAt})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function deleteExpiredFromDb(now: number): Promise<void> {
  await sql()`
    DELETE FROM preview_tokens
    WHERE ${now} - created_at > ${TTL_MS}
  `;
}

// ── 初始化 ──

async function ensureStore(): Promise<void> {
  if (store) return;
  store = await loadFromDb();
  // 构建 fileToken → id 索引
  fileTokenIndex = new Map();
  for (const [id, entry] of store) {
    fileTokenIndex.set(entry.fileToken, id);
  }
}

// ── 内部辅助 ──

function generateId(): string {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

function cleanExpired(): void {
  if (!store) return;
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(id);
      fileTokenIndex?.delete(entry.fileToken);
    }
  }
}

// ── 公开 API ──

/**
 * 存储文件参数并返回短 ID（去重：相同 fileToken 复用已有 ID）
 */
export async function savePreviewToken(params: Omit<TokenEntry, 'createdAt'>): Promise<string> {
  await ensureStore();
  cleanExpired();

  // O(1) 去重查找
  const existingId = fileTokenIndex?.get(params.fileToken);
  if (existingId) return existingId;

  const id = generateId();
  const entry: TokenEntry = { ...params, createdAt: Date.now() };
  store!.set(id, entry);
  fileTokenIndex?.set(params.fileToken, id);

  // 异步写 DB + 清理过期数据（不阻塞返回）
  const now = Date.now();
  withWriteLock(async () => {
    await Promise.all([
      saveEntryToDb(id, entry),
      // 每次写入都清理 DB 过期条目，防止无限增长
      deleteExpiredFromDb(now),
    ]);
  }).catch((err) =>
    console.error('[preview-token-store] 写入/清理数据库失败:', err)
  );

  return id;
}

/**
 * 根据短 ID 获取文件参数，不存在或过期返回 null
 */
export async function getPreviewToken(id: string): Promise<TokenEntry | null> {
  await ensureStore();
  const entry = store?.get(id);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > TTL_MS) {
    store?.delete(id);
    fileTokenIndex?.delete(entry.fileToken);
    // 异步清理 DB 过期数据（概率触发，减少开销）
    if (Math.random() < 0.1) {
      withWriteLock(() => deleteExpiredFromDb(Date.now())).catch(() => {});
    }
    return null;
  }

  return entry;
}

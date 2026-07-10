/**
 * 服务端内存缓存层（LRU + TTL + 前缀索引）
 *
 * 对飞书 API 的只读查询结果进行短时缓存，减少 API 调用次数和延迟。
 *
 * 优化要点：
 * - LRU 淘汰策略：超过 maxEntries 时移除最久未使用的条目
 * - TTL 可配置：通过环境变量 CACHE_TTL_MS 覆盖默认值
 * - 前缀索引：辅助按前缀批量删除（cacheDelByPrefix 做 startsWith 扫描）
 */

// ── 可配置参数 ──
const DEFAULT_TTL = Number(process.env.CACHE_TTL_MS) || 300_000; // 默认 5 分钟
const RECORD_TTL  = Math.max(60_000, Math.floor(DEFAULT_TTL / 2)); // 记录缓存 2.5 分钟

/**
 * 分层 TTL：飞书数据靠强制同步按钮主动刷新，
 * 因此统一用 30 分钟长缓存以减少 API 调用；
 * 经由本应用自身的写操作仍会 cacheDel 立即失效。
 */
export const TTL = {
  APPS:   30 * 60_000, // 多维表格 / 云文档 / 电子表格列表
  TABLES: 30 * 60_000, // 数据表列表
  FIELDS: 30 * 60_000, // 字段列表
  RECORDS:30 * 60_000, // 记录列表
  RECORD: 30 * 60_000, // 单条记录
} as const;

const MAX_ENTRIES = 2000;

interface CacheEntry<T> {
  data: T;
  expiry: number;
  key: string;
  prev?: CacheEntry<unknown>;
  next?: CacheEntry<unknown>;
}

// LRU 双向链表 + Map
const store = new Map<string, CacheEntry<unknown>>();
let head: CacheEntry<unknown> | undefined;
let tail: CacheEntry<unknown> | undefined;

// 前缀 → keys 索引（加速按前缀批量删除）
const prefixIndex = new Map<string, Set<string>>();

// ── LRU 链表操作 ──

function listRemove(entry: CacheEntry<unknown>): void {
  if (entry.prev) entry.prev.next = entry.next;
  else head = entry.next;
  if (entry.next) entry.next.prev = entry.prev;
  else tail = entry.prev;
}

function listPushFront(entry: CacheEntry<unknown>): void {
  entry.next = head;
  entry.prev = undefined;
  if (head) head.prev = entry;
  head = entry;
  if (!tail) tail = entry;
}

function listTouch(entry: CacheEntry<unknown>): void {
  listRemove(entry);
  listPushFront(entry);
}

function listEvictTail(): void {
  if (tail) {
    const evicted = tail;
    listRemove(evicted);
    removePrefixIndex(evicted.key);
    store.delete(evicted.key);
  }
}

// ── 前缀索引维护 ──

function getPrefix(key: string): string | null {
  const idx = key.lastIndexOf(':');
  return idx > 0 ? key.slice(0, idx) : null;
}

function addPrefixIndex(key: string): void {
  const prefix = getPrefix(key);
  if (!prefix) return;
  let keys = prefixIndex.get(prefix);
  if (!keys) {
    keys = new Set();
    prefixIndex.set(prefix, keys);
  }
  keys.add(key);
}

function removePrefixIndex(key: string): void {
  const prefix = getPrefix(key);
  if (!prefix) return;
  const keys = prefixIndex.get(prefix);
  if (keys) {
    keys.delete(key);
    if (keys.size === 0) prefixIndex.delete(prefix);
  }
}

// ── 公开 API ──

/** 从缓存获取值，不存在或已过期返回 null */
export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    removePrefixIndex(entry.key);
    listRemove(entry);
    store.delete(key);
    return null;
  }
  listTouch(entry);
  return entry.data as T;
}

/** 写入缓存（自动维护 LRU + 前缀索引） */
export function cacheSet<T>(key: string, data: T, ttlMs = DEFAULT_TTL): void {
  // 若已存在同 key，移除旧条目
  const existing = store.get(key);
  if (existing) {
    removePrefixIndex(existing.key);
    listRemove(existing);
    store.delete(key);
  }

  // 超限时淘汰最久未使用条目
  while (store.size >= MAX_ENTRIES) listEvictTail();

  const entry: CacheEntry<T> = { data, expiry: Date.now() + ttlMs, key };
  store.set(key, entry);
  listPushFront(entry);
  addPrefixIndex(key);
}

/** 删除指定缓存 */
export function cacheDel(key: string): void {
  const entry = store.get(key);
  if (!entry) return;
  removePrefixIndex(entry.key);
  listRemove(entry);
  store.delete(key);
}

/** 按前缀批量删除（key 以 prefix 开头即删除；同时清理 LRU 与前缀索引） */
export function cacheDelByPrefix(prefix: string): void {
  for (const key of Array.from(store.keys())) {
    if (!key.startsWith(prefix)) continue;
    const entry = store.get(key);
    if (entry) {
      removePrefixIndex(entry.key);
      listRemove(entry);
      store.delete(key);
    }
  }
}

/** 生成缓存 key */
export function cacheKey(prefix: string, ...parts: string[]): string {
  return `${prefix}:${parts.join(':')}`;
}

/**
 * 带缓存的查询包装器
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = DEFAULT_TTL,
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== null) {
    console.log(`[cache] HIT  ${key}`);
    return cached;
  }
  console.log(`[cache] MISS ${key}`);
  const data = await fetcher();
  cacheSet(key, data, ttlMs);
  return data;
}

/** 返回 TTL 常量供外部使用 */
export { DEFAULT_TTL, RECORD_TTL };

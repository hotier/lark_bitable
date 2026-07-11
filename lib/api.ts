/**
 * 前端 API 客户端 — 所有数据获取路径的入口
 *
 * 数据流：
 *   前端组件 → lib/api.ts → POST /api/bitable → services/feishu-bitable.ts → 飞书开放平台
 *
 * ⚠️ Token 不再存储于 localStorage，改为 HttpOnly Cookie 自动携带：
 *   - OAuth 回调后，服务端将 token 写入 HttpOnly Cookie（JS 不可读，防 XSS）
 *   - 所有 API 请求携带 credentials: 'include'，Cookie 自动发送
 *   - 前端通过 checkAuthStatus() 获知登录状态
 */

import type {
  ApiResponse,
  App,
  BitableRecord,
  Field,
  ListAppsData,
  ListRecordsData,
  ListTablesData,
  OAuthUrlData,
  Table,
  FieldType,
} from '@/types';

const API_URL = '/api/bitable';

/**
 * 导出整个多维表格为 Excel/CSV 并触发浏览器下载。
 * 调用 /api/bitable/export 拿到文件流，按响应头中的文件名落地。
 */
export async function exportBitable(appToken: string, format: 'xlsx' | 'csv' = 'xlsx'): Promise<void> {
  const res = await fetch('/api/bitable/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appToken, format }),
    credentials: 'include',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(err.error || `导出失败 (${res.status})`);
  }

  // 从 Content-Disposition 解析文件名（兼容 filename*=UTF-8'' 与 filename="..."）
  const cd = res.headers.get('Content-Disposition') || '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const quoted = cd.match(/filename="([^"]+)"/i);
  let fileName = `bitable_export.${format}`;
  if (star) {
    try { fileName = decodeURIComponent(star[1]); } catch { fileName = star[1]; }
  } else if (quoted) {
    fileName = quoted[1];
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ====== 模块级缓存：避免页面切换时重复请求 ======
// 采用「会话内缓存 + 事件失效」策略：不设置明确过期时间，
// 缓存仅在整页刷新时清空（内存存储，非 localStorage）。
// 数据更新依赖两类异步事件：① 应用内变更（新建/删除）后主动失效；
// ② 用户点击「同步」按钮强制重新拉取。

interface AppsCacheEntry {
  data: ListAppsData;
  timestamp: number;
}
let appsCache: AppsCacheEntry | null = null;

/** 清除 apps 缓存（用户登出或显式刷新时调用） */
export function invalidateAppsCache() {
  appsCache = null;
}

/**
 * 统一 API 请求封装
 * Token 通过 HttpOnly Cookie 自动携带，前端无需手动处理
 */
async function request<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',  // ← 携带 HttpOnly Cookie
    body: JSON.stringify(body),
  });

  const result: ApiResponse<T> & { feishuCode?: number; feishuMsg?: string } = await response.json();

  if (!result.success) {
    let errMsg = result.error || '请求失败';
    if (result.feishuCode !== undefined) {
      errMsg += ` [飞书 ${result.feishuCode}: ${result.feishuMsg || '未知'}]`;
    }
    throw new Error(errMsg);
  }

  return result.data;
}

// ====== OAuth 授权 ======

/** 获取飞书 OAuth 授权 URL */
export async function fetchOAuthUrl(): Promise<string> {
  const data = await request<OAuthUrlData>({ action: 'getOAuthUrl' });
  return data.url;
}

/**
 * 检查认证状态（直接读取 Cookie，不再需要额外交换步骤）
 * Token 已在 OAuth 回调时直接写入 HttpOnly Cookie
 */
export async function exchangeAuthCode(): Promise<boolean> {
  return checkAuthStatus();
}

/** 检查当前认证状态 */
export async function checkAuthStatus(): Promise<boolean> {
  try {
    const data = await request<{ authenticated: boolean }>({ action: 'authStatus' });
    return data.authenticated;
  } catch {
    return false;
  }
}

/** 登出 — 清除 HttpOnly Cookie + 服务端 token */
export async function logout(): Promise<void> {
  await request<{ ok: boolean }>({ action: 'logout' });
  invalidateAppsCache();
}

// ====== 多维表格应用 (Apps) ======

export interface ListAppsResult {
  data: ListAppsData;
  fromCache: boolean;
}

/** 获取所有多维表格应用列表（带模块级缓存，会话内有效、无明确过期） */
export async function listApps(force = false): Promise<ListAppsResult> {
  if (!force && appsCache) {
    return { data: appsCache.data, fromCache: true };
  }
  const data = await request<ListAppsData>({ action: 'listApps', force });
  appsCache = { data, timestamp: Date.now() };
  return { data, fromCache: false };
}

/** 强制刷新应用列表（跳过缓存，并绕过服务端缓存重新拉取飞书数据） */
export async function refreshApps(force = true): Promise<ListAppsResult> {
  appsCache = null;
  return listApps(force);
}

/** 创建新的多维表格应用 */
export async function createApp(name: string, folderToken?: string): Promise<App> {
  return request<App>({ action: 'createApp', appName: name, folderToken });
}

// ====== 云文档 (Docx) ======

// 会话内缓存（无明确过期），按 folderToken 索引；仅缓存首页（pageToken 为空）
const docsCache = new Map<string, { data: ListAppsData; ts: number }>();

/** 清除云文档缓存（新建/删除/登出时调用）；不传 folderToken 则清空全部 */
export function invalidateDocsCache(folderToken = ''): void {
  if (folderToken === '') docsCache.clear();
  else docsCache.delete(folderToken);
}

export async function listDocs(pageSize = 100, pageToken = '', folderToken = '', force = false): Promise<ListAppsData> {
  if (!force && pageToken === '') {
    const cached = docsCache.get(folderToken);
    if (cached) return cached.data;
  }
  const data = await request<ListAppsData>({ action: 'listDocs', pageSize, pageToken, folderToken, force });
  if (pageToken === '') docsCache.set(folderToken, { data, ts: Date.now() });
  return data;
}

/** 强制刷新云文档列表（绕过缓存重新拉取并更新缓存） */
export async function refreshDocs(folderToken = '', force = true): Promise<ListAppsData> {
  invalidateDocsCache(folderToken);
  return listDocs(100, '', folderToken, force);
}

export async function createDoc(title: string, folderToken?: string): Promise<App> {
  return request<App>({ action: 'createDoc', appName: title, folderToken });
}

// ====== 在线表格 (Sheet) ======

// 会话内缓存（无明确过期），按 folderToken 索引；仅缓存首页（pageToken 为空）
const sheetsCache = new Map<string, { data: ListAppsData; ts: number }>();

/** 清除在线表格缓存（新建/删除/登出时调用）；不传 folderToken 则清空全部 */
export function invalidateSheetsCache(folderToken = ''): void {
  if (folderToken === '') sheetsCache.clear();
  else sheetsCache.delete(folderToken);
}

export async function listSheets(pageSize = 100, pageToken = '', folderToken = '', force = false): Promise<ListAppsData> {
  if (!force && pageToken === '') {
    const cached = sheetsCache.get(folderToken);
    if (cached) return cached.data;
  }
  const data = await request<ListAppsData>({ action: 'listSheets', pageSize, pageToken, folderToken, force });
  if (pageToken === '') sheetsCache.set(folderToken, { data, ts: Date.now() });
  return data;
}

/** 强制刷新在线表格列表（绕过缓存重新拉取并更新缓存） */
export async function refreshSheets(folderToken = '', force = true): Promise<ListAppsData> {
  invalidateSheetsCache(folderToken);
  return listSheets(100, '', folderToken, force);
}

export async function createSheet(title: string, folderToken?: string): Promise<App> {
  return request<App>({ action: 'createSheet', appName: title, folderToken });
}

// ====== 文件删除（通用） ======

export async function deleteFile(fileToken: string, fileType: string): Promise<void> {
  return request<void>({ action: 'deleteFile', fileToken, fileType });
}

// ====== 数据表 (Tables) ======

/** 前端 tables 缓存（key = appToken，页面切换不丢失） */
const TABLES_CACHE_TTL = 10 * 60 * 1000; // 10 分钟
const tablesCache = new Map<string, { data: ListTablesData; ts: number }>();

/** 前端 fields 缓存（key = appToken:tableId） */
const FIELDS_CACHE_TTL = 10 * 60 * 1000;
const fieldsCache = new Map<string, { data: Field[]; ts: number }>();

/** 前端全量记录缓存（key = appToken:tableId:sort）
 *  一次拉取整表后缓存在会话内，之后翻页/跳页均为纯前端切片，无需再次请求飞书。 */
const ALL_RECORDS_TTL = 2 * 60 * 1000;
const allRecordsCache = new Map<string, { data: BitableRecord[]; total: number; ts: number }>();

/** 清除全量记录缓存（创建/删除/更新记录后调用）；不传 tableId 则清空该 app 下全部 */
export function invalidateRecordsCache(appToken: string, tableId?: string): void {
  const prefix = tableId ? `${appToken}:${tableId}:` : `${appToken}:`;
  for (const key of allRecordsCache.keys()) {
    if (key.startsWith(prefix)) allRecordsCache.delete(key);
  }
}

/** 清除指定 appToken 相关的 tables + fields + 全量记录缓存 */
export function invalidateTableCache(appToken: string, tableId?: string) {
  tablesCache.delete(appToken);
  if (tableId) {
    fieldsCache.delete(`${appToken}:${tableId}`);
    invalidateRecordsCache(appToken, tableId);
  } else {
    // 模糊删除该 app 下所有 fields / records 缓存
    for (const key of fieldsCache.keys()) {
      if (key.startsWith(`${appToken}:`)) fieldsCache.delete(key);
    }
    for (const key of allRecordsCache.keys()) {
      if (key.startsWith(`${appToken}:`)) allRecordsCache.delete(key);
    }
  }
}

export async function listTables(appToken: string, pageSize = 100, pageToken = '', force = false): Promise<ListTablesData> {
  const cached = tablesCache.get(appToken);
  if (!force && cached && Date.now() - cached.ts < TABLES_CACHE_TTL) {
    return cached.data;
  }
  const data = await request<ListTablesData>({ action: 'listTables', appToken, pageSize, pageToken, force });
  tablesCache.set(appToken, { data, ts: Date.now() });
  return data;
}

export async function createTable(appToken: string, tableName: string, fields: { name: string; type: FieldType }[]): Promise<Table> {
  const result = await request<Table>({ action: 'createTable', appToken, tableName, fields });
  invalidateTableCache(appToken);
  return result;
}

export async function deleteTable(appToken: string, tableId: string): Promise<void> {
  await request<void>({ action: 'deleteTable', appToken, tableId });
  invalidateTableCache(appToken, tableId);
}

export async function listFields(appToken: string, tableId: string, pageSize = 100, pageToken = '', force = false): Promise<Field[]> {
  const key = `${appToken}:${tableId}`;
  const cached = fieldsCache.get(key);
  if (!force && cached && Date.now() - cached.ts < FIELDS_CACHE_TTL) {
    return cached.data;
  }
  const data = await request<Field[]>({ action: 'listFields', appToken, tableId, pageSize, pageToken, force });
  fieldsCache.set(key, { data, ts: Date.now() });
  return data;
}

// ====== 记录 (Records) ======

export async function listRecords(appToken: string, tableId: string, pageSize = 100, pageToken = '', force = false): Promise<ListRecordsData> {
  return request<ListRecordsData>({ action: 'list', appToken, tableId, pageSize, pageToken, force });
}

export async function readRecord(appToken: string, tableId: string, recordId: string, force = false): Promise<BitableRecord> {
  return request<BitableRecord>({ action: 'read', appToken, tableId, recordId, force });
}

export async function createRecord(appToken: string, tableId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
  return request<BitableRecord>({ action: 'create', appToken, tableId, fields });
}

export async function updateRecord(appToken: string, tableId: string, recordId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
  return request<BitableRecord>({ action: 'update', appToken, tableId, recordId, fields });
}

export async function deleteApiRecord(appToken: string, tableId: string, recordId: string): Promise<string> {
  return request<string>({ action: 'delete', appToken, tableId, recordId });
}

/**
 * 快速首屏：仅拉取首页记录（page_token 为空），立即返回，供进入数据表时「秒开」。
 * 命中全量缓存时直接返回整表（零飞书请求）。
 */
export async function loadFirstRecords(
  appToken: string,
  tableId: string,
  pageSize = 500,
): Promise<ListRecordsData> {
  const key = `${appToken}:${tableId}:none`;
  const cached = allRecordsCache.get(key);
  if (cached && Date.now() - cached.ts < ALL_RECORDS_TTL) {
    return { records: cached.data, has_more: false, page_token: '', total: cached.total };
  }
  return listRecords(appToken, tableId, pageSize, '');
}

/** 在途的全量预热任务（key = appToken:tableId:none），供翻页时复用，避免重复拉取 */
const allRecordsLoading = new Map<string, Promise<ListRecordsData>>();

/**
 * 静默预热：从 startToken 继续拉完整表，并写入会话缓存。
 * 任务登记到 allRecordsLoading，翻页若需全量数据可 await 同一任务，避免重复请求。
 */
export async function warmUpAllRecords(
  appToken: string,
  tableId: string,
  pageSize: number,
  startToken: string,
  startRecords: BitableRecord[],
): Promise<ListRecordsData> {
  const key = `${appToken}:${tableId}:none`;
  const cached = allRecordsCache.get(key);
  if (cached && Date.now() - cached.ts < ALL_RECORDS_TTL) {
    return { records: cached.data, has_more: false, page_token: '', total: cached.total };
  }
  const existing = allRecordsLoading.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const all: BitableRecord[] = [...startRecords];
    let token = startToken;
    let total = startRecords.length;
    while (token) {
      const res = await listRecords(appToken, tableId, pageSize, token);
      const recs = res.records || [];
      if (recs.length > 0) all.push(...recs);
      if (res.total) total = res.total;
      if (!res.has_more || !res.page_token) { token = ''; break; }
      token = res.page_token;
    }
    const result: ListRecordsData = {
      records: all,
      has_more: false,
      page_token: '',
      total: total || all.length,
    };
    allRecordsCache.set(key, { data: all, total: result.total, ts: Date.now() });
    return result;
  })();

  allRecordsLoading.set(key, promise);
  try {
    return await promise;
  } finally {
    allRecordsLoading.delete(key);
  }
}

/**
 * 主动全量拉取（首屏预热未完成、用户跳页时兜底调用）。
 * 命中缓存或在途任务时零重复请求；否则先取首页再静默补齐。
 */
export async function loadAllRecords(
  appToken: string,
  tableId: string,
  pageSize = 500,
): Promise<ListRecordsData> {
  const key = `${appToken}:${tableId}:none`;
  const cached = allRecordsCache.get(key);
  if (cached && Date.now() - cached.ts < ALL_RECORDS_TTL) {
    return { records: cached.data, has_more: false, page_token: '', total: cached.total };
  }
  const inFlight = allRecordsLoading.get(key);
  if (inFlight) return inFlight;
  // 从头拉：先取首页，再静默补齐剩余页
  const first = await loadFirstRecords(appToken, tableId, pageSize);
  if (!first.has_more || !first.page_token) {
    const result: ListRecordsData = {
      records: first.records || [],
      has_more: false,
      page_token: '',
      total: first.total || (first.records?.length ?? 0),
    };
    allRecordsCache.set(key, { data: first.records || [], total: result.total, ts: Date.now() });
    return result;
  }
  return warmUpAllRecords(appToken, tableId, pageSize, first.page_token, first.records || []);
}

/**
 * 前端 API 客户端 — 所有数据获取路径的入口
 *
 * 数据流：
 *   前端组件 → lib/api.ts → POST /api/feishu → services/feishu.ts → 飞书开放平台
 *
 * ⚠️ Token 不再存储于 localStorage，改为 HttpOnly Cookie 自动携带：
 *   - OAuth 回调后，服务端将 token 写入 HttpOnly Cookie（JS 不可读，防 XSS）
 *   - 所有 API 请求携带 credentials: 'include'，Cookie 自动发送
 *   - 前端通过 checkAuthStatus() 获知登录状态
 */

import type {
  ApiResponse,
  App,
  FeishuRecord,
  Field,
  ListAppsData,
  ListRecordsData,
  ListTablesData,
  OAuthUrlData,
  Table,
  FieldType,
  UserProfile,
} from '@/types';

import { clientCacheGet, clientCacheSet, clientCacheDel, clientCacheClearAll } from '@/lib/clientCache';

const API_URL = '/api/feishu';

/** 浏览器本地缓存（三层第一层）统一 TTL：30 分钟 */
const LS_TTL = 30 * 60 * 1000;

/**
 * 导出多维表格（或全部数据表）为 Excel/CSV 并触发浏览器下载。
 * 调用 /api/feishu/export 拿到文件流，按响应头中的文件名落地。
 * @param tableId 可选；传入则只导出该数据表，不传则导出全部数据表。
 * @param appName 可选；多维表格名，用于生成「多维表格名_数据表名」文件名。
 */
export async function exportBitable(
  appToken: string,
  format: 'xlsx' | 'csv' = 'xlsx',
  tableId?: string,
  appName?: string,
): Promise<void> {
  const res = await fetch('/api/feishu/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appToken,
      format,
      ...(tableId ? { tableId } : {}),
      ...(appName ? { appName } : {}),
    }),
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
    // 服务端判定登录已失效（飞书 token 无法恢复）：立即清除本地登录态缓存，
    // 避免界面停留在「已登录」并反复发起注定失败的请求；下次 authStatus 校验会引导重新授权。
    if ((result as { needLogin?: boolean }).needLogin) {
      invalidateAuthCache();
    }
    let errMsg = result.error || '请求失败';
    if (result.feishuCode !== undefined) {
      errMsg += ` [飞书 ${result.feishuCode}: ${result.feishuMsg || '未知'}]`;
    }
    throw new Error(errMsg);
  }

  return result.data;
}

// ====== 后台静默刷新（SWR）：命中缓存即返回，再异步从服务端对齐并写回 ======
// 节流：同一 key 15s 内只触发一次，避免频繁导航造成请求风暴。
const bgRefreshAt = new Map<string, number>();
function scheduleBgRefresh(key: string, run: () => Promise<void>): void {
  const last = bgRefreshAt.get(key) ?? 0;
  if (Date.now() - last < 15_000) return;
  bgRefreshAt.set(key, Date.now());
  run().catch(() => { /* 后台刷新失败不影响主流程 */ });
}

// ====== OAuth 授权 ======

/** 登录前访问的受保护路径，存于 sessionStorage，登录后回跳 */
export const POST_LOGIN_REDIRECT_KEY = 'postLoginRedirect';

/** 获取飞书 OAuth 授权 URL（可选 state，用于登录后回跳原页面） */
export async function fetchOAuthUrl(state?: string): Promise<string> {
  const data = await request<OAuthUrlData>({ action: 'getOAuthUrl', ...(state ? { state } : {}) });
  return data.url;
}

// ====== 认证状态：三层缓存（① 浏览器 localStorage → ② 会话内存 → ③ 服务端/ Cookie） ======
// 第一层 localStorage 跨刷新持久，命中即瞬时返回，彻底消除刷新时的网络等待。
const AUTH_LS_KEY = 'authStatus';
const AUTH_LS_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天，与 Cookie 会话寿命一致

// 第二层：会话内内存缓存（瞬时二次命中，避免同一会话内重复解析）
let authStatusCache: { authenticated: boolean; feishuConnected: boolean; ts: number } | null = null;
const AUTH_STATUS_TTL = 2 * 60 * 1000;

// 真实飞书连接状态（取数能力）：由 authStatus 校验结果驱动，全局广播给前端 badge。
// - true：飞书 token 可用，数据接口正常
// - false：飞书 token 已失效（refresh_token 过期等），需重新授权
// - null：尚未校验 / 校验中（乐观视为已连接，避免健康用户每次刷新闪烁）
let feishuConnectedState: boolean | null = null;
const connectionListeners = new Set<(v: boolean | null) => void>();

/** 读取当前真实飞书连接状态 */
export function getFeishuConnection(): boolean | null {
  return feishuConnectedState;
}

/** 订阅真实飞书连接状态变化，返回取消订阅函数 */
export function subscribeFeishuConnection(cb: (v: boolean | null) => void): () => void {
  connectionListeners.add(cb);
  return () => connectionListeners.delete(cb);
}

function setFeishuConnected(v: boolean | null): void {
  if (feishuConnectedState === v) return;
  feishuConnectedState = v;
  connectionListeners.forEach((cb) => cb(v));
}

// 失效代际：每次 invalidateAuthCache（登出/重新授权）自增。
// 用于防止「后台静默对齐」的过期请求在登出后把 L1 重新写成已登录（竞态）。
let authGeneration = 0;

/** 清除认证状态缓存（登出或 OAuth 重新授权后调用） */
export function invalidateAuthCache() {
  authStatusCache = null;
  clientCacheDel(AUTH_LS_KEY);
  authGeneration++;
  // 登出/重新授权/收到 needLogin 时，连接状态明确失效，立即广播给前端 badge
  setFeishuConnected(false);
}

/**
 * 检查认证状态（三级缓存）。
 * ① 浏览器 localStorage 命中 → 瞬时返回，并后台静默与服务端对齐（若会话已失效则更新本地缓存）；
 * ② 会话内存命中 → 直接返回；
 * ③ 均未命中 → 请求服务端校验 Cookie（会话权威来源），结果写回本地与内存。
 */
export async function checkAuthStatus(force = false): Promise<boolean> {
  // 第一层：浏览器本地（跨刷新持久）
  const ls = force ? null : clientCacheGet<{ authenticated: boolean; feishuConnected?: boolean }>(AUTH_LS_KEY);
  // ⚠️ 仅当本地记录为「已登录」才短路返回；绝不因 localStorage 中的
  // false 而直接判定未登录（否则 OAuth 回调后会被陈旧 false 锁死首页）。
  if (ls && ls.authenticated) {
    // 后台静默对齐：不影响本次瞬时返回；若服务端判定会话已失效或飞书连接断开，
    // 则更新本地缓存与全局连接状态，保证后续读取一致。
    // 用代际（gen）防止登出后过期的后台请求把 L1 复活为已登录。
    const gen = authGeneration;
    request<{ authenticated: boolean; feishuConnected: boolean }>({ action: 'authStatus' })
      .then((d) => {
        if (gen === authGeneration) {
          authStatusCache = { authenticated: d.authenticated, feishuConnected: d.feishuConnected, ts: Date.now() };
          // 仅当服务端确认已登录时才落盘；false 不持久化，避免污染首页
          if (d.authenticated) {
            clientCacheSet(AUTH_LS_KEY, { authenticated: true, feishuConnected: d.feishuConnected }, AUTH_LS_TTL);
          }
          // 广播真实连接状态（即使会话仍有效，飞书 token 失效也应让 badge 反映）
          setFeishuConnected(d.feishuConnected);
        }
      })
      .catch(() => { /* 网络异常：保持本地缓存与连接状态不变 */ });
    return ls.authenticated;
  }
  // 第二层：会话内内存
  if (!force && authStatusCache && Date.now() - authStatusCache.ts < AUTH_STATUS_TTL) {
    return authStatusCache.authenticated;
  }
  // 第三层：服务端校验（Cookie / 飞书）
  try {
    const data = await request<{ authenticated: boolean; feishuConnected: boolean }>({ action: 'authStatus' });
    authStatusCache = { authenticated: data.authenticated, feishuConnected: data.feishuConnected, ts: Date.now() };
    // 仅持久化「已登录」态；未登录不写入 localStorage（防止 false 锁死首页）
    if (data.authenticated) {
      clientCacheSet(AUTH_LS_KEY, { authenticated: true, feishuConnected: data.feishuConnected }, AUTH_LS_TTL);
    }
    // 广播真实连接状态
    setFeishuConnected(data.feishuConnected);
    return data.authenticated;
  } catch {
    return false;
  }
}

/**
 * 检查认证状态（OAuth 回调后使用）。
 * 重新授权后强制刷新缓存，读取新写入的 Cookie。
 */
export async function exchangeAuthCode(): Promise<boolean> {
  invalidateAuthCache();
  return checkAuthStatus(true);
}

/** 登出 — 清除 HttpOnly Cookie + 服务端 token，并失效全部本地/内存缓存 */
export async function logout(): Promise<void> {
  await request<{ ok: boolean }>({ action: 'logout' });
  invalidateAppsCache();
  invalidateDocsCache();
  invalidateSheetsCache();
  invalidateAuthCache();
  clientCacheClearAll();
}

// ====== 多维表格应用 (Apps) ======

export interface ListAppsResult {
  data: ListAppsData;
  fromCache: boolean;
}

/** 获取所有多维表格应用列表（三级缓存：① 浏览器本地 → ② 会话内存 → ③ 服务端/飞书） */
export async function listApps(force = false): Promise<ListAppsResult> {
  // 第一层：浏览器本地（跨刷新持久）
  if (!force) {
    const ls = clientCacheGet<ListAppsData>('apps');
    if (ls) {
      // SWR：命中即返回，后台静默对齐并写回
      scheduleBgRefresh('apps', refreshAppsLocal);
      return { data: ls, fromCache: true };
    }
  }
  // 第二层：会话内内存
  if (!force && appsCache) {
    scheduleBgRefresh('apps', refreshAppsLocal);
    return { data: appsCache.data, fromCache: true };
  }
  // 第三层：服务端 / 飞书
  const data = await request<ListAppsData>({ action: 'listApps', force });
  appsCache = { data, timestamp: Date.now() };
  clientCacheSet('apps', data, LS_TTL);
  return { data, fromCache: false };
}

/** 后台静默重新拉取并写回 apps 的本地+内存缓存（SWR 用） */
async function refreshAppsLocal(): Promise<void> {
  const d = await request<ListAppsData>({ action: 'listApps', force: false });
  appsCache = { data: d, timestamp: Date.now() };
  clientCacheSet('apps', d, LS_TTL);
}

/** 强制刷新应用列表（跳过缓存，并绕过服务端缓存重新拉取飞书数据） */
export async function refreshApps(force = true): Promise<ListAppsResult> {
  appsCache = null;
  return listApps(force);
}

/** 创建新的多维表格应用（写入后失效客户端缓存，避免读到旧列表） */
export async function createApp(name: string, folderToken?: string): Promise<App> {
  const result = await request<App>({ action: 'createApp', appName: name, folderToken });
  invalidateAppsCache();
  clientCacheDel('apps');
  return result;
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
    const lsKey = `docs:${folderToken}`;
    // 第一层：浏览器本地（跨刷新持久）
    const ls = clientCacheGet<ListAppsData>(lsKey);
    if (ls) {
      scheduleBgRefresh(lsKey, () => refreshDocsLocal(folderToken, pageSize));
      return ls;
    }
    // 第二层：会话内内存
    const cached = docsCache.get(folderToken);
    if (cached) {
      scheduleBgRefresh(lsKey, () => refreshDocsLocal(folderToken, pageSize));
      return cached.data;
    }
  }
  // 第三层：服务端 / 飞书
  const data = await request<ListAppsData>({ action: 'listDocs', pageSize, pageToken, folderToken, force });
  if (pageToken === '') {
    docsCache.set(folderToken, { data, ts: Date.now() });
    clientCacheSet(`docs:${folderToken}`, data, LS_TTL);
  }
  return data;
}

/** 后台静默重新拉取并写回某 folder 的 docs 本地+内存缓存（SWR 用） */
async function refreshDocsLocal(folderToken: string, pageSize: number): Promise<void> {
  const d = await request<ListAppsData>({ action: 'listDocs', pageSize, pageToken: '', folderToken, force: false });
  docsCache.set(folderToken, { data: d, ts: Date.now() });
  clientCacheSet(`docs:${folderToken}`, d, LS_TTL);
}

/** 强制刷新云文档列表（绕过缓存重新拉取并更新缓存） */
export async function refreshDocs(folderToken = '', force = true): Promise<ListAppsData> {
  invalidateDocsCache(folderToken);
  return listDocs(100, '', folderToken, force);
}

/** 创建云文档（写入后失效客户端缓存） */
export async function createDoc(title: string, folderToken?: string): Promise<App> {
  const result = await request<App>({ action: 'createDoc', appName: title, folderToken });
  invalidateDocsCache(folderToken);
  clientCacheDel(`docs:${folderToken}`);
  return result;
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
    const lsKey = `sheets:${folderToken}`;
    // 第一层：浏览器本地（跨刷新持久）
    const ls = clientCacheGet<ListAppsData>(lsKey);
    if (ls) {
      scheduleBgRefresh(lsKey, () => refreshSheetsLocal(folderToken, pageSize));
      return ls;
    }
    // 第二层：会话内内存
    const cached = sheetsCache.get(folderToken);
    if (cached) {
      scheduleBgRefresh(lsKey, () => refreshSheetsLocal(folderToken, pageSize));
      return cached.data;
    }
  }
  // 第三层：服务端 / 飞书
  const data = await request<ListAppsData>({ action: 'listSheets', pageSize, pageToken, folderToken, force });
  if (pageToken === '') {
    sheetsCache.set(folderToken, { data, ts: Date.now() });
    clientCacheSet(`sheets:${folderToken}`, data, LS_TTL);
  }
  return data;
}

/** 后台静默重新拉取并写回某 folder 的 sheets 本地+内存缓存（SWR 用） */
async function refreshSheetsLocal(folderToken: string, pageSize: number): Promise<void> {
  const d = await request<ListAppsData>({ action: 'listSheets', pageSize, pageToken: '', folderToken, force: false });
  sheetsCache.set(folderToken, { data: d, ts: Date.now() });
  clientCacheSet(`sheets:${folderToken}`, d, LS_TTL);
}

/** 强制刷新在线表格列表（绕过缓存重新拉取并更新缓存） */
export async function refreshSheets(folderToken = '', force = true): Promise<ListAppsData> {
  invalidateSheetsCache(folderToken);
  return listSheets(100, '', folderToken, force);
}

/** 创建在线表格（写入后失效客户端缓存） */
export async function createSheet(title: string, folderToken?: string): Promise<App> {
  const result = await request<App>({ action: 'createSheet', appName: title, folderToken });
  invalidateSheetsCache(folderToken);
  clientCacheDel(`sheets:${folderToken}`);
  return result;
}

// ====== 文件删除（通用） ======

export async function deleteFile(fileToken: string, fileType: string): Promise<void> {
  return request<void>({ action: 'deleteFile', fileToken, fileType });
}

// ====== 单用户完整名片（卡片懒加载） ======

/** 打开用户名片时按需拉取完整资料（email/mobile/description 等） */
export async function getUserProfile(openId: string): Promise<UserProfile> {
  return request<UserProfile>({ action: 'getUserProfile', openId });
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
const allRecordsCache = new Map<string, { data: FeishuRecord[]; total: number; ts: number }>();

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
  const lsKey = `tables:${appToken}`;
  const cached = tablesCache.get(appToken);
  if (!force && cached && Date.now() - cached.ts < TABLES_CACHE_TTL) {
    scheduleBgRefresh(lsKey, () => refreshTablesLocal(appToken, pageSize));
    return cached.data;
  }
  if (!force && pageToken === '') {
    // 第一层：浏览器本地（跨刷新持久）
    const ls = clientCacheGet<ListTablesData>(lsKey);
    if (ls) {
      tablesCache.set(appToken, { data: ls, ts: Date.now() });
      scheduleBgRefresh(lsKey, () => refreshTablesLocal(appToken, pageSize));
      return ls;
    }
  }
  // 第三层：服务端 / 飞书
  const data = await request<ListTablesData>({ action: 'listTables', appToken, pageSize, pageToken, force });
  tablesCache.set(appToken, { data, ts: Date.now() });
  clientCacheSet(lsKey, data, TABLES_CACHE_TTL);
  return data;
}

/** 后台静默重新拉取并写回 tables 本地+内存缓存（SWR 用） */
async function refreshTablesLocal(appToken: string, pageSize: number): Promise<void> {
  const d = await request<ListTablesData>({ action: 'listTables', appToken, pageSize, pageToken: '', force: false });
  tablesCache.set(appToken, { data: d, ts: Date.now() });
  clientCacheSet(`tables:${appToken}`, d, TABLES_CACHE_TTL);
}

export async function createTable(appToken: string, tableName: string, fields: { name: string; type: FieldType }[]): Promise<Table> {
  const result = await request<Table>({ action: 'createTable', appToken, tableName, fields });
  invalidateTableCache(appToken);
  clientCacheDel(`tables:${appToken}`);
  return result;
}

export async function deleteTable(appToken: string, tableId: string): Promise<void> {
  await request<void>({ action: 'deleteTable', appToken, tableId });
  invalidateTableCache(appToken, tableId);
  clientCacheDel(`tables:${appToken}`);
  clientCacheDel(`fields:${appToken}:${tableId}`);
}

export async function listFields(appToken: string, tableId: string, pageSize = 100, pageToken = '', force = false): Promise<Field[]> {
  const key = `${appToken}:${tableId}`;
  const lsKey = `fields:${key}`;
  const cached = fieldsCache.get(key);
  if (!force && cached && Date.now() - cached.ts < FIELDS_CACHE_TTL) {
    scheduleBgRefresh(lsKey, () => refreshFieldsLocal(appToken, tableId, pageSize));
    return cached.data;
  }
  if (!force && pageToken === '') {
    // 第一层：浏览器本地（跨刷新持久）
    const ls = clientCacheGet<Field[]>(lsKey);
    if (ls) {
      fieldsCache.set(key, { data: ls, ts: Date.now() });
      scheduleBgRefresh(lsKey, () => refreshFieldsLocal(appToken, tableId, pageSize));
      return ls;
    }
  }
  // 第三层：服务端 / 飞书
  const data = await request<Field[]>({ action: 'listFields', appToken, tableId, pageSize, pageToken, force });
  fieldsCache.set(key, { data, ts: Date.now() });
  clientCacheSet(lsKey, data, FIELDS_CACHE_TTL);
  return data;
}

/** 后台静默重新拉取并写回 fields 本地+内存缓存（SWR 用） */
async function refreshFieldsLocal(appToken: string, tableId: string, pageSize: number): Promise<void> {
  const key = `${appToken}:${tableId}`;
  const d = await request<Field[]>({ action: 'listFields', appToken, tableId, pageSize, pageToken: '', force: false });
  fieldsCache.set(key, { data: d, ts: Date.now() });
  clientCacheSet(`fields:${key}`, d, FIELDS_CACHE_TTL);
}

// ====== 记录 (Records) ======

export async function listRecords(appToken: string, tableId: string, pageSize = 100, pageToken = '', force = false): Promise<ListRecordsData> {
  return request<ListRecordsData>({ action: 'list', appToken, tableId, pageSize, pageToken, force });
}

export async function readRecord(appToken: string, tableId: string, recordId: string, force = false): Promise<FeishuRecord> {
  return request<FeishuRecord>({ action: 'read', appToken, tableId, recordId, force });
}

export async function createRecord(appToken: string, tableId: string, fields: Record<string, unknown>): Promise<FeishuRecord> {
  const result = await request<FeishuRecord>({ action: 'create', appToken, tableId, fields });
  invalidateRecordsCache(appToken, tableId); // 失效会话内全量记录缓存，下次读取重新拉
  return result;
}

export async function updateRecord(appToken: string, tableId: string, recordId: string, fields: Record<string, unknown>): Promise<FeishuRecord> {
  const result = await request<FeishuRecord>({ action: 'update', appToken, tableId, recordId, fields });
  invalidateRecordsCache(appToken, tableId);
  return result;
}

export async function deleteApiRecord(appToken: string, tableId: string, recordId: string): Promise<string> {
  const result = await request<string>({ action: 'delete', appToken, tableId, recordId });
  invalidateRecordsCache(appToken, tableId);
  return result;
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
  startRecords: FeishuRecord[],
): Promise<ListRecordsData> {
  const key = `${appToken}:${tableId}:none`;
  const cached = allRecordsCache.get(key);
  if (cached && Date.now() - cached.ts < ALL_RECORDS_TTL) {
    return { records: cached.data, has_more: false, page_token: '', total: cached.total };
  }
  const existing = allRecordsLoading.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const all: FeishuRecord[] = [...startRecords];
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

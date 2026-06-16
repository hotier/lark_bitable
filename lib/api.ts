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

// ====== 模块级缓存：避免页面切换时重复请求 ======
const APPS_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

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

/** 获取所有多维表格应用列表（带模块级缓存） */
export async function listApps(): Promise<ListAppsResult> {
  if (appsCache && Date.now() - appsCache.timestamp < APPS_CACHE_TTL) {
    return { data: appsCache.data, fromCache: true };
  }
  const data = await request<ListAppsData>({ action: 'listApps' });
  appsCache = { data, timestamp: Date.now() };
  return { data, fromCache: false };
}

/** 强制刷新应用列表（跳过缓存） */
export async function refreshApps(): Promise<ListAppsResult> {
  appsCache = null;
  return listApps();
}

/** 创建新的多维表格应用 */
export async function createApp(name: string, folderToken?: string): Promise<App> {
  return request<App>({ action: 'createApp', appName: name, folderToken });
}

// ====== 云文档 (Docx) ======

export async function listDocs(pageSize = 100, pageToken = '', folderToken = ''): Promise<ListAppsData> {
  return request<ListAppsData>({ action: 'listDocs', pageSize, pageToken, folderToken });
}

export async function createDoc(title: string, folderToken?: string): Promise<App> {
  return request<App>({ action: 'createDoc', appName: title, folderToken });
}

// ====== 在线表格 (Sheet) ======

export async function listSheets(pageSize = 100, pageToken = '', folderToken = ''): Promise<ListAppsData> {
  return request<ListAppsData>({ action: 'listSheets', pageSize, pageToken, folderToken });
}

export async function createSheet(title: string, folderToken?: string): Promise<App> {
  return request<App>({ action: 'createSheet', appName: title, folderToken });
}

// ====== 文件删除（通用） ======

export async function deleteFile(fileToken: string, fileType: string): Promise<void> {
  return request<void>({ action: 'deleteFile', fileToken, fileType });
}

// ====== 数据表 (Tables) ======

export async function listTables(appToken: string, pageSize = 100, pageToken = ''): Promise<ListTablesData> {
  return request<ListTablesData>({ action: 'listTables', appToken, pageSize, pageToken });
}

export async function createTable(appToken: string, tableName: string, fields: { name: string; type: FieldType }[]): Promise<Table> {
  return request<Table>({ action: 'createTable', appToken, tableName, fields });
}

export async function deleteTable(appToken: string, tableId: string): Promise<void> {
  return request<void>({ action: 'deleteTable', appToken, tableId });
}

export async function listFields(appToken: string, tableId: string, pageSize = 100, pageToken = ''): Promise<Field[]> {
  return request<Field[]>({ action: 'listFields', appToken, tableId, pageSize, pageToken });
}

// ====== 记录 (Records) ======

export async function listRecords(appToken: string, tableId: string, pageSize = 100, pageToken = ''): Promise<ListRecordsData> {
  return request<ListRecordsData>({ action: 'list', appToken, tableId, pageSize, pageToken });
}

export async function readRecord(appToken: string, tableId: string, recordId: string): Promise<BitableRecord> {
  return request<BitableRecord>({ action: 'read', appToken, tableId, recordId });
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

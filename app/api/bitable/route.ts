import { NextResponse } from 'next/server';
import { bitableService } from '@/services/feishu-bitable';
import { withCache, cacheKey, cacheDelByPrefix, DEFAULT_TTL, RECORD_TTL } from '@/lib/cache';

/** Cookie 名称常量 */
const TOKEN_COOKIE = 'feishu_token';
const EXPIRE_COOKIE = 'feishu_token_expire';

/** 从 request cookies 中读取 token 信息 */
function getTokenFromCookies(request: Request): { accessToken: string | null; expire: number } {
  const token = request.cookies.get(TOKEN_COOKIE)?.value || null;
  const expireStr = request.cookies.get(EXPIRE_COOKIE)?.value || '0';
  const expire = parseInt(expireStr) || 0;
  return { accessToken: token, expire };
}

/** 清除认证 cookies */
function clearAuthCookies(response: NextResponse): void {
  response.cookies.delete(TOKEN_COOKIE);
  response.cookies.delete(EXPIRE_COOKIE);
}

/**
 * POST /api/bitable — 统一的飞书 API 代理入口
 * 所有前端请求通过此路由转发到飞书开放平台
 * Token 通过 HttpOnly Cookie 传递，前端 JS 不可访问（防 XSS）
 */
export async function POST(request: Request) {
  let action = '';
  let appToken = '';
  let tableId = '';

  try {
    const body = await request.json();
    ({
      action,
      appToken,
      tableId,
    } = body);
    const {
      recordId,
      fields,
      pageSize,
      pageToken,
      tableName,
      folderToken,
      appName,
    } = body;

    if (!action) {
      return NextResponse.json(
        { error: '缺少必要参数: action' },
        { status: 400 }
      );
    }

    // ====== 认证相关操作（无需 token） ======

    /* 获取飞书 OAuth URL（自动从请求头推导 redirect_uri，无需手动配置环境变量） */
    if (action === 'getOAuthUrl') {
      const proto = request.headers.get('x-forwarded-proto') || 'http';
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
      const redirectUri = `${proto}://${host}/api/bitable/oauth/callback`;
      return NextResponse.json({ success: true, data: { url: bitableService.getOAuthUrl(undefined, redirectUri) } });
    }

    /* 检查认证状态（exchangeAuthCode 现等同于 authStatus，向后兼容） */
    if (action === 'exchangeAuthCode' || action === 'authStatus') {
      const { accessToken, expire } = getTokenFromCookies(request);
      const valid = accessToken !== null && Date.now() < expire;
      // 将 token 回填到 bitableService 实例（供 webhook 等场景使用）
      if (valid && accessToken) {
        bitableService.setUserAccessToken(accessToken, expire);
      }
      return NextResponse.json({ success: true, data: { authenticated: valid } });
    }

    /* 登出 */
    if (action === 'logout') {
      bitableService.clearUserAccessToken();
      const response = NextResponse.json({ success: true, data: { ok: true } });
      clearAuthCookies(response);
      return response;
    }

    // ====== 以下操作需要认证 ======

    // 从 HttpOnly Cookie 读取 token
    const { accessToken: cookieToken, expire: cookieExpire } = getTokenFromCookies(request);
    const isAuth = cookieToken !== null && Date.now() < cookieExpire;

    // 回填 token 到服务实例（供 webhook 等场景使用）
    if (isAuth && cookieToken) {
      bitableService.setUserAccessToken(cookieToken, cookieExpire);
    }

    const uaToken: string | null = isAuth ? cookieToken : null;

    let result;

    switch (action) {
      // ====== 多维表格 ======
      case 'listApps':
        result = await withCache(
          cacheKey('apps', pageToken || '0', folderToken || ''),
          () => bitableService.listApps(pageSize, pageToken, folderToken, uaToken),
        );
        break;

      case 'createApp':
        if (!appName) throw new Error('缺少参数: appName');
        result = await bitableService.createApp(appName, folderToken, uaToken);
        cacheDelByPrefix('apps:');
        break;

      // ====== 云文档 ======
      case 'listDocs':
        result = await withCache(
          cacheKey('docs', pageToken || '0', folderToken || ''),
          () => bitableService.listDocs(pageSize, pageToken, folderToken, uaToken),
        );
        break;

      case 'createDoc':
        if (!appName) throw new Error('缺少参数: appName');
        result = await bitableService.createDocx(appName, folderToken, uaToken);
        cacheDelByPrefix('docs:');
        break;

      // ====== 电子表格 ======
      case 'listSheets':
        result = await withCache(
          cacheKey('sheets', pageToken || '0', folderToken || ''),
          () => bitableService.listSheets(pageSize, pageToken, folderToken, uaToken),
        );
        break;

      case 'createSheet':
        if (!appName) throw new Error('缺少参数: appName');
        result = await bitableService.createSheet(appName, folderToken, uaToken);
        cacheDelByPrefix('sheets:');
        break;

      // ====== 文件删除 ======
      case 'deleteFile': {
        const { fileToken, fileType: fType } = body;
        if (!fileToken || !fType) throw new Error('缺少参数: fileToken, fileType');
        await bitableService.deleteFile(fileToken, fType, uaToken);
        cacheDelByPrefix('apps:');
        cacheDelByPrefix('docs:');
        cacheDelByPrefix('sheets:');
        result = { ok: true };
        break;
      }

      // ====== 数据表 ======
      case 'listTables':
        if (!appToken) throw new Error('缺少参数: appToken');
        result = await withCache(
          cacheKey('tables', appToken, pageToken || '0'),
          () => bitableService.listTables(appToken, pageSize, pageToken, uaToken),
        );
        break;

      case 'createTable':
        if (!appToken || !tableName || !fields) throw new Error('缺少参数: appToken, tableName, fields');
        result = await bitableService.createTable(appToken, tableName, fields, uaToken);
        cacheDelByPrefix(`tables:${appToken}`);
        break;

      case 'deleteTable':
        if (!appToken || !tableId) throw new Error('缺少参数: appToken, tableId');
        result = await bitableService.deleteTable(appToken, tableId, uaToken);
        cacheDelByPrefix(`tables:${appToken}`);
        cacheDelByPrefix(`fields:${appToken}:${tableId}`);
        cacheDelByPrefix(`records:${appToken}:${tableId}`);
        break;

      case 'listFields':
        if (!appToken || !tableId) throw new Error('缺少参数: appToken, tableId');
        result = await withCache(
          cacheKey('fields', appToken, tableId),
          () => bitableService.listFields(appToken, tableId, pageSize, pageToken, uaToken),
        );
        break;

      // ====== 记录 CRUD ======
      case 'list':
        if (!appToken || !tableId) throw new Error('缺少参数: appToken, tableId');
        result = await withCache(
          cacheKey('records', appToken, tableId, pageToken || '0'),
          () => bitableService.listRecords(appToken, tableId, pageSize, pageToken, uaToken),
          RECORD_TTL,
        );
        break;

      case 'read':
        if (!appToken || !tableId || !recordId) throw new Error('缺少参数: appToken, tableId, recordId');
        result = await withCache(
          cacheKey('record', appToken, tableId, recordId),
          () => bitableService.readRecord(appToken, tableId, recordId, uaToken),
          RECORD_TTL,
        );
        break;

      case 'create':
        if (!appToken || !tableId || !fields) throw new Error('缺少参数: appToken, tableId, fields');
        console.log(`[create] appToken=${appToken} tableId=${tableId} fields (by name)=`, JSON.stringify(fields));
        result = await bitableService.createRecord(appToken, tableId, fields, uaToken);
        cacheDelByPrefix(`records:${appToken}:${tableId}`);
        break;

      case 'update':
        if (!appToken || !tableId || !recordId || !fields)
          throw new Error('缺少参数: appToken, tableId, recordId, fields');
        result = await bitableService.updateRecord(appToken, tableId, recordId, fields, uaToken);
        cacheDelByPrefix(`records:${appToken}:${tableId}`);
        cacheDel(`record:${appToken}:${tableId}:${recordId}`);
        break;

      case 'delete':
        if (!appToken || !tableId || !recordId) throw new Error('缺少参数: appToken, tableId, recordId');
        result = await bitableService.deleteRecord(appToken, tableId, recordId, uaToken);
        cacheDelByPrefix(`records:${appToken}:${tableId}`);
        cacheDel(`record:${appToken}:${tableId}:${recordId}`);
        break;

      default:
        return NextResponse.json(
          { error: `不支持的操作类型: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : '未知错误';
    const feishuCode: number | undefined = error?.feishuCode ?? error?.response?.data?.code;
    const feishuMsg: string | undefined = error?.feishuMsg ?? error?.response?.data?.msg;
    console.error(
      `[API /api/bitable] action=${action} | appToken=${appToken} | tableId=${tableId}`,
      feishuCode !== undefined ? `| feishuCode=${feishuCode} feishuMsg=${feishuMsg}` : '',
      '\n  Error:',
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        success: false,
        error: message,
        feishuCode,
        feishuMsg,
      },
      { status: 500 }
    );
  }
}

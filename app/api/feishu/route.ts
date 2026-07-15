import { NextRequest, NextResponse } from 'next/server';
import { feishuService } from '@/services/feishu';
import { withCache, cacheKey, cacheDel, cacheDelByPrefix, TTL } from '@/lib/cache';
import { ensureMigrations } from '@/lib/db';
import { logger } from '@/lib/logger';
import { validateApiBody } from '@/lib/validation';
import { okResponse, errorResponse } from '@/lib/api-response';
import { TOKEN_COOKIE, EXPIRE_COOKIE, SESSION_MAX_AGE } from '@/lib/auth-constants';

/** 从 request cookies 中读取 token 信息 */
function getTokenFromCookies(request: NextRequest): { accessToken: string | null; expire: number } {
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
 * POST /api/feishu — 统一的飞书 API 代理入口
 * 所有前端请求通过此路由转发到飞书开放平台
 * Token 通过 HttpOnly Cookie 传递，前端 JS 不可访问（防 XSS）
 */
export async function POST(request: NextRequest) {
  // 惰性迁移：首次调用时自动建表（失败不阻塞业务）
  await ensureMigrations();

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
      force,
      openId,
    } = body;
    // 强制同步：true 时绕过服务端缓存，直接重新拉取飞书数据
    const forceRefresh = force === true || force === 'true';

    const bodyError = validateApiBody(body);
    if (bodyError) {
      return NextResponse.json({ success: false, error: bodyError }, { status: 400 });
    }

    // ====== 认证相关操作（无需 token） ======

    /* 获取飞书 OAuth URL（自动从请求头推导 redirect_uri，无需手动配置环境变量） */
    if (action === 'getOAuthUrl') {
      const proto = request.headers.get('x-forwarded-proto') || 'http';
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
      const redirectUri = `${proto}://${host}/api/auth/callback`;
      // 透传登录前访问路径作为 state，回调时原样返回用于回跳
      const state = typeof body.state === 'string' && body.state ? body.state : undefined;
      return okResponse({ url: feishuService.getOAuthUrl(state, redirectUri) });
    }

    /* 检查认证状态（exchangeAuthCode 现等同于 authStatus，向后兼容） */
    if (action === 'exchangeAuthCode' || action === 'authStatus') {
      const { accessToken, expire } = getTokenFromCookies(request);
      // 会话（Cookie）为登录权威来源：存在且未过期即视为已登录。
      // ensureAuth() 仅用于在判定前「尽力」恢复/刷新服务端飞书 token
      // （冷启动从 DB 兜底），其失败（如 DB 不可用）只代表暂时无法恢复
      // 飞书 token，不应据此把有效会话判为未登录。
      const sessionValid = accessToken !== null && Date.now() < expire;
      if (sessionValid) {
        feishuService.ensureAuth().catch(() => {
          /* 忽略：DB 不可达时仅暂时无法恢复飞书 token，不影响会话有效性 */
        });
      }
      return NextResponse.json({ success: true, data: { authenticated: sessionValid } });
    }

    /* 登出 */
    if (action === 'logout') {
      feishuService.clearUserAccessToken();
      const response = okResponse({ ok: true });
      clearAuthCookies(response);
      return response;
    }

    // ====== 以下操作需要认证 ======

    // 会话级登录态：只看 Cookie 是否存在且未过期（与飞书 token 寿命解耦）
    const { accessToken: cookieToken, expire: cookieExpire } = getTokenFromCookies(request);
    const sessionValid = cookieToken !== null && Date.now() < cookieExpire;

    if (!sessionValid) {
      return NextResponse.json(
        { success: false, error: '未登录或会话已过期', needLogin: true },
        { status: 401 },
      );
    }

    // 让服务端用 DB / refresh_token 自动维护有效飞书 token，
    // 不再用 Cookie 里可能已过期的 access_token 回填。
    const authed = await feishuService.ensureAuth();
    if (!authed) {
      return errorResponse('登录已失效，请重新授权', 401, { needLogin: true });
    }

    const uaToken: string | null = null; // 统一走服务端托管 token

    let result;

    switch (action) {
      // ====== 多维表格 ======
      case 'listApps':
        if (forceRefresh) cacheDel(cacheKey('apps', pageToken || '0', folderToken || ''));
        result = await withCache(
          cacheKey('apps', pageToken || '0', folderToken || ''),
          () => feishuService.listApps(pageSize, pageToken, folderToken, uaToken),
          TTL.APPS,
        );
        break;

      case 'createApp':
        if (!appName) throw new Error('缺少参数: appName');
        result = await feishuService.createApp(appName, folderToken, uaToken);
        cacheDelByPrefix('apps:');
        break;

      // ====== 单用户完整名片（卡片懒加载用） ======
      case 'getUserProfile': {
        if (!openId) throw new Error('缺少参数: openId');
        result = await feishuService.getUserProfileById(openId);
        break;
      }

      // ====== 云文档 ======
      case 'listDocs':
        if (forceRefresh) cacheDel(cacheKey('docs', pageToken || '0', folderToken || ''));
        result = await withCache(
          cacheKey('docs', pageToken || '0', folderToken || ''),
          () => feishuService.listDocs(pageSize, pageToken, folderToken, uaToken),
          TTL.APPS,
        );
        break;

      case 'createDoc':
        if (!appName) throw new Error('缺少参数: appName');
        result = await feishuService.createDocx(appName, folderToken, uaToken);
        cacheDelByPrefix('docs:');
        break;

      // ====== 电子表格 ======
      case 'listSheets':
        if (forceRefresh) cacheDel(cacheKey('sheets', pageToken || '0', folderToken || ''));
        result = await withCache(
          cacheKey('sheets', pageToken || '0', folderToken || ''),
          () => feishuService.listSheets(pageSize, pageToken, folderToken, uaToken),
          TTL.APPS,
        );
        break;

      case 'createSheet':
        if (!appName) throw new Error('缺少参数: appName');
        result = await feishuService.createSheet(appName, folderToken, uaToken);
        cacheDelByPrefix('sheets:');
        break;

      // ====== 文件删除 ======
      case 'deleteFile': {
        const { fileToken, fileType: fType } = body;
        if (!fileToken || !fType) throw new Error('缺少参数: fileToken, fileType');
        await feishuService.deleteFile(fileToken, fType, uaToken);
        // 分块失效：仅清除被删除文件所属模块的缓存，避免误伤其他模块导致重新拉取
        {
          const t = String(fType).toLowerCase();
          if (t === 'bitable') cacheDelByPrefix('apps:');
          else if (t === 'sheet') cacheDelByPrefix('sheets:');
          else if (t === 'doc' || t === 'docx') cacheDelByPrefix('docs:');
          else {
            // 未知类型才回退到全量失效，保证数据一致性
            cacheDelByPrefix('apps:');
            cacheDelByPrefix('docs:');
            cacheDelByPrefix('sheets:');
          }
        }
        result = { ok: true };
        break;
      }

      // ====== 数据表 ======
      case 'listTables':
        if (!appToken) throw new Error('缺少参数: appToken');
        if (forceRefresh) cacheDel(cacheKey('tables', appToken, pageToken || '0'));
        result = await withCache(
          cacheKey('tables', appToken, pageToken || '0'),
          () => feishuService.listTables(appToken, pageSize, pageToken, uaToken),
          TTL.TABLES,
        );
        break;

      case 'createTable':
        if (!appToken || !tableName || !fields) throw new Error('缺少参数: appToken, tableName, fields');
        result = await feishuService.createTable(appToken, tableName, fields, uaToken);
        cacheDelByPrefix(`tables:${appToken}`);
        break;

      case 'deleteTable':
        if (!appToken || !tableId) throw new Error('缺少参数: appToken, tableId');
        result = await feishuService.deleteTable(appToken, tableId, uaToken);
        cacheDelByPrefix(`tables:${appToken}`);
        cacheDelByPrefix(`fields:${appToken}:${tableId}`);
        cacheDelByPrefix(`records:${appToken}:${tableId}`);
        break;

      case 'listFields':
        if (!appToken || !tableId) throw new Error('缺少参数: appToken, tableId');
        if (forceRefresh) cacheDel(cacheKey('fields', appToken, tableId));
        result = await withCache(
          cacheKey('fields', appToken, tableId),
          () => feishuService.listFields(appToken, tableId, pageSize, pageToken, uaToken),
          TTL.FIELDS,
        );
        break;

      // ====== 记录 CRUD ======
      // 注意：记录的缓存（list/read）与写后失效已下沉到 feishuService，
      // 由多维表格页面与工作流执行器共用 lib/cache 的同一套缓存。
      case 'list':
        if (!appToken || !tableId) throw new Error('缺少参数: appToken, tableId');
        result = await feishuService.listRecords(appToken, tableId, pageSize, pageToken, uaToken, forceRefresh);
        break;

      case 'read':
        if (!appToken || !tableId || !recordId) throw new Error('缺少参数: appToken, tableId, recordId');
        result = await feishuService.readRecord(appToken, tableId, recordId, uaToken, forceRefresh);
        break;

      case 'create':
        if (!appToken || !tableId || !fields) throw new Error('缺少参数: appToken, tableId, fields');
        logger.debug(`[create] appToken=${appToken} tableId=${tableId} fields (by name)=`, JSON.stringify(fields));
        result = await feishuService.createRecord(appToken, tableId, fields, uaToken);
        break;

      case 'update':
        if (!appToken || !tableId || !recordId || !fields)
          throw new Error('缺少参数: appToken, tableId, recordId, fields');
        result = await feishuService.updateRecord(appToken, tableId, recordId, fields, uaToken);
        break;

      case 'delete':
        if (!appToken || !tableId || !recordId) throw new Error('缺少参数: appToken, tableId, recordId');
        result = await feishuService.deleteRecord(appToken, tableId, recordId, uaToken);
        break;

      default:
        return NextResponse.json(
          { error: `不支持的操作类型: ${action}` },
          { status: 400 }
        );
    }

    const response = okResponse(result);
    // 滑动续期：活跃用户每次成功请求都刷新会话到期时间（直至 refresh_token 窗口）
    response.cookies.set(EXPIRE_COOKIE, String(Date.now() + SESSION_MAX_AGE * 1000), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const err = error as {
      feishuCode?: number;
      feishuMsg?: string;
      response?: { data?: { code?: number; msg?: string } };
    };
    const feishuCode: number | undefined = err.feishuCode ?? err.response?.data?.code;
    const feishuMsg: string | undefined = err.feishuMsg ?? err.response?.data?.msg;
    logger.error(
      `[API /api/feishu] action=${action} | appToken=${appToken} | tableId=${tableId}`,
      feishuCode !== undefined ? `| feishuCode=${feishuCode} feishuMsg=${feishuMsg}` : '',
      '\n  Error:',
      message,
    );
    return errorResponse(message, 500, { feishuCode, feishuMsg });
  }
}

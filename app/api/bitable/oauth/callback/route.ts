import { NextResponse } from 'next/server';
import { bitableService } from '@/services/feishu-bitable';
import { logger } from '@/lib/logger';

/** Cookie 名称常量（与 api/bitable/route.ts 保持一致） */
const TOKEN_COOKIE = 'feishu_token';
const EXPIRE_COOKIE = 'feishu_token_expire';

/**
 * OAuth 回调 → 直接用飞书 code 换取 token → 写入 HttpOnly Cookie → 重定向到首页
 *
 * 不再通过一次性 auth_code + 内存 Map 中转，避免 HMR 热更新导致内存丢失的问题。
 * token 始终只存在于 HttpOnly Cookie 中，安全性不变。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // 用户拒绝授权 / 飞书返回错误：重定向回首页并带上标识，
    // 由前端展示友好提示（而非直接抛出 400 JSON 错误页）。
    if (!code) {
      const redirect = new URL('/', request.url);
      const reason = error === 'access_denied' ? 'denied' : 'error';
      redirect.searchParams.set('auth', reason);
      if (errorDescription) redirect.searchParams.set('msg', errorDescription);
      return NextResponse.redirect(redirect);
    }

    // 1. 用飞书返回的 code 换取 user_access_token（飞书 token 仅存服务端，不进入 Cookie 语义）
    const result = await bitableService.getUserAccessToken(code);

    // 2. 重定向到首页，同时设置 HttpOnly Cookie
    const response = NextResponse.redirect(new URL('/', request.url));

    // 会话寿命与飞书 access_token 解耦，跟随 refresh_token 有效期（最长 30 天）
    const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 秒
    const expireMs = Date.now() + SESSION_MAX_AGE * 1000;
    const maxAge = SESSION_MAX_AGE;
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge,
    };

    // Cookie 仅作为「已登录」会话标记；飞书 token 由服务端 ensureAuth() 托管并自动刷新
    response.cookies.set(TOKEN_COOKIE, result.accessToken, cookieOpts);
    response.cookies.set(EXPIRE_COOKIE, String(expireMs), cookieOpts);

    return response;
  } catch (error) {
    logger.error('OAuth Callback Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}

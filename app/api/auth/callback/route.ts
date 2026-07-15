import { NextResponse } from 'next/server';
import { feishuService } from '@/services/feishu';
import { TOKEN_COOKIE, EXPIRE_COOKIE, SESSION_MAX_AGE } from '@/lib/auth-constants';
import { logger } from '@/lib/logger';

/**
 * 统一 OAuth 回调 — 飞书授权后回跳入口（多维表格、云文档、在线表格共用）
 *
 * 用飞书 code 换取 token → 写入 HttpOnly Cookie → 重定向到首页
 * token 始终只存在于 HttpOnly Cookie 中，前端 JS 不可访问（防 XSS）。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // 用户拒绝授权 / 飞书返回错误
    if (!code) {
      const redirect = new URL('', request.url);
      const reason = error === 'access_denied' ? 'denied' : 'error';
      redirect.searchParams.set('auth', reason);
      if (errorDescription) redirect.searchParams.set('msg', errorDescription);
      return NextResponse.redirect(redirect);
    }

    // 1. 用飞书 code 换取 user_access_token（redirect_uri 必须与授权时一致）
    const callbackUrl = new URL(request.url);
    const redirectUri = `${callbackUrl.origin}${callbackUrl.pathname}`;
    const result = await feishuService.getUserAccessToken(code, redirectUri);

    // 2. 重定向：优先回跳登录前访问的页面（state 携带），否则回首页。
    //    仅允许同源相对路径，禁止 `//` 协议相对或完整 URL，防止开放重定向。
    const postLogin = searchParams.get('state');
    const safeTarget =
      postLogin && postLogin.startsWith('/') && !postLogin.startsWith('//')
        ? postLogin
        : '/';
    const response = NextResponse.redirect(new URL(safeTarget, request.url));

    const expireMs = Date.now() + SESSION_MAX_AGE * 1000;
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: SESSION_MAX_AGE,
    };

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

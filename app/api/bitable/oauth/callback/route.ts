import { NextResponse } from 'next/server';
import { bitableService } from '@/services/feishu-bitable';

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

    if (!code) {
      return NextResponse.json({ error: '缺少 code 参数' }, { status: 400 });
    }

    // 1. 用飞书返回的 code 换取 user_access_token
    const result = await bitableService.getUserAccessToken(code);
    const expireMs = Date.now() + result.expire * 1000;

    // 2. 重定向到首页，同时设置 HttpOnly Cookie
    const response = NextResponse.redirect(new URL('/', request.url));

    const maxAge = Math.max(0, Math.floor((expireMs - Date.now()) / 1000));
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge,
    };

    response.cookies.set(TOKEN_COOKIE, result.accessToken, cookieOpts);
    response.cookies.set(EXPIRE_COOKIE, String(expireMs), cookieOpts);

    return response;
  } catch (error) {
    console.error('OAuth Callback Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { bitableService } from '@/services/feishu-bitable';
import { logger } from '@/lib/logger';

/**
 * 飞书 token 保活端点（供 Vercel Cron 定时调用）。
 *
 * 与浏览器 / 客户端完全无关：只要 Vercel 按 vercel.json 的 crons
 * 配置定时唤起本路由，就能在 refresh_token 的 7 天窗口到期前刷新飞书令牌，
 * 从而保证「服务端 ↔ 飞书」连接永久通畅，且不依赖任何用户访问。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // 若配置了 CRON_SECRET，校验 Vercel 自动注入的 Authorization 头，防止外部随意触发
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const ok = await bitableService.ensureAuth();
    if (ok) {
      return NextResponse.json({ success: true, message: 'feishu token refreshed' });
    }
    // refresh_token 已过期，需要人工重新授权（走浏览器 OAuth 流程）
    return NextResponse.json(
      { success: false, error: 'refresh_token 可能已过期，需要重新授权' },
      { status: 425 },
    );
  } catch (err) {
    logger.error('[api/keepalive] 保活失败:', err);
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

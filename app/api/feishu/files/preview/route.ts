import { NextResponse } from 'next/server';
import { verifyPreviewUrl, type DecryptedPreviewParams } from '@/lib/sign-url';
import { proxyFeishuFile } from '@/lib/preview-proxy';
import { logger } from '@/lib/logger';

/**
 * GET /api/feishu/files/preview?t=<AES-GCM加密令牌>
 * 代理飞书文件内容 —— 令牌内包含签名 + 有效期
 * token 无效或过期时重定向到不存在的路径，触发全局 404 页面
 */
export async function GET(request: Request) {
  try {
    const { searchParams, origin } = new URL(request.url);
    const token = searchParams.get('t') || '';

    if (!token) {
      return NextResponse.redirect(new URL('/404', origin));
    }

    const verify = verifyPreviewUrl(token);
    if (!verify.valid || !verify.params) {
      logger.warn('[FilePreview] token 校验失败:', verify.reason);
      return NextResponse.redirect(new URL('/404', origin));
    }

    return proxyFeishuFile(verify.params);
  } catch (error) {
    logger.error('[FilePreview] 预览异常:', error);
    const { origin } = new URL(request.url);
    return NextResponse.redirect(new URL('/404', origin));
  }
}
